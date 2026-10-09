using FluffySniffle.Models;

namespace FluffySniffle.Services;

public class AppState
{
    private readonly object _lock = new();

    public bool IsScanning { get; set; }
    public string? LastScanTime { get; set; }
    public List<RepositoryHealthResult> CachedResults { get; set; } = [];
    public List<ContributorActivity> CachedUserActivities { get; set; } = [];
    public List<FailedRepoInfo> CachedFailedRepos { get; set; } = [];
    public bool IsDevMode { get; set; }

    public object SyncRoot => _lock;
}
