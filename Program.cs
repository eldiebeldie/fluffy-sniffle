using System.Diagnostics;
using System.Text;
using System.Text.Json;
using FluffySniffle.Models;
using FluffySniffle.Services;
using Spectre.Console;

namespace FluffySniffle;

public class Program
{
    public static async Task Main(string[] args)
    {
        // 1. Load .env file if present
        LoadDotEnv(Path.Combine(Directory.GetCurrentDirectory(), ".env"));

        // 2. Determine CLI vs Web Server Mode
        var isCli = args.Contains("--cli") ||
                    args.Contains("cli") ||
                    args.Contains("--markdown") ||
                    args.Contains("--html") ||
                    args.Any(a => !a.StartsWith("--") && a != "server" && a != "start" && a != "dev");

        if (isCli)
        {
            await RunCliModeAsync(args);
            return;
        }

        await RunServerModeAsync(args);
    }

    private static void LoadDotEnv(string filePath)
    {
        if (!File.Exists(filePath)) return;

        try
        {
            foreach (var line in File.ReadAllLines(filePath))
            {
                var trimmed = line.Trim();
                if (string.IsNullOrWhiteSpace(trimmed) || trimmed.StartsWith('#')) continue;

                var eqIdx = trimmed.IndexOf('=');
                if (eqIdx <= 0) continue;

                var key = trimmed[..eqIdx].Trim();
                var val = trimmed[(eqIdx + 1)..].Trim();

                if (val.StartsWith('"') && val.EndsWith('"') && val.Length >= 2)
                    val = val[1..^1];
                else if (val.StartsWith('\'') && val.EndsWith('\'') && val.Length >= 2)
                    val = val[1..^1];

                if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
                {
                    Environment.SetEnvironmentVariable(key, val);
                }
            }
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"Failed to load .env: {ex.Message}");
        }
    }

    private static void OpenInBrowser(string url)
    {
        AppLogger.Action("Open Browser", url);
        try
        {
            if (OperatingSystem.IsWindows())
            {
                Process.Start(new ProcessStartInfo("cmd", $"/c start \"\" \"{url}\"") { CreateNoWindow = true });
            }
            else if (OperatingSystem.IsMacOS())
            {
                Process.Start("open", url);
            }
            else
            {
                Process.Start("xdg-open", url);
            }
        }
        catch (Exception ex)
        {
            AppLogger.Warn($"Could not launch browser: {ex.Message}");
        }
    }

    private static async Task RunCliModeAsync(string[] args)
    {
        AnsiConsole.MarkupLine("[bold magenta]\n🔍 GitHub Stale Branches & PR Status Checker[/]");

        var token = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        if (string.IsNullOrWhiteSpace(token))
        {
            AppLogger.Warn("GITHUB_TOKEN not found in environment. Running with unauthenticated REST API.");
            AppLogger.Info("To increase rate limits and use fast GraphQL queries, add GITHUB_TOKEN to .env\n");
        }
        else
        {
            AppLogger.Success("GitHub Token detected. Using authenticated GraphQL API.\n");
        }

        var configService = new ConfigService();
        var config = configService.LoadConfig();

        var shouldSaveMarkdown = args.Contains("--markdown");
        var shouldSaveHtml = args.Contains("--html") || args.Contains("--open") || true;
        var shouldOpenBrowser = args.Contains("--open");
        var showAllTime = args.Contains("--all-time");

        var cliRepos = new List<RepoConfig>();
        foreach (var arg in args.Where(a => !a.StartsWith("--") && a != "cli"))
        {
            try
            {
                var (owner, repo) = GitHubService.ParseRepoString(arg);
                cliRepos.Add(new RepoConfig { Owner = owner, Repo = repo });
            }
            catch (Exception ex)
            {
                AppLogger.Warn($"Skipping invalid repository argument \"{arg}\": {ex.Message}");
            }
        }

        var reposToScan = cliRepos.Count > 0 ? cliRepos : config.Repositories;
        if (reposToScan.Count == 0)
        {
            AppLogger.Error("No repositories configured. Add repos to config.json or pass owner/repo as an argument.");
            AnsiConsole.MarkupLine("[grey]Example: dotnet run -- expressjs/express\n[/]");
            return;
        }

        AppLogger.Action("CLI Scan Started", $"Scanning {reposToScan.Count} repositories...");

        using var httpClient = new HttpClient();
        var gitHubService = new GitHubService(httpClient);
        var analyzerService = new HealthAnalyzerService();
        var htmlReportService = new HtmlReportService();

        var results = new List<RepositoryHealthResult>();

        foreach (var r in reposToScan)
        {
            try
            {
                var rawData = await gitHubService.GetRepositoryHealthDataAsync(r.Owner, r.Repo);
                var analyzed = analyzerService.AnalyzeRepository(rawData, config.DefaultStaleDays, config.WarnStaleDays);
                results.Add(analyzed);
                AppLogger.Success($"Processed repository {r.Owner}/{r.Repo}");
            }
            catch (Exception ex)
            {
                AppLogger.Error($"Failed processing {r.Owner}/{r.Repo}: {ex.Message}");
            }
        }

        if (results.Count == 0)
        {
            AppLogger.Error("No repository data could be retrieved.");
            return;
        }

        var userActivities = analyzerService.AggregateUserActivities(results);

        CliReportService.PrintOverviewTable(results);
        foreach (var res in results)
        {
            CliReportService.PrintDetailedRepo(res);
        }
        CliReportService.PrintUserOverviewTable(userActivities, showAllTime);

        if (shouldSaveHtml)
        {
            var (latestPath, archivePath) = htmlReportService.SaveHtmlReport(results, userActivities);
            var fullLatest = Path.GetFullPath(latestPath).Replace("\\", "/");
            var fileUrl = $"file:///{fullLatest}";
            AnsiConsole.MarkupLine("[bold green]\n🌐 HTML Dashboard generated:[/]");
            AnsiConsole.MarkupLine($"[cyan]   Latest:  {fileUrl}[/]");
            AnsiConsole.MarkupLine($"[grey]   Archive: {archivePath}[/]");

            if (shouldOpenBrowser)
            {
                OpenInBrowser(latestPath);
            }
        }

        if (shouldSaveMarkdown)
        {
            var reportPath = MarkdownReportService.SaveMarkdownReport(results, userActivities);
            AppLogger.Success($"Markdown report saved: {reportPath}");
        }

        AppLogger.Success("CLI scan completed successfully!");
    }

    private static async Task RunServerModeAsync(string[] args)
    {
        var isDevMode = args.Contains("--dev") ||
                        Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") == "Development" ||
                        Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT") == "Development";

        var portStr = Environment.GetEnvironmentVariable("PORT");
        var port = 3000;
        if (!string.IsNullOrEmpty(portStr) && int.TryParse(portStr, out var parsedPort))
        {
            port = parsedPort;
        }

        var builder = WebApplication.CreateBuilder(args);

        // Configure Kestrel to listen on 0.0.0.0:{port}
        builder.WebHost.UseUrls($"http://*:{port}");

        // Dependency Injection
        builder.Services.AddHttpClient<GitHubService>();
        builder.Services.AddSingleton<HealthAnalyzerService>();
        builder.Services.AddSingleton<HtmlReportService>();
        builder.Services.AddSingleton<ConfigService>();
        builder.Services.AddSingleton<SseBroadcaster>();
        builder.Services.AddSingleton(new AppState { IsDevMode = isDevMode });
        builder.Services.AddSingleton<HealthScanService>();

        var app = builder.Build();

        // Request duration and access logging middleware: METHOD /path -> STATUS (XXms)
        app.Use(async (context, next) =>
        {
            var sw = Stopwatch.StartNew();
            var path = context.Request.Path + context.Request.QueryString;
            var method = context.Request.Method;

            await next();

            sw.Stop();
            var status = context.Response.StatusCode;
            var logMsg = $"{method} {path} -> {status} ({sw.ElapsedMilliseconds}ms)";
            if (status >= 400)
            {
                AppLogger.Error($"[HTTP] {logMsg}");
            }
            else
            {
                AppLogger.Action("HTTP Request", logMsg);
            }
        });

        // ----------------------------------------------------
        // Minimal API Routes
        // ----------------------------------------------------

        // GET / -> Main dashboard view
        app.MapGet("/", (AppState state, HtmlReportService htmlService) =>
        {
            AppLogger.Info("Rendering dashboard for client request");
            var html = htmlService.GenerateHtmlReport(
                state.CachedResults,
                state.CachedUserActivities,
                state.LastScanTime,
                state.CachedFailedRepos,
                state.IsDevMode);

            return Results.Content(html, "text/html; charset=utf-8");
        });

        // GET /api/live-reload -> Server-Sent Events stream
        app.MapGet("/api/live-reload", async (HttpContext ctx, SseBroadcaster broadcaster, CancellationToken ct) =>
        {
            ctx.Response.Headers.ContentType = "text/event-stream";
            ctx.Response.Headers.CacheControl = "no-cache, no-transform";
            ctx.Response.Headers.Connection = "keep-alive";

            var clientId = Guid.NewGuid();
            broadcaster.Register(clientId, ctx.Response);

            var connectedMsg = "event: connected\ndata: {}\n\n";
            await ctx.Response.Body.WriteAsync(Encoding.UTF8.GetBytes(connectedMsg), ct);
            await ctx.Response.Body.FlushAsync(ct);

            try
            {
                var tcs = new TaskCompletionSource();
                using (ct.Register(() => tcs.TrySetResult()))
                {
                    await tcs.Task;
                }
            }
            finally
            {
                broadcaster.Unregister(clientId);
            }
        });

        // POST /api/scan -> Trigger scan on-demand
        app.MapPost("/api/scan", async (AppState state, HealthScanService scanService) =>
        {
            AppLogger.Action("API Trigger", "POST /api/scan requested by user");
            try
            {
                var data = await scanService.PerformScanAsync();
                AppLogger.Success($"POST /api/scan finished: {data.Results.Count} repos updated");
                return Results.Ok(new
                {
                    success = true,
                    results = data.Results,
                    userActivities = data.UserActivities,
                    failedRepos = data.FailedRepos,
                    lastScanTime = data.LastScanTime
                });
            }
            catch (Exception ex)
            {
                AppLogger.Error($"POST /api/scan failed: {ex.Message}");
                return Results.Json(new { success = false, error = ex.Message }, statusCode: 500);
            }
        });

        // GET /api/data -> Status and cached scan data
        app.MapGet("/api/data", (AppState state) =>
        {
            return Results.Ok(new
            {
                isScanning = state.IsScanning,
                lastScanTime = state.LastScanTime,
                results = state.CachedResults,
                userActivities = state.CachedUserActivities,
                failedRepos = state.CachedFailedRepos
            });
        });

        // GET /api/repos -> Configured repositories
        app.MapGet("/api/repos", (ConfigService configService) =>
        {
            var config = configService.LoadConfig();
            return Results.Ok(new { repositories = config.Repositories });
        });

        // POST /api/repos -> Add repository with pre-validation and scan immediately
        app.MapPost("/api/repos", async (
            HttpContext context,
            ConfigService configService,
            GitHubService gitHubService,
            HealthScanService scanService) =>
        {
            try
            {
                using var reader = new StreamReader(context.Request.Body);
                var bodyText = await reader.ReadToEndAsync();
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(bodyText) ? "{}" : bodyText);
                var root = doc.RootElement;

                string? owner = root.TryGetProperty("owner", out var op) ? op.GetString() : null;
                string? repo = root.TryGetProperty("repo", out var rp) ? rp.GetString() : null;
                string? repoStr = root.TryGetProperty("repoStr", out var rsp) ? rsp.GetString() : null;

                var candidateStr = repoStr ?? (!string.IsNullOrWhiteSpace(owner) && !string.IsNullOrWhiteSpace(repo) ? $"{owner}/{repo}" : "");

                string parsedOwner, parsedRepo;
                try
                {
                    (parsedOwner, parsedRepo) = GitHubService.ParseRepoString(candidateStr);
                }
                catch (Exception parseEx)
                {
                    AppLogger.Warn($"POST /api/repos invalid input: {parseEx.Message}");
                    return Results.Json(new { success = false, error = parseEx.Message }, statusCode: 400);
                }

                AppLogger.Action("Add Repository", $"Verifying {parsedOwner}/{parsedRepo} on GitHub...");

                try
                {
                    await gitHubService.GetRepositoryHealthDataAsync(parsedOwner, parsedRepo);
                }
                catch (Exception fetchErr)
                {
                    AppLogger.Error($"Validation failed for {parsedOwner}/{parsedRepo}: {fetchErr.Message}");
                    return Results.Json(new
                    {
                        success = false,
                        error = $"Repository \"{parsedOwner}/{parsedRepo}\" could not be found or accessed on GitHub: {fetchErr.Message}"
                    }, statusCode: 404);
                }

                var config = configService.LoadConfig();
                var exists = config.Repositories.Any(r =>
                    r.Owner.Equals(parsedOwner, StringComparison.OrdinalIgnoreCase) &&
                    r.Repo.Equals(parsedRepo, StringComparison.OrdinalIgnoreCase));

                if (!exists)
                {
                    config.Repositories.Add(new RepoConfig { Owner = parsedOwner, Repo = parsedRepo });
                    configService.SaveConfig(config);
                    AppLogger.Success($"Added verified repository {parsedOwner}/{parsedRepo} to config.json");
                }
                else
                {
                    AppLogger.Info($"Repository {parsedOwner}/{parsedRepo} is already in config.json");
                }

                var scanData = await scanService.PerformScanAsync();
                return Results.Ok(new
                {
                    success = true,
                    repositories = config.Repositories,
                    results = scanData.Results,
                    userActivities = scanData.UserActivities,
                    failedRepos = scanData.FailedRepos,
                    lastScanTime = scanData.LastScanTime
                });
            }
            catch (Exception ex)
            {
                AppLogger.Error($"POST /api/repos error: {ex.Message}");
                return Results.Json(new { success = false, error = ex.Message }, statusCode: 500);
            }
        });

        // DELETE /api/repos/{owner}/{repo} -> Remove repository
        app.MapDelete("/api/repos/{owner}/{repo}", async (
            string owner,
            string repo,
            ConfigService configService,
            HealthScanService scanService) =>
        {
            try
            {
                AppLogger.Action("Remove Repository", $"{owner}/{repo}");
                var config = configService.LoadConfig();
                var originalLength = config.Repositories.Count;

                config.Repositories = config.Repositories
                    .Where(r => !(r.Owner.Equals(owner, StringComparison.OrdinalIgnoreCase) &&
                                  r.Repo.Equals(repo, StringComparison.OrdinalIgnoreCase)))
                    .ToList();

                if (config.Repositories.Count != originalLength)
                {
                    configService.SaveConfig(config);
                    AppLogger.Success($"Removed repository {owner}/{repo} from config.json");
                }
                else
                {
                    AppLogger.Warn($"Repository {owner}/{repo} was not in config.json");
                }

                var scanData = await scanService.PerformScanAsync();
                return Results.Ok(new
                {
                    success = true,
                    repositories = config.Repositories,
                    results = scanData.Results,
                    userActivities = scanData.UserActivities,
                    failedRepos = scanData.FailedRepos,
                    lastScanTime = scanData.LastScanTime
                });
            }
            catch (Exception ex)
            {
                AppLogger.Error($"DELETE /api/repos error: {ex.Message}");
                return Results.Json(new { success = false, error = ex.Message }, statusCode: 500);
            }
        });

        // ----------------------------------------------------
        // Server Startup & Cache Initialization
        // ----------------------------------------------------
        var url = $"http://localhost:{port}";
        if (isDevMode)
        {
            AnsiConsole.MarkupLine("[bold cyan]\n⚡ DEV SERVER Active with Instant Live Auto-Reload![/]");
        }
        else
        {
            AnsiConsole.MarkupLine("[bold magenta]\n🚀 GitHub Health Dashboard Server is running![/]");
        }
        AppLogger.Success($"Server active at {url}");
        AppLogger.Info("Press Ctrl+C to stop.\n");

        var token = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        if (string.IsNullOrWhiteSpace(token))
        {
            AppLogger.Warn("GITHUB_TOKEN not detected in .env. Running with unauthenticated GitHub REST API.");
            AppLogger.Info("Add GITHUB_TOKEN to .env for 5,000 req/hr rate limits and fast GraphQL queries.\n");
        }
        else
        {
            AppLogger.Success("GitHub Token detected. Using authenticated GraphQL API.\n");
        }

        var scanService = app.Services.GetRequiredService<HealthScanService>();
        var state = app.Services.GetRequiredService<AppState>();
        var configServiceInstance = app.Services.GetRequiredService<ConfigService>();
        var htmlReportService = app.Services.GetRequiredService<HtmlReportService>();
        var sseBroadcaster = app.Services.GetRequiredService<SseBroadcaster>();

        var diskCache = scanService.LoadCache();
        var currentConfig = configServiceInstance.LoadConfig();

        var currentRepoKeys = currentConfig.Repositories.Select(r => $"{r.Owner}/{r.Repo}").OrderBy(x => x).ToList();
        var cachedRepoKeys = (diskCache?.RepoKeys ?? []).OrderBy(x => x).ToList();
        var reposMatch = currentRepoKeys.SequenceEqual(cachedRepoKeys);
        var forceScan = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("FORCE_SCAN"));

        if (diskCache != null && reposMatch && !forceScan)
        {
            state.CachedResults = diskCache.Results;
            state.CachedUserActivities = diskCache.UserActivities;
            state.CachedFailedRepos = diskCache.FailedRepos;
            state.LastScanTime = diskCache.LastScanTime ?? DateTime.UtcNow.ToString("o");

            AppLogger.Success($"⚡ Loaded cached scan data for {state.CachedResults.Count} repositories (instant startup)");
            htmlReportService.SaveHtmlReport(
                state.CachedResults,
                state.CachedUserActivities,
                state.LastScanTime,
                state.CachedFailedRepos,
                isDevMode);

            _ = Task.Run(async () =>
            {
                await Task.Delay(500);
                await sseBroadcaster.BroadcastReloadAsync("server-restarted");
            });
        }
        else
        {
            try
            {
                await scanService.PerformScanAsync();
            }
            catch (Exception ex)
            {
                AppLogger.Error($"Initial scan error: {ex.Message}");
            }
        }

        // Live dev watcher
        if (isDevMode)
        {
            var configPath = configServiceInstance.ConfigPath;
            try
            {
                var watcher = new FileSystemWatcher(Path.GetDirectoryName(configPath)!)
                {
                    Filter = Path.GetFileName(configPath),
                    NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size
                };
                watcher.Changed += async (_, _) =>
                {
                    AppLogger.Info("[Dev Watcher] Change detected in config.json");
                    await sseBroadcaster.BroadcastReloadAsync("config.json");
                };
                watcher.EnableRaisingEvents = true;
                AppLogger.Success("Live file watcher initialized for configuration updates");
            }
            catch (Exception ex)
            {
                AppLogger.Warn($"Could not initialize FileSystemWatcher: {ex.Message}");
            }
        }

        if (args.Contains("--open"))
        {
            OpenInBrowser(url);
        }

        await app.RunAsync();
    }
}
