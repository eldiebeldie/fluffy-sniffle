import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

dotenv.config();

/**
 * Checks whether pushing / writing changes to Git or GitHub is allowed.
 * Set to false by default unless intentionally enabled by the user.
 */
export function isGitPushAllowed() {
  if (process.env.ALLOW_GIT_PUSH === 'true' || process.env.ALLOW_GIT_PUSH === '1') {
    return true;
  }
  try {
    const cfgPath = path.resolve(process.cwd(), 'config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (cfg.allowGitPush === true) return true;
    }
  } catch {
    // Default to false on read error
  }
  return false;
}

export const allowGitPush = isGitPushAllowed();

/**
 * Logs an easy-to-read message explaining the push protection limitation and how to change it.
 */
export function logPushProtectionStatus() {
  if (!isGitPushAllowed()) {
    logger.warn(
      '🔒 Restricted-Environment Push Safeguard Active (allowGitPush = false): Outbound pushes and write actions are disabled by default to prevent accidental upstream changes.'
    );
    logger.info(
      '   To intentionally authorize pushing changes when needed, set ALLOW_GIT_PUSH=true in .env or "allowGitPush": true in config.json.\n'
    );
  } else {
    logger.info('🔓 Push Protection Flag: ENABLED (pushing changes is explicitly authorized by user configuration).\n');
  }
}

/**
 * Safely masks a token for logging without exposing any secret characters (e.g. ghp_****...****)
 */
export function maskToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return '<NONE>';
  const trimmed = rawToken.trim();
  if (!trimmed) return '<NONE>';
  if (isPlaceholderToken(trimmed)) return '<PLACEHOLDER>';
  const knownPrefixes = ['github_pat_', 'ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];
  for (const prefix of knownPrefixes) {
    if (trimmed.startsWith(prefix)) {
      return `${prefix}<TOKEN>`;
    }
  }
  return '<TOKEN>';
}

/**
 * Checks if token is an unconfigured placeholder
 */
export function isPlaceholderToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return false;
  const trimmed = rawToken.trim().toLowerCase();
  return (
    trimmed === 'your_github_pat_token_here' ||
    trimmed === 'your_token_here' ||
    trimmed === 'your_dashboard_api_key_here' ||
    trimmed === 'your_api_key_here' ||
    trimmed === 'ghp_your_token_here' ||
    trimmed === 'token' ||
    trimmed === 'ghp_xxx' ||
    (trimmed.startsWith('<') && trimmed.endsWith('>')) ||
    (trimmed.startsWith('${') && trimmed.endsWith('}'))
  );
}

// Resolve token, supporting environment variable expansion like ${VAR_NAME}
let resolvedToken = process.env.GITHUB_TOKEN;
if (resolvedToken && resolvedToken.startsWith('${') && resolvedToken.endsWith('}')) {
  const refVar = resolvedToken.slice(2, -1);
  if (process.env[refVar]) {
    resolvedToken = process.env[refVar];
  }
}

export const token = resolvedToken;
export const isPlaceholder = isPlaceholderToken(token);
export const hasToken = Boolean(token && !isPlaceholder);

// ----------------------------------------------------
// TLS & Certificate Configuration
// ----------------------------------------------------
const caCertPath = process.env.GITHUB_CA_CERT_PATH || process.env.NODE_EXTRA_CA_CERTS;
const allowInsecureTls =
  process.env.GITHUB_ALLOW_INSECURE_TLS === 'true' ||
  process.env.GITHUB_ALLOW_INSECURE_TLS === '1' ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';

let caBundle = undefined;
if (caCertPath) {
  const isCertPlaceholder =
    caCertPath.trim().startsWith('<') ||
    caCertPath.trim().toLowerCase().includes('path/to/');
  if (isCertPlaceholder) {
    logger.warn('GITHUB_CA_CERT_PATH appears to be a placeholder (<CERT_PATH>). Using default system CA store.');
  } else if (fs.existsSync(caCertPath)) {
    try {
      caBundle = fs.readFileSync(caCertPath);
      process.env.NODE_EXTRA_CA_CERTS = caCertPath;
      logger.info('Loaded custom CA certificate bundle from configured <CERT_PATH>');
    } catch (err) {
      logger.error(`Failed to read custom CA certificate file at <CERT_PATH>: ${err.message}`);
    }
  } else {
    logger.warn('Configured GITHUB_CA_CERT_PATH file not found at <CERT_PATH>');
  }
}

if (allowInsecureTls) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  logger.warn('INSECURE TLS MODE ENABLED: Certificate verification is disabled. Use for local troubleshooting only!');
}

const tlsConnectOptions = {
  rejectUnauthorized: !allowInsecureTls,
  ...(caBundle ? { ca: caBundle } : {}),
};

export const httpsAgent = new https.Agent(tlsConnectOptions);

/**
 * Resolve an Undici Agent dispatcher configured with our TLS options when available
 */
let undiciDispatcherPromise = null;
async function getUndiciDispatcher() {
  if (undiciDispatcherPromise !== null) return undiciDispatcherPromise;
  undiciDispatcherPromise = (async () => {
    try {
      const undiciMod = await import('undici');
      if (undiciMod && typeof undiciMod.Agent === 'function') {
        return new undiciMod.Agent({ connect: tlsConnectOptions });
      }
    } catch {
      // Fallback to inspecting Node's internal undici globalDispatcher symbol
    }
    try {
      const sym = Object.getOwnPropertySymbols(globalThis).find((s) =>
        s.toString().includes('undici.globalDispatcher')
      );
      const globalDisp = sym ? globalThis[sym] : null;
      if (globalDisp && typeof globalDisp.constructor === 'function') {
        return new globalDisp.constructor({ connect: tlsConnectOptions });
      }
    } catch {
      // Ignore if symbol is not yet initialized
    }
    return null;
  })();
  return undiciDispatcherPromise;
}

/**
 * Execute an HTTPS request using node:https and httpsAgent to guarantee custom CA / TLS enforcement
 * even when Undici dispatcher is unavailable.
 */
function fetchViaHttpsAgent(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(String(url));
    const headers = {};
    if (options.headers) {
      if (typeof options.headers.entries === 'function') {
        for (const [k, v] of options.headers.entries()) headers[k] = v;
      } else if (Array.isArray(options.headers)) {
        for (const [k, v] of options.headers) headers[k] = v;
      } else {
        Object.assign(headers, options.headers);
      }
    }

    const req = https.request(
      parsedUrl,
      {
        method: options.method || 'GET',
        headers,
        agent: httpsAgent,
        rejectUnauthorized: !allowInsecureTls,
        ...(caBundle ? { ca: caBundle } : {}),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [key, val] of Object.entries(res.headers)) {
            if (Array.isArray(val)) {
              val.forEach((v) => responseHeaders.append(key, v));
            } else if (val !== undefined) {
              responseHeaders.set(key, String(val));
            }
          }
          const status = res.statusCode || 200;
          const body = status === 204 || status === 205 || status === 304 ? null : bodyBuffer;
          resolve(
            new Response(body, {
              status,
              statusText: res.statusMessage || '',
              headers: responseHeaders,
            })
          );
        });
      }
    );

    req.on('error', reject);
    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy(new Error('Request aborted'));
        return;
      }
      options.signal.addEventListener('abort', () => req.destroy(new Error('Request aborted')), { once: true });
    }

    if (options.body) {
      if (typeof options.body === 'string' || Buffer.isBuffer(options.body) || options.body instanceof Uint8Array) {
        req.write(options.body);
      } else {
        req.write(String(options.body));
      }
    }
    req.end();
  });
}

export const customFetch = async (url, options = {}) => {
  const dispatcher = await getUndiciDispatcher();
  // When custom CA or insecure TLS is configured and no Undici dispatcher was constructed yet,
  // use node:https with httpsAgent so custom TLS settings are strictly applied.
  if ((caBundle || allowInsecureTls) && !dispatcher && String(url).startsWith('https:')) {
    return fetchViaHttpsAgent(url, options);
  }
  return fetch(url, {
    ...options,
    agent: httpsAgent,
    ...(dispatcher ? { dispatcher } : {}),
  });
};

export const octokit = new Octokit({
  auth: hasToken ? token : undefined,
  request: {
    agent: httpsAgent,
    fetch: customFetch,
  },
});

// Enforce read-only GitHub API interactions when allowGitPush is false (default)
octokit.hook.before('request', async (options) => {
  if (isGitPushAllowed()) return;

  const method = (options.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return;

  // Allow read-only GraphQL queries (POST /graphql with query, but block GraphQL mutations)
  if (method === 'POST' && options.url === '/graphql') {
    const queryStr = typeof options.query === 'string' ? options.query : JSON.stringify(options.data || '');
    if (!/\bmutation\b/i.test(queryStr)) {
      return;
    }
  }

  const errMsg =
    `Push/write action blocked (${method} ${options.url}): pushing changes is disabled by default (allowGitPush = false). ` +
    `To enable it, set ALLOW_GIT_PUSH=true in .env or "allowGitPush": true in config.json.`;
  logger.error(errMsg);
  throw new Error(errMsg);
});

/**
 * Fetch branches and PRs using GraphQL (requires GITHUB_TOKEN)
 */
async function fetchViaGraphQL(owner, repo) {
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const fetchStart = Date.now();
  logger.info(`Fetching ${owner}/${repo} (${repoUrl}) via GitHub GraphQL API...`);

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
  const durationMs = Date.now() - fetchStart;
  const repoData = response.repository;

  if (!repoData) {
    logger.error(`Repository ${owner}/${repo} (${repoUrl}) not found on GitHub after ${durationMs}ms.`);
    throw new Error(`Repository ${owner}/${repo} (${repoUrl}) not found.`);
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
    `[${owner}/${repo}] (${repoUrl}) GraphQL fetch complete in ${durationMs}ms: ${branches.length} branches, ${pullRequests.length} PRs (${openPrsCount} open, default branch: ${defaultBranch})`
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
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const fetchStart = Date.now();
  logger.info(`Fetching ${owner}/${repo} (${repoUrl}) via GitHub REST API (unauthenticated fallback)...`);

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
  const durationMs = Date.now() - fetchStart;

  logger.info(
    `[${owner}/${repo}] (${repoUrl}) REST fetch complete in ${durationMs}ms: ${branches.length} branches, ${pullRequests.length} PRs (${openPrsCount} open, default branch: ${defaultBranch})`
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
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const startTime = Date.now();
  const apiType = hasToken ? 'GraphQL API' : 'REST API';
  logger.action('Fetch Repository', `${owner}/${repo} (${repoUrl}) using ${apiType}`);
  try {
    let result;
    if (hasToken) {
      result = await fetchViaGraphQL(owner, repo);
    } else {
      result = await fetchViaRest(owner, repo);
    }
    const durationMs = Date.now() - startTime;
    logger.success(`Fetched repository ${owner}/${repo} (${repoUrl}) (${apiType}) in ${durationMs}ms`);
    return result;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error(`Failed to fetch repository ${owner}/${repo} (${repoUrl}) after ${durationMs}ms: ${err.message}`);
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
