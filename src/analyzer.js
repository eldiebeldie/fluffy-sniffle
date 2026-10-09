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

