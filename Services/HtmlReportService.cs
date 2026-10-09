using System.Net;
using System.Reflection;
using System.Text;
using System.Text.Json;
using FluffySniffle.Models;

namespace FluffySniffle.Services;

public class HtmlReportService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    private static string? _cachedCss;
    private static string? _cachedJs;

    private static string LoadResource(string resourceName)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var fullResourceName = $"FluffySniffle.Resources.{resourceName}";
        using var stream = assembly.GetManifestResourceStream(fullResourceName);
        if (stream != null)
        {
            using var reader = new StreamReader(stream, Encoding.UTF8);
            return reader.ReadToEnd();
        }

        // Fallback to disk file if running from source tree
        var filePath = Path.Combine(Directory.GetCurrentDirectory(), "Resources", resourceName);
        if (File.Exists(filePath))
        {
            return File.ReadAllText(filePath, Encoding.UTF8);
        }

        return string.Empty;
    }

    private static string FormatDate(DateTimeOffset? date)
    {
        if (!date.HasValue) return "—";
        return date.Value.ToString("yyyy-MM-dd");
    }

    public string GenerateHtmlReport(
        List<RepositoryHealthResult> results,
        List<ContributorActivity> userActivities,
        string? lastScanTime = null,
        List<FailedRepoInfo>? failedRepos = null,
        bool isDev = false)
    {
        _cachedCss ??= LoadResource("dashboard.css");
        _cachedJs ??= LoadResource("dashboard.js");

        var totalRepos = results.Count;
        var totalBranches = results.Sum(r => r.TotalBranches);
        var totalStaleBranches = results.Sum(r => r.StaleBranchesCount);
        var totalOpenPrs = results.Sum(r => r.TotalOpenPrs);
        var totalAllPrs = results.Sum(r => r.TotalPrs);
        var totalMergedPrs = userActivities.Sum(u => u.MergedPrsCount);
        var totalStalePrs = results.Sum(r => r.StalePrsCount);
        var totalDraftPrs = results.Sum(r => r.DraftPrsCount);

        var totalContributors = userActivities.Count;
        var contributorsWithStaleBranches = userActivities.Count(u => u.StaleBranchesCount > 0);
        var totalReviewItems = userActivities.Sum(u => u.TotalNeedsAttention);

        var generatedAt = string.IsNullOrEmpty(lastScanTime)
            ? DateTime.UtcNow.ToString("R")
            : DateTimeOffset.Parse(lastScanTime).UtcDateTime.ToString("R");

        var dashboardDataObj = new
        {
            results,
            userActivities
        };

        var dashboardDataJson = JsonSerializer.Serialize(dashboardDataObj, JsonOptions)
            .Replace("</script>", "<\\/script>")
            .Replace("<", "\\u003c");

        var clientScript = _cachedJs.Replace("/*INJECT_DASHBOARD_DATA*/ {}", dashboardDataJson);

        var sb = new StringBuilder(128 * 1024);

        sb.Append("""
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Repository & Contributor Health Dashboard</title>
  <style>

""");
        sb.Append(_cachedCss);
        sb.Append("""

  </style>
</head>
<body>
  <!-- Section 508 Accessible Skip Link -->
  <a href="#mainViewSwitcher" class="skip-link">Skip to main content</a>

  <div class="container">
    <header role="banner">
      <div class="header-title">
        <h1>📊 GitHub Health & Contributor Dashboard</h1>
        <p id="lastScannedText">Last scanned: 
""");
        sb.Append(WebUtility.HtmlEncode(generatedAt));
        if (isDev)
        {
            sb.Append(" <span class=\"badge\" style=\"background: rgba(35, 134, 54, 0.15); border: 1px solid var(--success); color: var(--success); font-weight: 600; padding: 2px 8px; border-radius: 6px; font-size: 11px; margin-left: 8px;\">⚡ LIVE RELOAD ACTIVE</span>");
        }
        sb.Append("""
</p>
      </div>

      <div class="controls" role="toolbar" aria-label="Dashboard Controls">
        <!-- Section 508 Accessible Theme Switcher -->
        <div>
          <label for="themeSelect" class="sr-only">Visual Theme</label>
          <select id="themeSelect" class="theme-select" onchange="setTheme(this.value)" aria-label="Visual Theme Selector">
            <option value="dark">🌙 Dark Mode</option>
            <option value="light">☀️ Light Mode</option>
            <option value="midnight">🌌 Midnight</option>
            <option value="high-contrast">👁️ High Contrast (508)</option>
          </select>
        </div>

        <!-- Add Repo Form -->
        <label for="newRepoInput" class="sr-only">Add new repository in owner/repo format</label>
        <input type="text" id="newRepoInput" class="search-input" placeholder="Add repo: owner/repo" style="width: 165px;" aria-label="Repository name to add">
        <button class="btn btn-secondary" id="addRepoBtn" onclick="handleAddRepo()" aria-label="Add repository and scan">➕ Add</button>

        <!-- Trigger Scan Button -->
        <button class="btn btn-primary" id="triggerScanBtn" onclick="triggerScan()" aria-label="Run health report scan now">
          <span id="scanBtnIcon">🔄</span> <span id="scanBtnText">Run Report Now</span>
        </button>

        <!-- Search Input with Clear Button -->
        <div class="search-wrapper">
          <label for="searchInput" class="sr-only">Search all items</label>
          <input type="text" id="searchInput" class="search-input" placeholder="🔍 Search items (PR, branch, user)... [/]" autocomplete="off" aria-label="Search items">
          <button id="searchClearBtn" class="search-clear-btn" onclick="clearSearch()" title="Clear search (Esc)" aria-label="Clear search">✕</button>
        </div>
      </div>
    </header>

""");

        if (failedRepos != null && failedRepos.Count > 0)
        {
            sb.Append($"""
    <div class="alert-banner" role="alert" style="background: rgba(218, 54, 51, 0.15); border: 1px solid var(--danger); color: var(--header-text); padding: 14px 18px; border-radius: 8px; margin-bottom: 24px;">
      <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">⚠️ Unreachable Repositories ({failedRepos.Count})</div>
      <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">The following repositories configured in <code>config.json</code> could not be resolved or fetched from GitHub:</div>
      <ul style="margin: 0 0 6px 20px; font-size: 13px;">
""");
            foreach (var f in failedRepos)
            {
                var safeOwner = WebUtility.HtmlEncode(f.Owner);
                var safeRepo = WebUtility.HtmlEncode(f.Repo);
                var safeError = WebUtility.HtmlEncode(f.Error);
                sb.Append($"""
        <li style="margin-bottom: 4px;">
          <strong>{safeOwner}/{safeRepo}</strong>: {safeError}
          <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px; margin-left: 8px; cursor: pointer;" onclick="handleRemoveRepo('{safeOwner}/{safeRepo}')">Remove from Config</button>
        </li>
""");
            }
            sb.Append("      </ul>\n    </div>\n");
        }

        sb.Append($"""
    <!-- Top View Switcher Tabs -->
    <nav class="view-switcher" id="mainViewSwitcher" role="tablist" aria-label="Dashboard Views">
      <button class="view-btn active" id="btnViewRepos" onclick="switchView('repos')" role="tab" aria-selected="true" aria-controls="viewRepos">
        🏢 Repositories View <span class="pill" id="badgeTotalRepos">{totalRepos}</span>
      </button>
      <button class="view-btn" id="btnViewUsers" onclick="switchView('users')" role="tab" aria-selected="false" aria-controls="viewUsers">
        👤 Contributor Activities <span class="pill" id="badgeTotalContributors">{totalContributors}</span>
      </button>
    </nav>

    <!-- VIEW 3: SEARCH RESULTS VIEW -->
    <main id="viewSearch" class="view-panel hidden" role="region" aria-label="Search Results">
      <div class="section-card">
        <div class="section-header">
          <div>
            <h2 id="searchSummaryTitle">🔍 Search Results</h2>
            <p id="searchSummarySubtitle" style="font-size: 13px; color: var(--text-muted); margin-top: 2px;"></p>
          </div>
          <div class="filter-chips" role="group" aria-label="Filter search categories">
            <button class="chip-btn active" id="chipAll" onclick="filterSearchType('all')">All (<span id="countSearchAll">0</span>)</button>
            <button class="chip-btn" id="chipPrs" onclick="filterSearchType('prs')">Pull Requests (<span id="countSearchPrs">0</span>)</button>
            <button class="chip-btn" id="chipBranches" onclick="filterSearchType('branches')">Branches (<span id="countSearchBranches">0</span>)</button>
            <button class="chip-btn" id="chipUsers" onclick="filterSearchType('users')">Contributors (<span id="countSearchUsers">0</span>)</button>
            <button class="chip-btn" id="chipRepos" onclick="filterSearchType('repos')">Repositories (<span id="countSearchRepos">0</span>)</button>
          </div>
        </div>
        <div id="searchResultsContent" style="padding: 16px;"></div>
      </div>
    </main>

    <!-- VIEW 1: REPOSITORIES VIEW -->
    <main id="viewRepos" class="view-panel" role="region" aria-label="Repositories Overview">
      <!-- Repo KPI Counters -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value">{totalRepos}</div>
          <div class="metric-label">Repositories</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{totalBranches}</div>
          <div class="metric-label">Total Branches</div>
        </div>
        <div class="metric-card">
          <div class="metric-value {(totalStaleBranches > 0 ? "warning" : "")}">{totalStaleBranches}</div>
          <div class="metric-label">Stale Branches</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{totalOpenPrs}</div>
          <div class="metric-label">Open PRs</div>
        </div>
        <div class="metric-card">
          <div class="metric-value {(totalStalePrs > 0 ? "warning" : "")}">{totalStalePrs}</div>
          <div class="metric-label">Inactive PRs</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">{totalDraftPrs}</div>
          <div class="metric-label">Draft PRs</div>
        </div>
      </div>

      <!-- Overview Table -->
      <div class="section-card">
        <div class="section-header">
          <h2>Repositories Overview</h2>
        </div>
        <div style="overflow-x: auto;">
          <table aria-label="Repositories Table">
            <thead>
              <tr>
                <th scope="col">Repository</th>
                <th scope="col" style="text-align: center;">Branches</th>
                <th scope="col" style="text-align: center;">Stale Branches</th>
                <th scope="col" style="text-align: center;">Open PRs</th>
                <th scope="col" style="text-align: center;">Inactive PRs</th>
                <th scope="col" style="text-align: center;">Draft PRs</th>
                <th scope="col" style="text-align: center;">Health Status</th>
                <th scope="col" style="text-align: center;">Action</th>
              </tr>
            </thead>
            <tbody>
""");

        if (results.Count == 0)
        {
            sb.Append("              <tr><td colspan=\"8\" class=\"empty-state\">No repositories analyzed yet. Click \"Run Report Now\" above!</td></tr>\n");
        }
        else
        {
            foreach (var r in results)
            {
                var safeName = WebUtility.HtmlEncode(r.FullName);
                var anchor = $"repo-{safeName.Replace('/', '-')}";
                var badgeClass = "badge-healthy";
                var badgeLabel = "✔ Healthy";
                if (r.StaleBranchesCount > 10 || r.StalePrsCount > 5)
                {
                    badgeClass = "badge-danger";
                    badgeLabel = "🛑 Needs Cleanup";
                }
                else if (r.StaleBranchesCount > 0 || r.StalePrsCount > 0)
                {
                    badgeClass = "badge-warning";
                    badgeLabel = "⚠️ Attention";
                }

                var staleBranchCell = r.StaleBranchesCount > 0
                    ? $"<span class=\"badge badge-warning\">🍂 {r.StaleBranchesCount}</span>"
                    : "0";

                var stalePrCell = r.StalePrsCount > 0
                    ? $"<span class=\"badge badge-warning\">⏳ {r.StalePrsCount}</span>"
                    : "0";

                sb.Append($"""
              <tr>
                <td><strong><a href="#{anchor}">{safeName}</a></strong></td>
                <td style="text-align: center;">{r.TotalBranches}</td>
                <td style="text-align: center;">{staleBranchCell}</td>
                <td style="text-align: center;">{r.TotalOpenPrs}</td>
                <td style="text-align: center;">{stalePrCell}</td>
                <td style="text-align: center;">{r.DraftPrsCount}</td>
                <td style="text-align: center;"><span class="badge {badgeClass}">{badgeLabel}</span></td>
                <td style="text-align: center;">
                  <button class="btn btn-secondary" style="padding: 2px 7px; font-size: 11px; cursor: pointer;" onclick="handleRemoveRepo('{safeName}')" title="Stop tracking {safeName}" aria-label="Remove repository {safeName}">🗑️</button>
                </td>
              </tr>
""");
            }
        }

        sb.Append("""
            </tbody>
          </table>
        </div>
      </div>

      <!-- Repo Detail Cards -->
      <div id="repoCardsContainer">
""");

        foreach (var r in results)
        {
            var safeName = WebUtility.HtmlEncode(r.FullName);
            var anchor = $"repo-{safeName.Replace('/', '-')}";
            var githubUrl = $"https://github.com/{safeName}";
            var visibility = r.IsPrivate ? "Private" : "Public";

            sb.Append($"""
        <div class="detail-card" id="{anchor}">
          <div class="detail-card-header">
            <div class="card-title">
              <a href="{githubUrl}" target="_blank" rel="noopener noreferrer">{safeName}</a>
            </div>
            <div>
              <span class="badge badge-tag">default: {WebUtility.HtmlEncode(r.DefaultBranch)}</span>
              <span class="badge badge-tag">{visibility}</span>
              <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-left: 8px; cursor: pointer;" onclick="handleRemoveRepo('{safeName}')" aria-label="Remove repository {safeName}">🗑️ Remove</button>
            </div>
          </div>

          <!-- Stale Branches -->
          <div class="sub-section">
            <div class="sub-title">🍂 Stale Branches ({r.StaleBranches.Count})</div>
""");

            if (r.StaleBranches.Count == 0)
            {
                sb.Append("            <div class=\"empty-state\">No stale branches found!</div>\n");
            }
            else
            {
                sb.Append($"""
            <div style="overflow-x: auto;">
              <table aria-label="Stale Branches for {safeName}">
                <thead>
                  <tr>
                    <th scope="col">Branch</th>
                    <th scope="col" style="text-align: center;">Inactive Days</th>
                    <th scope="col">Last Author</th>
                    <th scope="col" style="text-align: center;">Open PR?</th>
                  </tr>
                </thead>
                <tbody>
""");
                foreach (var b in r.StaleBranches)
                {
                    var branchUrl = $"{githubUrl}/tree/{Uri.EscapeDataString(b.Name)}";
                    var badgeColor = b.IsVeryStale ? "badge-danger" : "badge-warning";
                    var authorAvatar = !string.IsNullOrEmpty(b.Author) && b.Author != "unknown"
                        ? $"https://github.com/{Uri.EscapeDataString(b.Author)}.png?size=40"
                        : "";
                    var safeAuthor = WebUtility.HtmlEncode(b.Author);
                    var avatarImg = !string.IsNullOrEmpty(authorAvatar)
                        ? $"<img src=\"{authorAvatar}\" class=\"user-avatar\" alt=\"\" onerror=\"this.style.display='none'\">"
                        : "";

                    var prBadge = b.HasOpenPr
                        ? "<span class=\"badge badge-healthy\">✔ Yes</span>"
                        : "<span style=\"color: var(--text-muted)\">No</span>";

                    sb.Append($"""
                  <tr>
                    <td><a href="{branchUrl}" target="_blank" rel="noopener noreferrer"><code>{WebUtility.HtmlEncode(b.Name)}</code></a></td>
                    <td style="text-align: center;"><span class="badge {badgeColor}">{b.DaysInactive} days</span></td>
                    <td>
                      <div class="user-flex">
                        {avatarImg}
                        <a href="https://github.com/{safeAuthor}" target="_blank" rel="noopener noreferrer">{safeAuthor}</a>
                      </div>
                    </td>
                    <td style="text-align: center;">{prBadge}</td>
                  </tr>
""");
                }
                sb.Append("                </tbody>\n              </table>\n            </div>\n");
            }

            sb.Append($"""
          </div>

          <!-- Open PRs -->
          <div class="sub-section" style="border-top: 1px solid var(--border);">
            <div class="sub-title">🔀 Open Pull Requests ({r.PullRequests.Count})</div>
""");

            if (r.PullRequests.Count == 0)
            {
                sb.Append("            <div class=\"empty-state\">No open pull requests.</div>\n");
            }
            else
            {
                sb.Append($"""
            <div style="overflow-x: auto;">
              <table aria-label="Open Pull Requests for {safeName}">
                <thead>
                  <tr>
                    <th scope="col">PR</th>
                    <th scope="col">Title</th>
                    <th scope="col">Author</th>
                    <th scope="col" style="text-align: center;">Age</th>
                    <th scope="col" style="text-align: center;">Last Active</th>
                    <th scope="col" style="text-align: center;">Status</th>
                  </tr>
                </thead>
                <tbody>
""");
                foreach (var pr in r.PullRequests)
                {
                    var prAuthorAvatar = !string.IsNullOrEmpty(pr.Author) && pr.Author != "unknown"
                        ? $"https://github.com/{Uri.EscapeDataString(pr.Author)}.png?size=40"
                        : "";
                    var safeAuthor = WebUtility.HtmlEncode(pr.Author);
                    var avatarImg = !string.IsNullOrEmpty(prAuthorAvatar)
                        ? $"<img src=\"{prAuthorAvatar}\" class=\"user-avatar\" alt=\"\" onerror=\"this.style.display='none'\">"
                        : "";

                    var activeText = pr.IsStalePr
                        ? $"<span class=\"badge badge-warning\">⏳ {pr.DaysSinceLastUpdate}d ago</span>"
                        : $"{pr.DaysSinceLastUpdate}d ago";

                    var statusText = pr.IsDraft
                        ? "<span class=\"badge badge-draft\">Draft</span>"
                        : "<span class=\"badge badge-healthy\">✔ Ready</span>";

                    sb.Append($"""
                  <tr>
                    <td><a href="{WebUtility.HtmlEncode(pr.Url)}" target="_blank" rel="noopener noreferrer"><strong>#{pr.Number}</strong></a></td>
                    <td><a href="{WebUtility.HtmlEncode(pr.Url)}" target="_blank" rel="noopener noreferrer">{WebUtility.HtmlEncode(pr.Title)}</a></td>
                    <td>
                      <div class="user-flex">
                        {avatarImg}
                        <a href="https://github.com/{safeAuthor}" target="_blank" rel="noopener noreferrer">{safeAuthor}</a>
                      </div>
                    </td>
                    <td style="text-align: center;">{pr.AgeDays}d</td>
                    <td style="text-align: center;">{activeText}</td>
                    <td style="text-align: center;">{statusText}</td>
                  </tr>
""");
                }
                sb.Append("                </tbody>\n              </table>\n            </div>\n");
            }

            sb.Append("          </div>\n        </div>\n");
        }

        sb.Append($"""
      </div>
    </main>

    <!-- VIEW 2: CONTRIBUTOR ACTIVITIES VIEW -->
    <main id="viewUsers" class="view-panel hidden scope-all-time" role="region" aria-label="Contributor Activities">
      <!-- User KPI Counters -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value">{totalContributors}</div>
          <div class="metric-label">Contributors Analyzed</div>
        </div>
        <div class="metric-card">
          <div class="metric-value" style="color: #a855f7;">{totalAllPrs}</div>
          <div class="metric-label">All-Time PRs ({totalMergedPrs} Merged)</div>
        </div>
        <div class="metric-card">
          <div class="metric-value {(contributorsWithStaleBranches > 0 ? "warning" : "")}">{contributorsWithStaleBranches}</div>
          <div class="metric-label">Users w/ Stale Branches</div>
        </div>
        <div class="metric-card">
          <div class="metric-value {(totalReviewItems > 0 ? "warning" : "")}">{totalReviewItems}</div>
          <div class="metric-label">Items Needing Review</div>
        </div>
      </div>

      <!-- Scope Toolbar & Option Switcher -->
      <div class="scope-toolbar">
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
          <span style="font-weight: 700; font-size: 14px; color: var(--header-text); display: inline-flex; align-items: center; gap: 6px;">
            <span>⏱️</span> Contributor Detail Option:
          </span>
          <div class="scope-control" role="group" aria-label="Contributor Activity Option">
            <button type="button" class="scope-btn active" id="btnScopeAllTime" onclick="setContributorScope('all_time')">
              🌐 All Times (Complete History)
            </button>
            <button type="button" class="scope-btn" id="btnScopeAttention" onclick="setContributorScope('attention')">
              ⚠️ Needs Attention Only
            </button>
          </div>
          <span id="scopeHint" style="font-size: 12px; color: var(--text-muted);">
            Showing full contributor history: merged, open, and closed PRs plus all branches.
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="text" id="filterContributorInput" class="search-input" style="width: 240px; padding: 6px 12px;" placeholder="Filter contributor by name..." oninput="filterContributorList(this.value)">
        </div>
      </div>

      <!-- Contributor Overview Table -->
      <div class="section-card">
        <div class="section-header">
          <h2>Contributor Leaderboard & Overview</h2>
        </div>
        <div style="overflow-x: auto;">
          <table aria-label="Contributor Leaderboard Table">
            <thead>
              <tr>
                <th scope="col">Contributor</th>
                <th scope="col">Repositories</th>
                <th scope="col" class="col-scope-all" style="text-align: center;">All-Time PRs</th>
                <th scope="col" class="col-scope-all" style="text-align: center;">All-Time Branches</th>
                <th scope="col" class="col-scope-all" style="text-align: center;">Merge Rate</th>
                <th scope="col" class="col-scope-attention" style="text-align: center;">Open PRs</th>
                <th scope="col" class="col-scope-attention" style="text-align: center;">Inactive PRs</th>
                <th scope="col" class="col-scope-attention" style="text-align: center;">Stale Branches</th>
                <th scope="col" style="text-align: center;">Status / Review</th>
                <th scope="col" style="text-align: center;">Details</th>
              </tr>
            </thead>
            <tbody>
""");

        if (userActivities.Count == 0)
        {
            sb.Append("              <tr><td colspan=\"10\" class=\"empty-state\">No contributors analyzed yet.</td></tr>\n");
        }
        else
        {
            foreach (var u in userActivities)
            {
                var safeUser = WebUtility.HtmlEncode(u.Username);
                var userAvatar = !string.IsNullOrEmpty(u.Username) && u.Username != "unknown"
                    ? $"https://github.com/{Uri.EscapeDataString(u.Username)}.png?size=40"
                    : "";
                var userAnchor = $"user-{safeUser.Replace('/', '-')}";
                var statusBadge = "<span class=\"badge badge-healthy\">✔ All Good</span>";
                if (u.TotalNeedsAttention > 5)
                {
                    statusBadge = $"<span class=\"badge badge-danger\">🛑 {u.TotalNeedsAttention} items</span>";
                }
                else if (u.TotalNeedsAttention > 0)
                {
                    statusBadge = $"<span class=\"badge badge-warning\">⚠️ {u.TotalNeedsAttention} items</span>";
                }

                var repoBadges = string.Join(" ", u.Repositories.Select(repo => $"<span class=\"badge badge-tag\">{WebUtility.HtmlEncode(repo)}</span>"));
                var rowScopeClass = u.TotalNeedsAttention == 0 ? "row-scope-all-only" : "";
                var avatarImg = !string.IsNullOrEmpty(userAvatar)
                    ? $"<img src=\"{userAvatar}\" class=\"user-avatar\" alt=\"\" onerror=\"this.style.display='none'\">"
                    : "";

                var rateStr = u.AcceptanceRate.HasValue ? $"<strong>{u.AcceptanceRate}%</strong>" : "<span style=\"color: var(--text-muted)\">—</span>";

                sb.Append($"""
              <tr class="contributor-row {rowScopeClass}" data-username="{WebUtility.HtmlEncode(u.Username.ToLowerInvariant())}">
                <td>
                  <div class="user-flex">
                    {avatarImg}
                    <strong><a href="https://github.com/{safeUser}" target="_blank" rel="noopener noreferrer">{safeUser}</a></strong>
                  </div>
                </td>
                <td>{repoBadges}</td>
                <td class="col-scope-all" style="text-align: center;">
                  <span class="badge badge-tag" title="Total All-Time PRs">{u.AllPrsCount} Total</span>
                  {(u.MergedPrsCount > 0 ? $"<span class=\"badge badge-merged\" title=\"Merged PRs\">🟣 {u.MergedPrsCount}</span>" : "")}
                  {(u.OpenPrsCount > 0 ? $"<span class=\"badge badge-healthy\" title=\"Open PRs\">🟢 {u.OpenPrsCount}</span>" : "")}
                  {(u.ClosedPrsCount > 0 ? $"<span class=\"badge badge-closed\" title=\"Closed PRs\">⚪ {u.ClosedPrsCount}</span>" : "")}
                </td>
                <td class="col-scope-all" style="text-align: center;">
                  <span class="badge badge-tag" title="Total Branches">{u.AllBranchesCount} Total</span>
                  {(u.ActiveBranchesCount > 0 ? $"<span class=\"badge badge-healthy\" title=\"Active Branches\">🟢 {u.ActiveBranchesCount}</span>" : "")}
                  {(u.StaleBranchesCount > 0 ? $"<span class=\"badge badge-warning\" title=\"Stale Branches\">🍂 {u.StaleBranchesCount}</span>" : "")}
                </td>
                <td class="col-scope-all" style="text-align: center;">{rateStr}</td>
                <td class="col-scope-attention" style="text-align: center;">{u.OpenPrsCount}</td>
                <td class="col-scope-attention" style="text-align: center;">{(u.StalePrsCount > 0 ? $"<span class=\"badge badge-warning\">⏳ {u.StalePrsCount}</span>" : "0")}</td>
                <td class="col-scope-attention" style="text-align: center;">{(u.StaleBranchesCount > 0 ? $"<span class=\"badge badge-danger\">🍂 {u.StaleBranchesCount}</span>" : "0")}</td>
                <td style="text-align: center;">{statusBadge}</td>
                <td style="text-align: center;"><a href="#{userAnchor}">View breakdown →</a></td>
              </tr>
""");
            }
        }

        sb.Append("""
            </tbody>
          </table>
        </div>
      </div>

      <!-- Contributor Detail Cards -->
      <div id="userCardsContainer">
""");

        foreach (var u in userActivities)
        {
            var safeUser = WebUtility.HtmlEncode(u.Username);
            var userAnchor = $"user-{safeUser.Replace('/', '-')}";
            var userAvatar = !string.IsNullOrEmpty(u.Username) && u.Username != "unknown"
                ? $"https://github.com/{Uri.EscapeDataString(u.Username)}.png?size=64"
                : "";
            var cardScopeClass = u.TotalNeedsAttention == 0 ? "card-scope-all-only" : "";
            var statusHeaderBadge = u.TotalNeedsAttention > 0
                ? $"<span class=\"badge badge-warning\">⚠️ {u.TotalNeedsAttention} items to review</span>"
                : "<span class=\"badge badge-healthy\">✔ Active & Healthy</span>";

            var repoBadges = string.Join(" ", u.Repositories.Select(repo => $"<span class=\"badge badge-tag\">{WebUtility.HtmlEncode(repo)}</span>"));
            var avatarImg = !string.IsNullOrEmpty(userAvatar)
                ? $"<img src=\"{userAvatar}\" class=\"user-avatar\" style=\"width: 36px; height: 36px;\" alt=\"\" onerror=\"this.style.display='none'\">"
                : "";

            var allPrs = u.AuthoredPrs;
            var openPrs = allPrs.Where(p => p.State == "OPEN").ToList();
            var mergedPrs = allPrs.Where(p => p.State == "MERGED").ToList();
            var closedPrs = allPrs.Where(p => p.State == "CLOSED").ToList();

            var allBranches = u.AllBranches;
            var staleBranches = u.StaleBranches;
            var activeBranches = allBranches.Where(b => !b.IsStale).ToList();

            sb.Append($"""
        <div class="detail-card contributor-card {cardScopeClass}" id="{userAnchor}" data-username="{WebUtility.HtmlEncode(u.Username.ToLowerInvariant())}">
          <div class="detail-card-header">
            <div class="card-title">
              <div class="user-flex">
                {avatarImg}
                <div>
                  <a href="https://github.com/{safeUser}" target="_blank" rel="noopener noreferrer">{safeUser}</a>
                  <div style="font-size: 12px; font-weight: normal; color: var(--text-muted); margin-top: 2px;">
                    {repoBadges}
                  </div>
                </div>
              </div>
            </div>
            <div>{statusHeaderBadge}</div>
          </div>

          <!-- Summary Bar -->
          <div class="user-all-time-summary" style="padding: 12px 20px; background: var(--table-hover); border-bottom: 1px solid var(--border);">
            <div class="summary-pill">
              <span style="color: var(--text-muted)">All-Time PRs:</span>
              <strong>{u.AllPrsCount}</strong>
              <span class="sub-stat">({u.MergedPrsCount} merged, {u.OpenPrsCount} open, {u.ClosedPrsCount} closed)</span>
            </div>
            <div class="summary-pill">
              <span style="color: var(--text-muted)">All-Time Branches:</span>
              <strong>{u.AllBranchesCount}</strong>
              <span class="sub-stat">({u.ActiveBranchesCount} active, {u.StaleBranchesCount} stale)</span>
            </div>
            {(u.AcceptanceRate.HasValue ? $"<div class=\"summary-pill\"><span style=\"color: var(--text-muted)\">Acceptance Rate:</span><strong style=\"color: var(--success);\">{u.AcceptanceRate}%</strong></div>" : "")}
          </div>

          <!-- Pull Requests Section -->
          <div class="sub-section">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
              <div class="sub-title" style="margin-bottom: 0;">🔀 Pull Requests ({allPrs.Count})</div>
              <div class="card-filter-tabs" id="prTabs_{userAnchor}">
                <button type="button" class="card-tab-btn active" onclick="filterUserPrs('{userAnchor}', 'all')">All ({allPrs.Count})</button>
                <button type="button" class="card-tab-btn" onclick="filterUserPrs('{userAnchor}', 'OPEN')">Open ({openPrs.Count})</button>
                <button type="button" class="card-tab-btn" onclick="filterUserPrs('{userAnchor}', 'MERGED')">Merged ({mergedPrs.Count})</button>
                <button type="button" class="card-tab-btn" onclick="filterUserPrs('{userAnchor}', 'CLOSED')">Closed ({closedPrs.Count})</button>
              </div>
            </div>
""");

            if (allPrs.Count == 0)
            {
                sb.Append($"            <div class=\"empty-state\">No pull requests authored by {safeUser}.</div>\n");
            }
            else
            {
                sb.Append($"""
            <div style="overflow-x: auto;">
              <table aria-label="Pull Requests for {safeUser}" id="prTable_{userAnchor}">
                <thead>
                  <tr>
                    <th scope="col">Repository</th>
                    <th scope="col">PR</th>
                    <th scope="col">Title</th>
                    <th scope="col" style="text-align: center;">Status</th>
                    <th scope="col" style="text-align: center;">Created</th>
                    <th scope="col" style="text-align: center;">Closed / Merged</th>
                    <th scope="col" style="text-align: center;">Age / Inactivity</th>
                  </tr>
                </thead>
                <tbody>
""");
                foreach (var pr in allPrs)
                {
                    var stateBadge = "<span class=\"badge badge-healthy\">🟢 Open</span>";
                    if (pr.State == "MERGED") stateBadge = "<span class=\"badge badge-merged\">🟣 Merged</span>";
                    else if (pr.State == "CLOSED") stateBadge = "<span class=\"badge badge-closed\">⚪ Closed</span>";
                    if (pr.IsDraft) stateBadge += " <span class=\"badge badge-draft\">Draft</span>";

                    var closedDate = pr.MergedAt.HasValue
                        ? FormatDate(pr.MergedAt)
                        : (pr.ClosedAt.HasValue ? FormatDate(pr.ClosedAt) : "—");

                    var ageStr = pr.State == "OPEN" && pr.IsStalePr
                        ? $"<span class=\"badge badge-warning\">⏳ {pr.DaysSinceLastUpdate}d inactive</span>"
                        : $"{pr.AgeDays}d old";

                    sb.Append($"""
                  <tr class="user-pr-row" data-state="{pr.State}">
                    <td><span class="badge badge-tag">{WebUtility.HtmlEncode(pr.RepoFullName)}</span></td>
                    <td><a href="{WebUtility.HtmlEncode(pr.Url)}" target="_blank" rel="noopener noreferrer"><strong>#{pr.Number}</strong></a></td>
                    <td><a href="{WebUtility.HtmlEncode(pr.Url)}" target="_blank" rel="noopener noreferrer">{WebUtility.HtmlEncode(pr.Title)}</a></td>
                    <td style="text-align: center;">{stateBadge}</td>
                    <td style="text-align: center;">{FormatDate(pr.CreatedAt)}</td>
                    <td style="text-align: center;">{closedDate}</td>
                    <td style="text-align: center;">{ageStr}</td>
                  </tr>
""");
                }
                sb.Append("                </tbody>\n              </table>\n            </div>\n");
            }

            sb.Append($"""
          </div>

          <!-- Branches Section -->
          <div class="sub-section" style="border-top: 1px solid var(--border);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
              <div class="sub-title" style="margin-bottom: 0;">🍂 Branches ({allBranches.Count})</div>
              <div class="card-filter-tabs" id="branchTabs_{userAnchor}">
                <button type="button" class="card-tab-btn active" onclick="filterUserBranches('{userAnchor}', 'all')">All ({allBranches.Count})</button>
                <button type="button" class="card-tab-btn" onclick="filterUserBranches('{userAnchor}', 'active')">Active ({activeBranches.Count})</button>
                <button type="button" class="card-tab-btn" onclick="filterUserBranches('{userAnchor}', 'stale')">Stale ({staleBranches.Count})</button>
              </div>
            </div>
""");

            if (allBranches.Count == 0)
            {
                sb.Append($"            <div class=\"empty-state\">No branches authored by {safeUser}.</div>\n");
            }
            else
            {
                sb.Append($"""
            <div style="overflow-x: auto;">
              <table aria-label="Branches for {safeUser}" id="branchTable_{userAnchor}">
                <thead>
                  <tr>
                    <th scope="col">Repository</th>
                    <th scope="col">Branch</th>
                    <th scope="col" style="text-align: center;">Status</th>
                    <th scope="col" style="text-align: center;">Last Commit</th>
                    <th scope="col" style="text-align: center;">Inactive Days</th>
                    <th scope="col" style="text-align: center;">Has Open PR?</th>
                  </tr>
                </thead>
                <tbody>
""");
                foreach (var b in allBranches)
                {
                    var branchUrl = $"https://github.com/{WebUtility.HtmlEncode(b.RepoFullName)}/tree/{Uri.EscapeDataString(b.Name)}";
                    var statusBadge = "<span class=\"badge badge-healthy\">🟢 Active</span>";
                    if (b.IsVeryStale) statusBadge = "<span class=\"badge badge-danger\">🛑 Very Stale</span>";
                    else if (b.IsStale) statusBadge = "<span class=\"badge badge-warning\">🍂 Stale</span>";

                    var hasPr = b.HasOpenPr
                        ? "<span class=\"badge badge-healthy\">✔ Yes</span>"
                        : "<span style=\"color: var(--text-muted)\">No</span>";

                    var inactiveDays = b.DaysInactive.HasValue ? $"{b.DaysInactive}d" : "Active";

                    sb.Append($"""
                  <tr class="user-branch-row" data-status="{(b.IsStale ? "stale" : "active")}">
                    <td><span class="badge badge-tag">{WebUtility.HtmlEncode(b.RepoFullName)}</span></td>
                    <td><a href="{branchUrl}" target="_blank" rel="noopener noreferrer"><code>{WebUtility.HtmlEncode(b.Name)}</code></a></td>
                    <td style="text-align: center;">{statusBadge}</td>
                    <td style="text-align: center;">{FormatDate(b.LastCommitDate)}</td>
                    <td style="text-align: center;">{inactiveDays}</td>
                    <td style="text-align: center;">{hasPr}</td>
                  </tr>
""");
                }
                sb.Append("                </tbody>\n              </table>\n            </div>\n");
            }

            sb.Append("          </div>\n        </div>\n");
        }

        sb.Append("""
      </div>
    </main>

    <footer role="contentinfo">
      Generated with <strong>fluffy-sniffle</strong> • .NET 10 GitHub Repository & Contributor Health Analyzer
    </footer>
  </div>

  <div id="toast" class="toast hidden"></div>

  <script>
""");
        sb.Append(clientScript);
        sb.Append("""

  </script>
</body>
</html>
""");

        return sb.ToString();
    }

    public (string LatestPath, string ArchivePath) SaveHtmlReport(
        List<RepositoryHealthResult> results,
        List<ContributorActivity> userActivities,
        string? lastScanTime = null,
        List<FailedRepoInfo>? failedRepos = null,
        bool isDev = false,
        string outputDir = "reports")
    {
        if (!Directory.Exists(outputDir))
        {
            Directory.CreateDirectory(outputDir);
        }

        AppLogger.Action("Generate HTML Dashboard", $"Rendering dashboard for {results.Count} repos and {userActivities.Count} contributors");
        var html = GenerateHtmlReport(results, userActivities, lastScanTime, failedRepos, isDev);

        var dateStr = DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss");
        var archivePath = Path.Combine(outputDir, $"repo-health-{dateStr}.html");
        File.WriteAllText(archivePath, html, Encoding.UTF8);
        AppLogger.Info($"Saved HTML report archive: {archivePath}");

        var latestPath = Path.Combine(outputDir, "index.html");
        File.WriteAllText(latestPath, html, Encoding.UTF8);
        AppLogger.Success($"Updated primary dashboard: {latestPath} ({Encoding.UTF8.GetByteCount(html)} bytes)");

        return (latestPath, archivePath);
    }
}
