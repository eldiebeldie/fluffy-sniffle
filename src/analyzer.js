import { logger } from './logger.js';

/**
 * Analyzes repository data to detect stale branches and PR status.
 */
export function analyzeRepository(repoData, options = {}) {
  const {
    staleDaysThreshold = 30,
    warnStaleDays = 60,
  } = options;

  logger.action('Analyze Repository', `${repoData.fullName} (stale threshold: ${staleDaysThreshold}d, warning: ${warnStaleDays}d)`);

  const now = new Date();
  const defaultBranch = repoData.defaultBranch;

  // Filter open PRs to determine branches associated with active PRs
  const openPrs = repoData.pullRequests.filter((pr) => (pr.state || 'OPEN') === 'OPEN');
  const branchesWithOpenPr = new Set(
    openPrs.map((pr) => pr.headRefName).filter(Boolean)
  );

  // Analyze branches
  const analyzedBranches = repoData.branches
    .filter((branch) => branch.name !== defaultBranch)
    .map((branch) => {
      let daysInactive = null;
      let isStale = false;
      let isVeryStale = false;

      if (branch.lastCommitDate) {
        const diffMs = now - branch.lastCommitDate;
        daysInactive = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        isStale = daysInactive >= staleDaysThreshold;
        isVeryStale = daysInactive >= warnStaleDays;
      }

      const hasOpenPr = branchesWithOpenPr.has(branch.name);

      return {
        ...branch,
        daysInactive,
        isStale,
        isVeryStale,
        hasOpenPr,
      };
    });

  // Sort branches by most inactive first
  analyzedBranches.sort((a, b) => (b.daysInactive || 0) - (a.daysInactive || 0));

  const staleBranches = analyzedBranches.filter((b) => b.isStale);
  const activeBranches = analyzedBranches.filter((b) => !b.isStale);

  // Analyze PRs (supports open, merged, and closed)
  const analyzedPrs = repoData.pullRequests.map((pr) => {
    const ageDays = Math.max(0, Math.floor((now - pr.createdAt) / (1000 * 60 * 60 * 24)));
    const daysSinceLastUpdate = Math.max(0, Math.floor((now - pr.updatedAt) / (1000 * 60 * 60 * 24)));
    const isStalePr = (pr.state || 'OPEN') === 'OPEN' && daysSinceLastUpdate >= staleDaysThreshold;

    return {
      ...pr,
      ageDays,
      daysSinceLastUpdate,
      isStalePr,
    };
  });

  const openAnalyzedPrs = analyzedPrs.filter((pr) => (pr.state || 'OPEN') === 'OPEN');
  const mergedAnalyzedPrs = analyzedPrs.filter((pr) => pr.state === 'MERGED');
  const closedAnalyzedPrs = analyzedPrs.filter((pr) => pr.state === 'CLOSED');

  // Sort open PRs by age (oldest first)
  openAnalyzedPrs.sort((a, b) => b.ageDays - a.ageDays);
  // Sort all PRs by creation date (newest first)
  analyzedPrs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const draftPrsCount = openAnalyzedPrs.filter((pr) => pr.isDraft).length;
  const stalePrsCount = openAnalyzedPrs.filter((pr) => pr.isStalePr).length;

  logger.info(
    `[${repoData.fullName}] Identified ${staleBranches.length} stale branches (${staleBranches.filter(b => b.isVeryStale).length} >= ${warnStaleDays}d), ${stalePrsCount} stale PRs out of ${openAnalyzedPrs.length} open (${analyzedPrs.length} all-time PRs)`
  );

  return {
    fullName: repoData.fullName,
    defaultBranch,
    isPrivate: repoData.isPrivate,
    totalBranches: repoData.totalBranchesCount,
    analyzedBranchesCount: analyzedBranches.length,
    activeBranchesCount: activeBranches.length,
    staleBranchesCount: staleBranches.length,
    totalOpenPrs: repoData.totalOpenPrsCount ?? openAnalyzedPrs.length,
    totalAllPrs: repoData.totalPrsCount ?? analyzedPrs.length,
    draftPrsCount,
    stalePrsCount,
    mergedPrsCount: mergedAnalyzedPrs.length,
    closedPrsCount: closedAnalyzedPrs.length,
    branches: analyzedBranches,
    activeBranches,
    staleBranches,
    pullRequests: openAnalyzedPrs,
    allPullRequests: analyzedPrs,
  };
}

/**
 * Aggregates branch and PR activity across all repositories grouped by user,
 * capturing both current attention items and all-time contribution history.
 */
export function aggregateUserActivities(repoResults) {
  logger.action('Aggregate Contributor Activities', `Scanning ${repoResults.length} repositories for user contributions...`);

  const usersMap = new Map();

  for (const repo of repoResults) {
    // 1. Process Pull Requests from all times (open, merged, closed)
    const prsToProcess = repo.allPullRequests || repo.pullRequests || [];
    for (const pr of prsToProcess) {
      const author = pr.author || 'unknown';
      if (!usersMap.has(author)) {
        usersMap.set(author, {
          username: author,
          repositories: new Set(),
          allPrs: [],
          openPrs: [],
          mergedPrs: [],
          closedPrs: [],
          allBranches: [],
          activeBranches: [],
          staleBranches: [],
        });
      }
      const userData = usersMap.get(author);
      userData.repositories.add(repo.fullName);

      const prItem = {
        repo: repo.fullName,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state || 'OPEN',
        isDraft: pr.isDraft,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        closedAt: pr.closedAt,
        mergedAt: pr.mergedAt,
        ageDays: pr.ageDays,
        daysSinceLastUpdate: pr.daysSinceLastUpdate,
        isStalePr: pr.isStalePr,
      };

      userData.allPrs.push(prItem);
      if (pr.state === 'OPEN') {
        userData.openPrs.push(prItem);
      } else if (pr.state === 'MERGED') {
        userData.mergedPrs.push(prItem);
      } else if (pr.state === 'CLOSED') {
        userData.closedPrs.push(prItem);
      }
    }

    // 2. Process Branches from all times (active & stale)
    const branchesToProcess = repo.branches || [];
    for (const branch of branchesToProcess) {
      const author = branch.author || 'unknown';
      if (!usersMap.has(author)) {
        usersMap.set(author, {
          username: author,
          repositories: new Set(),
          allPrs: [],
          openPrs: [],
          mergedPrs: [],
          closedPrs: [],
          allBranches: [],
          activeBranches: [],
          staleBranches: [],
        });
      }
      const userData = usersMap.get(author);
      userData.repositories.add(repo.fullName);

      const branchItem = {
        repo: repo.fullName,
        name: branch.name,
        daysInactive: branch.daysInactive,
        isStale: branch.isStale,
        isVeryStale: branch.isVeryStale,
        hasOpenPr: branch.hasOpenPr,
        lastCommitSha: branch.lastCommitSha,
        lastCommitDate: branch.lastCommitDate,
      };

      userData.allBranches.push(branchItem);
      if (branch.isStale) {
        userData.staleBranches.push(branchItem);
      } else {
        userData.activeBranches.push(branchItem);
      }
    }
  }

  // Convert map to array with computed metrics
  const userActivities = Array.from(usersMap.values()).map((user) => {
    const allPrsCount = user.allPrs.length;
    const openPrsCount = user.openPrs.length;
    const mergedPrsCount = user.mergedPrs.length;
    const closedPrsCount = user.closedPrs.length;
    const stalePrsCount = user.openPrs.filter((p) => p.isStalePr).length;
    const draftPrsCount = user.openPrs.filter((p) => p.isDraft).length;

    const allBranchesCount = user.allBranches.length;
    const activeBranchesCount = user.activeBranches.length;
    const staleBranchesCount = user.staleBranches.length;

    const totalNeedsAttention = stalePrsCount + staleBranchesCount;
    const allTimeTotalContributions = allPrsCount + allBranchesCount;

    const completedPrs = mergedPrsCount + closedPrsCount;
    const acceptanceRate = completedPrs > 0 ? Math.round((mergedPrsCount / completedPrs) * 100) : null;

    // Calculate contributor lifespan across all repositories
    const dates = [
      ...user.allPrs.map((p) => p.createdAt).filter(Boolean),
      ...user.allPrs.map((p) => p.updatedAt).filter(Boolean),
      ...user.allBranches.map((b) => b.lastCommitDate).filter(Boolean),
    ].map((d) => new Date(d).getTime());

    const firstActivityDate = dates.length > 0 ? new Date(Math.min(...dates)) : null;
    const lastActivityDate = dates.length > 0 ? new Date(Math.max(...dates)) : null;

    return {
      username: user.username,
      repositories: Array.from(user.repositories),
      
      // All-Time metrics
      allPrsCount,
      mergedPrsCount,
      closedPrsCount,
      allBranchesCount,
      activeBranchesCount,
      allTimeTotalContributions,
      acceptanceRate,
      firstActivityDate,
      lastActivityDate,

      // Attention metrics
      openPrsCount,
      stalePrsCount,
      draftPrsCount,
      staleBranchesCount,
      totalNeedsAttention,

      // Full lists sorted
      allPrs: user.allPrs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      openPrs: user.openPrs.sort((a, b) => b.ageDays - a.ageDays),
      mergedPrs: user.mergedPrs.sort((a, b) => new Date(b.mergedAt || b.createdAt) - new Date(a.mergedAt || a.createdAt)),
      closedPrs: user.closedPrs.sort((a, b) => new Date(b.closedAt || b.createdAt) - new Date(a.closedAt || a.createdAt)),

      allBranches: user.allBranches.sort((a, b) => (b.daysInactive || 0) - (a.daysInactive || 0)),
      activeBranches: user.activeBranches.sort((a, b) => (a.daysInactive || 0) - (b.daysInactive || 0)),
      staleBranches: user.staleBranches.sort((a, b) => (b.daysInactive || 0) - (a.daysInactive || 0)),
    };
  });

  // Sort by items needing attention, then total all-time activity
  userActivities.sort((a, b) => {
    if (b.totalNeedsAttention !== a.totalNeedsAttention) {
      return b.totalNeedsAttention - a.totalNeedsAttention;
    }
    return b.allTimeTotalContributions - a.allTimeTotalContributions;
  });

  const needingAttention = userActivities.filter((u) => u.totalNeedsAttention > 0).length;
  logger.success(
    `Aggregated activities for ${userActivities.length} contributors (${needingAttention} with pending items to review, all-time records preserved)`
  );

  return userActivities;
}
