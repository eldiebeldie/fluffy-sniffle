using System.Diagnostics;
using System.Text.Json;
using FluffySniffle.Models;

namespace FluffySniffle.Services;

public class HealthScanService
{
    private readonly GitHubService _gitHubService;
    private readonly HealthAnalyzerService _analyzerService;
    private readonly HtmlReportService _htmlReportService;
    private readonly ConfigService _configService;
    private readonly SseBroadcaster _sseBroadcaster;
    private readonly AppState _appState;
    private readonly string _cachePath;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNameCaseInsensitive = true
    };

    public HealthScanService(
        GitHubService gitHubService,
        HealthAnalyzerService analyzerService,
        HtmlReportService htmlReportService,
        ConfigService configService,
        SseBroadcaster sseBroadcaster,
        AppState appState,
        string? cachePath = null)
    {
        _gitHubService = gitHubService;
        _analyzerService = analyzerService;
        _htmlReportService = htmlReportService;
        _configService = configService;
        _sseBroadcaster = sseBroadcaster;
        _appState = appState;
        _cachePath = cachePath ?? Path.Combine(Directory.GetCurrentDirectory(), "reports", ".cache.json");
    }

    public string CachePath => _cachePath;

    public void SaveCache(DiskCacheData cache)
    {
        try
        {
            var dir = Path.GetDirectoryName(_cachePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }

            var json = JsonSerializer.Serialize(cache, JsonOptions);
            File.WriteAllText(_cachePath, json);
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"Could not save disk cache: {ex.Message}");
        }
    }

    public DiskCacheData? LoadCache()
    {
        if (File.Exists(_cachePath))
        {
            try
            {
                var json = File.ReadAllText(_cachePath);
                var data = JsonSerializer.Deserialize<DiskCacheData>(json, JsonOptions);
                if (data != null && data.Version == 2 && data.Results != null && data.Results.Count > 0)
                {
                    return data;
                }
            }
            catch (Exception ex)
            {
                AppLogger.Warn($"Could not read disk cache: {ex.Message}");
            }
        }
        return null;
    }

    public async Task<DiskCacheData> PerformScanAsync(List<RepoConfig>? customRepos = null)
    {
        lock (_appState.SyncRoot)
        {
            if (_appState.IsScanning)
            {
                AppLogger.Warn("Scan request rejected: a scan is already currently in progress.");
                throw new InvalidOperationException("A scan is already in progress. Please wait.");
            }
            _appState.IsScanning = true;
        }

        var sw = Stopwatch.StartNew();
        AppLogger.Action("Scan Start", "Beginning comprehensive multi-repository scan");

        try
        {
            var config = _configService.LoadConfig();
            var reposToScan = customRepos ?? config.Repositories;

            if (reposToScan == null || reposToScan.Count == 0)
            {
                AppLogger.Warn("No repositories configured to scan.");
                _appState.CachedResults = [];
                _appState.CachedUserActivities = [];
                _appState.CachedFailedRepos = [];
                _appState.LastScanTime = DateTime.UtcNow.ToString("o");

                return new DiskCacheData
                {
                    Version = 2,
                    LastScanTime = _appState.LastScanTime,
                    Results = [],
                    UserActivities = [],
                    FailedRepos = [],
                    RepoKeys = []
                };
            }

            var results = new List<RepositoryHealthResult>();
            var failedRepos = new List<FailedRepoInfo>();

            foreach (var r in reposToScan)
            {
                AppLogger.Info($"Starting scan for {r.Owner}/{r.Repo}...");
                try
                {
                    var rawData = await _gitHubService.GetRepositoryHealthDataAsync(r.Owner, r.Repo);
                    var analyzed = _analyzerService.AnalyzeRepository(
                        rawData,
                        config.DefaultStaleDays,
                        config.WarnStaleDays);
                    results.Add(analyzed);
                }
                catch (Exception ex)
                {
                    AppLogger.Error($"Failed to scan {r.Owner}/{r.Repo}: {ex.Message}");
                    failedRepos.Add(new FailedRepoInfo
                    {
                        Owner = r.Owner,
                        Repo = r.Repo,
                        Error = ex.Message
                    });
                }
            }

            var userActivities = _analyzerService.AggregateUserActivities(results);
            var lastScanTime = DateTime.UtcNow.ToString("o");

            _appState.CachedResults = results;
            _appState.CachedUserActivities = userActivities;
            _appState.CachedFailedRepos = failedRepos;
            _appState.LastScanTime = lastScanTime;

            // Persist to reports/index.html
            _htmlReportService.SaveHtmlReport(
                results,
                userActivities,
                lastScanTime,
                failedRepos,
                _appState.IsDevMode);

            // Save to disk cache for instant startup
            var repoKeys = config.Repositories.Select(r => $"{r.Owner}/{r.Repo}").OrderBy(x => x).ToList();
            var diskData = new DiskCacheData
            {
                Version = 2,
                LastScanTime = lastScanTime,
                Results = results,
                UserActivities = userActivities,
                FailedRepos = failedRepos,
                RepoKeys = repoKeys
            };
            SaveCache(diskData);

            sw.Stop();
            AppLogger.Success($"Multi-repo scan completed in {sw.ElapsedMilliseconds}ms ({results.Count} repos analyzed, {failedRepos.Count} failed)");

            // Notify connected browser clients to reload
            await _sseBroadcaster.BroadcastReloadAsync("scan-completed");

            return diskData;
        }
        finally
        {
            lock (_appState.SyncRoot)
            {
                _appState.IsScanning = false;
            }
        }
    }
}
