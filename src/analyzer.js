/**
 * Analyzes repository data to detect stale branches and PR status.
 */
export function analyzeRepository(repoData, options = {}) {
  const {
    staleDaysThreshold = 30,
    warnStaleDays = 60,
  } = options;

  const now = new Date();
  const defaultBranch = repoData.defaultBranch;

  // Set of branches that have an active open PR
  const branchesWithOpenPr = new Set(
    repoData.pullRequests.map((pr) => pr.headRefName).filter(Boolean)
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

  // Analyze PRs
  const analyzedPrs = repoData.pullRequests.map((pr) => {
    const ageDays = Math.max(0, Math.floor((now - pr.createdAt) / (1000 * 60 * 60 * 24)));
    const daysSinceLastUpdate = Math.max(0, Math.floor((now - pr.updatedAt) / (1000 * 60 * 60 * 24)));
    const isStalePr = daysSinceLastUpdate >= staleDaysThreshold;

    return {
      ...pr,
      ageDays,
      daysSinceLastUpdate,
      isStalePr,
    };
  });

  // Sort PRs by age (oldest first)
  analyzedPrs.sort((a, b) => b.ageDays - a.ageDays);

  const draftPrsCount = analyzedPrs.filter((pr) => pr.isDraft).length;
  const stalePrsCount = analyzedPrs.filter((pr) => pr.isStalePr).length;

  return {
    fullName: repoData.fullName,
    defaultBranch,
    isPrivate: repoData.isPrivate,
    totalBranches: repoData.totalBranchesCount,
    analyzedBranchesCount: analyzedBranches.length,
    activeBranchesCount: activeBranches.length,
    staleBranchesCount: staleBranches.length,
    totalOpenPrs: repoData.totalOpenPrsCount,
    draftPrsCount,
    stalePrsCount,
    branches: analyzedBranches,
    staleBranches,
    pullRequests: analyzedPrs,
  };
}

/**
 * Aggregates branch and PR activity across all repositories grouped by user.
 */
export function aggregateUserActivities(repoResults) {
  const usersMap = new Map();

  for (const repo of repoResults) {
    // 1. Process Open PRs
    for (const pr of repo.pullRequests) {
      const author = pr.author || 'unknown';
      if (!usersMap.has(author)) {
        usersMap.set(author, {
          username: author,
          repositories: new Set(),
          openPrs: [],
          staleBranches: [],
        });
      }
      const userData = usersMap.get(author);
      userData.repositories.add(repo.fullName);
      userData.openPrs.push({
        repo: repo.fullName,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        isDraft: pr.isDraft,
        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
        ageDays: pr.ageDays,
        daysSinceLastUpdate: pr.daysSinceLastUpdate,
        isStalePr: pr.isStalePr,
      });
    }

    // 2. Process Stale Branches
    for (const branch of repo.staleBranches) {
      const author = branch.author || 'unknown';
      if (!usersMap.has(author)) {
        usersMap.set(author, {
          username: author,
          repositories: new Set(),
          openPrs: [],
          staleBranches: [],
        });
      }
      const userData = usersMap.get(author);
      userData.repositories.add(repo.fullName);
      userData.staleBranches.push({
        repo: repo.fullName,
        name: branch.name,
        daysInactive: branch.daysInactive,
        isVeryStale: branch.isVeryStale,
        hasOpenPr: branch.hasOpenPr,
        lastCommitSha: branch.lastCommitSha,
      });
    }
  }

  // Convert map to array with computed metrics
  const userActivities = Array.from(usersMap.values()).map((user) => {
    const openPrsCount = user.openPrs.length;
    const stalePrsCount = user.openPrs.filter((p) => p.isStalePr).length;
    const draftPrsCount = user.openPrs.filter((p) => p.isDraft).length;
    const staleBranchesCount = user.staleBranches.length;
    const totalNeedsAttention = stalePrsCount + staleBranchesCount;

    return {
      username: user.username,
      repositories: Array.from(user.repositories),
      openPrsCount,
      stalePrsCount,
      draftPrsCount,
      staleBranchesCount,
      totalNeedsAttention,
      openPrs: user.openPrs.sort((a, b) => b.ageDays - a.ageDays),
      staleBranches: user.staleBranches.sort((a, b) => (b.daysInactive || 0) - (a.daysInactive || 0)),
    };
  });

  // Sort by items needing attention, then total activity
  userActivities.sort((a, b) => {
    if (b.totalNeedsAttention !== a.totalNeedsAttention) {
      return b.totalNeedsAttention - a.totalNeedsAttention;
    }
    return (b.openPrsCount + b.staleBranchesCount) - (a.openPrsCount + a.staleBranchesCount);
  });

  return userActivities;
}

