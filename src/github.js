import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
import { logger } from './logger.js';

dotenv.config();

const token = process.env.GITHUB_TOKEN;

export const octokit = new Octokit({
  auth: token || undefined,
});

export const hasToken = Boolean(token);

/**
 * Fetch branches and PRs using GraphQL (requires GITHUB_TOKEN)
 */
async function fetchViaGraphQL(owner, repo) {
  logger.info(`Fetching ${owner}/${repo} via GitHub GraphQL API...`);

  const query = `
    query GetRepoHealth($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) {
        name
        owner {
          login
        }
        isPrivate
        defaultBranchRef {
          name
        }
        refs(refPrefix: "refs/heads/", first: 100) {
          totalCount
          nodes {
            name
            target {
              ... on Commit {
                oid
                committedDate
                pushedDate
                author {
                  name
                  user {
                    login
                  }
                }
              }
            }
          }
        }
        pullRequests(first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
          totalCount
          nodes {
            number
            title
            url
            state
            isDraft
            createdAt
            updatedAt
            closedAt
            mergedAt
            headRefName
            author {
              login
            }
            comments {
              totalCount
            }
          }
        }
        openPullRequests: pullRequests(states: OPEN) {
          totalCount
        }
      }
    }
  `;

  const response = await octokit.graphql(query, { owner, repo });
  const repoData = response.repository;

  if (!repoData) {
    logger.error(`Repository ${owner}/${repo} not found on GitHub.`);
    throw new Error(`Repository ${owner}/${repo} not found.`);
  }

  const defaultBranch = repoData.defaultBranchRef?.name || 'main';

  const branches = (repoData.refs?.nodes || []).map((branch) => {
    const commit = branch.target;
    return {
      name: branch.name,
      lastCommitDate: commit?.committedDate ? new Date(commit.committedDate) : null,
      lastCommitSha: commit?.oid,
      author: commit?.author?.user?.login || commit?.author?.name || 'unknown',
    };
  });

  const pullRequests = (repoData.pullRequests?.nodes || []).map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state || 'OPEN',
    isDraft: pr.isDraft || false,
    createdAt: new Date(pr.createdAt),
    updatedAt: new Date(pr.updatedAt),
    closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
    mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
    headRefName: pr.headRefName,
    author: pr.author?.login || 'unknown',
    commentsCount: pr.comments?.totalCount || 0,
  }));

  const openPrsCount = repoData.openPullRequests?.totalCount ?? pullRequests.filter((p) => p.state === 'OPEN').length;

  logger.info(
    `[${owner}/${repo}] GraphQL fetch complete: ${branches.length} branches, ${pullRequests.length} PRs (${openPrsCount} open, default branch: ${defaultBranch})`
  );

  return {
    fullName: `${owner}/${repo}`,
    defaultBranch,
    isPrivate: repoData.isPrivate,
    totalBranchesCount: repoData.refs?.totalCount || branches.length,
    totalOpenPrsCount: openPrsCount,
    totalPrsCount: repoData.pullRequests?.totalCount || pullRequests.length,
    branches,
    pullRequests,
  };
}

/**
 * Fallback: Fetch branches and PRs using REST API (works unauthenticated for public repos)
 */
async function fetchViaRest(owner, repo) {
  logger.info(`Fetching ${owner}/${repo} via GitHub REST API (unauthenticated fallback)...`);

  // 1. Get repository metadata
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch;

  // 2. Fetch PRs across all states (open, merged, closed)
  const { data: prsData } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'all',
    per_page: 100,
  });

  const pullRequests = prsData.map((pr) => {
    let state = 'OPEN';
    if (pr.merged_at) {
      state = 'MERGED';
    } else if (pr.state === 'closed') {
      state = 'CLOSED';
    }

    return {
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state,
      isDraft: pr.draft || false,
      createdAt: new Date(pr.created_at),
      updatedAt: new Date(pr.updated_at),
      closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      headRefName: pr.head?.ref,
      author: pr.user?.login || 'unknown',
      commentsCount: pr.comments || 0,
    };
  });

  // 3. Fetch branches
  const { data: branchesData } = await octokit.rest.repos.listBranches({
    owner,
    repo,
    per_page: 100,
  });

  // Fetch commit details for top branches to get commit dates
  const branches = await Promise.all(
    branchesData.slice(0, 30).map(async (branch) => {
      try {
        const { data: commitData } = await octokit.rest.repos.getCommit({
          owner,
          repo,
          ref: branch.commit.sha,
        });
        return {
          name: branch.name,
          lastCommitDate: new Date(commitData.commit.committer?.date || commitData.commit.author?.date),
          lastCommitSha: branch.commit.sha,
          author: commitData.author?.login || commitData.commit.author?.name || 'unknown',
        };
      } catch {
        return {
          name: branch.name,
          lastCommitDate: null,
          lastCommitSha: branch.commit.sha,
          author: 'unknown',
        };
      }
    })
  );

  const openPrsCount = pullRequests.filter((p) => p.state === 'OPEN').length;

  logger.info(
    `[${owner}/${repo}] REST fetch complete: ${branches.length} branches, ${pullRequests.length} PRs (${openPrsCount} open, default branch: ${defaultBranch})`
  );

  return {
    fullName: `${owner}/${repo}`,
    defaultBranch,
    isPrivate: repoData.private,
    totalBranchesCount: branchesData.length,
    totalOpenPrsCount: openPrsCount,
    totalPrsCount: pullRequests.length,
    branches,
    pullRequests,
  };
}

/**
 * Main export to get repository data
 */
export async function getRepositoryHealthData(owner, repo) {
  logger.action('Fetch Repository', `${owner}/${repo} using ${hasToken ? 'GraphQL API' : 'REST API'}`);
  try {
    if (hasToken) {
      return await fetchViaGraphQL(owner, repo);
    } else {
      return await fetchViaRest(owner, repo);
    }
  } catch (err) {
    logger.error(`Failed to fetch repository ${owner}/${repo}: ${err.message}`);
    throw err;
  }
}

/**
 * Safely parse and sanitize repository input string or URL
 */
export function parseRepoString(input) {
  if (!input || typeof input !== 'string') return null;
  let str = input.trim();
  // Strip protocol and domain if full URL provided
  str = str.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  // Strip trailing slashes and .git
  str = str.replace(/\.git$/i, '').replace(/\/+$/, '');

  // Detect GitHub Topic URLs (e.g. github.com/topics/weather or topics/weather)
  if (str.toLowerCase().startsWith('topics/')) {
    throw new Error(
      `"${input}" is a GitHub Topic category, not a repository. Please enter a valid repository (e.g. "facebook/react" or "expressjs/express").`
    );
  }

  const parts = str.split('/');
  if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
    throw new Error(
      `Invalid repository format "${input}". Expected "owner/repo" (e.g. "facebook/react" or "https://github.com/facebook/react").`
    );
  }

  const owner = parts[0].trim();
  const repo = parts[1].trim();

  // Basic GitHub naming rules check
  if (!/^[a-zA-Z0-9_.-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    throw new Error(`Repository name contains invalid characters: "${owner}/${repo}"`);
  }

  return { owner, repo };
}

