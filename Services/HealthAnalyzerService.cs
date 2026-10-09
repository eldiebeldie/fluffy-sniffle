using FluffySniffle.Models;

namespace FluffySniffle.Services;

public class HealthAnalyzerService
{
    public RepositoryHealthResult AnalyzeRepository(
        RepositoryHealthResult repoData,
        int staleDaysThreshold = 30,
        int warnStaleDays = 60)
    {
        AppLogger.Action("Analyze Repository", $"{repoData.FullName} (stale threshold: {staleDaysThreshold}d, warning: {warnStaleDays}d)");

        var openPrHeadRefs = repoData.AllPullRequests
            .Where(pr => pr.State == "OPEN")
            .Select(pr => pr.HeadRefName)
            .Where(name => !string.IsNullOrEmpty(name))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var analyzedBranches = new List<BranchInfo>();
        var staleBranches = new List<BranchInfo>();

        foreach (var branch in repoData.AllBranches)
        {
            var hasOpenPr = openPrHeadRefs.Contains(branch.Name);
            int? daysInactive = null;
            var isStale = false;
            var isVeryStale = false;

            if (branch.LastCommitDate.HasValue)
            {
                var diff = DateTimeOffset.UtcNow - branch.LastCommitDate.Value;
                daysInactive = (int)Math.Floor(diff.TotalDays);
                isStale = daysInactive >= staleDaysThreshold;
                isVeryStale = daysInactive >= warnStaleDays;
            }

            var updatedBranch = branch with
            {
                DaysInactive = daysInactive,
                IsStale = isStale,
                IsVeryStale = isVeryStale,
                HasOpenPr = hasOpenPr
            };

            analyzedBranches.Add(updatedBranch);

            // Exclude default branch from being marked as stale cleanup target
            if (isStale && !branch.Name.Equals(repoData.DefaultBranch, StringComparison.OrdinalIgnoreCase))
            {
                staleBranches.Add(updatedBranch);
            }
        }

        staleBranches.Sort((a, b) => (b.DaysInactive ?? 0).CompareTo(a.DaysInactive ?? 0));

        var analyzedPrs = new List<PullRequestInfo>();
        foreach (var pr in repoData.AllPullRequests)
        {
            var ageDiff = DateTimeOffset.UtcNow - pr.CreatedAt;
            var updateDiff = DateTimeOffset.UtcNow - pr.UpdatedAt;

            var ageDays = (int)Math.Floor(ageDiff.TotalDays);
            var daysSinceLastUpdate = (int)Math.Floor(updateDiff.TotalDays);
            var isStalePr = daysSinceLastUpdate >= staleDaysThreshold && pr.State == "OPEN";

            analyzedPrs.Add(pr with
            {
                AgeDays = ageDays,
                DaysSinceLastUpdate = daysSinceLastUpdate,
                IsStalePr = isStalePr
            });
        }

        var openPrs = analyzedPrs.Where(p => p.State == "OPEN").ToList();
        var stalePrsCount = openPrs.Count(p => p.IsStalePr);
        var draftPrsCount = openPrs.Count(p => p.IsDraft);
        var veryStaleBranchesCount = staleBranches.Count(b => b.IsVeryStale);

        AppLogger.Info($"[{repoData.FullName}] Identified {staleBranches.Count} stale branches ({veryStaleBranchesCount} >= {warnStaleDays}d) and {stalePrsCount} stale PRs out of {openPrs.Count} total open PRs");

        return repoData with
        {
            AllBranches = analyzedBranches,
            StaleBranches = staleBranches,
            StaleBranchesCount = staleBranches.Count,
            AllPullRequests = analyzedPrs,
            PullRequests = openPrs,
            TotalOpenPrs = openPrs.Count,
            TotalPrs = analyzedPrs.Count,
            StalePrsCount = stalePrsCount,
            DraftPrsCount = draftPrsCount
        };
    }

    public List<ContributorActivity> AggregateUserActivities(List<RepositoryHealthResult> results)
    {
        AppLogger.Action("Aggregate Contributor Activities", $"Scanning {results.Count} repositories for user contributions...");

        var usersMap = new Dictionary<string, ContributorActivity>(StringComparer.OrdinalIgnoreCase);

        ContributorActivity GetOrCreateUser(string username)
        {
            var cleanUsername = string.IsNullOrWhiteSpace(username) ? "unknown" : username.Trim();
            if (!usersMap.TryGetValue(cleanUsername, out var activity))
            {
                activity = new ContributorActivity { Username = cleanUsername };
                usersMap[cleanUsername] = activity;
            }
            return activity;
        }

        foreach (var repo in results)
        {
            // Process Pull Requests
            foreach (var pr in repo.AllPullRequests)
            {
                var user = GetOrCreateUser(pr.Author);
                if (!user.Repositories.Contains(repo.FullName))
                {
                    user.Repositories.Add(repo.FullName);
                }

                user.AuthoredPrs.Add(pr);
                user.AllPrsCount++;

                if (pr.State == "OPEN")
                {
                    user.OpenPrsCount++;
                    if (pr.IsStalePr)
                    {
                        user.StalePrsCount++;
                    }
                }
                else if (pr.State == "MERGED")
                {
                    user.MergedPrsCount++;
                }
                else if (pr.State == "CLOSED")
                {
                    user.ClosedPrsCount++;
                }
            }

            // Process All Branches
            foreach (var branch in repo.AllBranches)
            {
                var user = GetOrCreateUser(branch.Author);
                if (!user.Repositories.Contains(repo.FullName))
                {
                    user.Repositories.Add(repo.FullName);
                }

                user.AllBranches.Add(branch);
            }

            // Process Stale Branches
            foreach (var branch in repo.StaleBranches)
            {
                var user = GetOrCreateUser(branch.Author);
                user.StaleBranches.Add(branch);
                user.StaleBranchesCount++;
            }
        }

        var contributorList = usersMap.Values.ToList();
        foreach (var user in contributorList)
        {
            user.TotalNeedsAttention = user.StalePrsCount + user.StaleBranchesCount;
        }

        contributorList.Sort((a, b) =>
        {
            var cmp = b.TotalNeedsAttention.CompareTo(a.TotalNeedsAttention);
            if (cmp != 0) return cmp;
            cmp = b.AllPrsCount.CompareTo(a.AllPrsCount);
            if (cmp != 0) return cmp;
            return string.Compare(a.Username, b.Username, StringComparison.OrdinalIgnoreCase);
        });

        var attentionCount = contributorList.Count(u => u.TotalNeedsAttention > 0);
        AppLogger.Success($"Aggregated activities for {contributorList.Count} contributors ({attentionCount} with pending items to review)");

        return contributorList;
    }
}
