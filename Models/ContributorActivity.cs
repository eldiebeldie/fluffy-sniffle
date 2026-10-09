using System.Text.Json.Serialization;

namespace FluffySniffle.Models;

public record ContributorActivity
{
    [JsonPropertyName("username")]
    public string Username { get; init; } = string.Empty;

    [JsonPropertyName("repositories")]
    public List<string> Repositories { get; set; } = [];

    [JsonPropertyName("openPrsCount")]
    public int OpenPrsCount { get; set; }

    [JsonPropertyName("mergedPrsCount")]
    public int MergedPrsCount { get; set; }

    [JsonPropertyName("closedPrsCount")]
    public int ClosedPrsCount { get; set; }

    [JsonPropertyName("allPrsCount")]
    public int AllPrsCount { get; set; }

    [JsonPropertyName("stalePrsCount")]
    public int StalePrsCount { get; set; }

    [JsonPropertyName("staleBranchesCount")]
    public int StaleBranchesCount { get; set; }

    [JsonPropertyName("totalNeedsAttention")]
    public int TotalNeedsAttention { get; set; }

    [JsonPropertyName("authoredPrs")]
    public List<PullRequestInfo> AuthoredPrs { get; set; } = [];

    [JsonPropertyName("staleBranches")]
    public List<BranchInfo> StaleBranches { get; set; } = [];

    [JsonPropertyName("allBranches")]
    public List<BranchInfo> AllBranches { get; set; } = [];

    [JsonPropertyName("allBranchesCount")]
    public int AllBranchesCount => AllBranches.Count;

    [JsonPropertyName("activeBranchesCount")]
    public int ActiveBranchesCount => Math.Max(0, AllBranches.Count - StaleBranchesCount);

    [JsonPropertyName("acceptanceRate")]
    public int? AcceptanceRate => (MergedPrsCount + ClosedPrsCount) > 0 ? (int)Math.Round((double)MergedPrsCount / (MergedPrsCount + ClosedPrsCount) * 100) : null;
}

public record FailedRepoInfo
{
    [JsonPropertyName("owner")]
    public string Owner { get; init; } = string.Empty;

    [JsonPropertyName("repo")]
    public string Repo { get; init; } = string.Empty;

    [JsonPropertyName("error")]
    public string Error { get; init; } = string.Empty;
}

public record DiskCacheData
{
    [JsonPropertyName("version")]
    public int Version { get; init; } = 2;

    [JsonPropertyName("lastScanTime")]
    public string? LastScanTime { get; init; }

    [JsonPropertyName("results")]
    public List<RepositoryHealthResult> Results { get; init; } = [];

    [JsonPropertyName("userActivities")]
    public List<ContributorActivity> UserActivities { get; init; } = [];

    [JsonPropertyName("failedRepos")]
    public List<FailedRepoInfo> FailedRepos { get; init; } = [];

    [JsonPropertyName("repoKeys")]
    public List<string> RepoKeys { get; init; } = [];
}
