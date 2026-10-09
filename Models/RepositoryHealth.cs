using System.Text.Json.Serialization;

namespace FluffySniffle.Models;

public record BranchInfo
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;

    [JsonPropertyName("lastCommitDate")]
    public DateTimeOffset? LastCommitDate { get; init; }

    [JsonPropertyName("lastCommitSha")]
    public string? LastCommitSha { get; init; }

    [JsonPropertyName("author")]
    public string Author { get; init; } = "unknown";

    [JsonPropertyName("daysInactive")]
    public int? DaysInactive { get; set; }

    [JsonPropertyName("isStale")]
    public bool IsStale { get; set; }

    [JsonPropertyName("isVeryStale")]
    public bool IsVeryStale { get; set; }

    [JsonPropertyName("hasOpenPr")]
    public bool HasOpenPr { get; set; }

    [JsonPropertyName("repoFullName")]
    public string RepoFullName { get; set; } = string.Empty;
}

public record PullRequestInfo
{
    [JsonPropertyName("number")]
    public int Number { get; init; }

    [JsonPropertyName("title")]
    public string Title { get; init; } = string.Empty;

    [JsonPropertyName("url")]
    public string Url { get; init; } = string.Empty;

    [JsonPropertyName("state")]
    public string State { get; init; } = "OPEN";

    [JsonPropertyName("isDraft")]
    public bool IsDraft { get; init; }

    [JsonPropertyName("createdAt")]
    public DateTimeOffset CreatedAt { get; init; }

    [JsonPropertyName("updatedAt")]
    public DateTimeOffset UpdatedAt { get; init; }

    [JsonPropertyName("closedAt")]
    public DateTimeOffset? ClosedAt { get; init; }

    [JsonPropertyName("mergedAt")]
    public DateTimeOffset? MergedAt { get; init; }

    [JsonPropertyName("headRefName")]
    public string HeadRefName { get; init; } = string.Empty;

    [JsonPropertyName("author")]
    public string Author { get; init; } = "unknown";

    [JsonPropertyName("commentsCount")]
    public int CommentsCount { get; init; }

    [JsonPropertyName("ageDays")]
    public int AgeDays { get; set; }

    [JsonPropertyName("daysSinceLastUpdate")]
    public int DaysSinceLastUpdate { get; set; }

    [JsonPropertyName("isStalePr")]
    public bool IsStalePr { get; set; }

    [JsonPropertyName("repoFullName")]
    public string RepoFullName { get; set; } = string.Empty;
}

public record RepositoryHealthResult
{
    [JsonPropertyName("fullName")]
    public string FullName { get; init; } = string.Empty;

    [JsonPropertyName("defaultBranch")]
    public string DefaultBranch { get; init; } = "main";

    [JsonPropertyName("isPrivate")]
    public bool IsPrivate { get; init; }

    [JsonPropertyName("totalBranches")]
    public int TotalBranches { get; set; }

    [JsonPropertyName("totalOpenPrs")]
    public int TotalOpenPrs { get; set; }

    [JsonPropertyName("totalPrs")]
    public int TotalPrs { get; set; }

    [JsonPropertyName("staleBranchesCount")]
    public int StaleBranchesCount { get; set; }

    [JsonPropertyName("stalePrsCount")]
    public int StalePrsCount { get; set; }

    [JsonPropertyName("draftPrsCount")]
    public int DraftPrsCount { get; set; }

    [JsonPropertyName("staleBranches")]
    public List<BranchInfo> StaleBranches { get; set; } = [];

    [JsonPropertyName("allBranches")]
    public List<BranchInfo> AllBranches { get; set; } = [];

    [JsonPropertyName("pullRequests")]
    public List<PullRequestInfo> PullRequests { get; set; } = [];

    [JsonPropertyName("allPullRequests")]
    public List<PullRequestInfo> AllPullRequests { get; set; } = [];
}
