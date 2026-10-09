import fs from 'fs';
import path from 'path';

/**
 * Escapes HTML characters
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate complete self-contained HTML dashboard with Repository & User views and Global Item Search
 */
export function generateHtmlReport(results = [], userActivities = [], metadata = {}) {
  const generatedAt = metadata.lastScanTime ? new Date(metadata.lastScanTime).toUTCString() : new Date().toUTCString();

  // Aggregate repo metrics
  const totalRepos = results.length;
  const totalBranches = results.reduce((acc, r) => acc + (r.totalBranches || 0), 0);
  const totalStaleBranches = results.reduce((acc, r) => acc + (r.staleBranchesCount || 0), 0);
  const totalOpenPrs = results.reduce((acc, r) => acc + (r.totalOpenPrs || 0), 0);
  const totalStalePrs = results.reduce((acc, r) => acc + (r.stalePrsCount || 0), 0);
  const totalDraftPrs = results.reduce((acc, r) => acc + (r.draftPrsCount || 0), 0);

  // Aggregate user metrics
  const totalContributors = userActivities.length;
  const contributorsWithStaleBranches = userActivities.filter((u) => u.staleBranchesCount > 0).length;
  const contributorsWithStalePrs = userActivities.filter((u) => u.stalePrsCount > 0).length;
  const totalReviewItems = userActivities.reduce((acc, u) => acc + u.totalNeedsAttention, 0);

  // Safe JSON serialization of dashboard data for client-side search engine
  const dashboardDataJson = JSON.stringify({ results, userActivities }).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Repository & Contributor Health Dashboard</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text-main: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --success: #238636;
      --success-light: #2ea043;
      --warning: #d29922;
      --warning-bg: rgba(210, 153, 34, 0.15);
      --danger: #f85149;
      --danger-bg: rgba(248, 81, 73, 0.15);
      --badge-draft: #6e7681;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      padding: 24px;
    }

    .container {
      max-width: 1350px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }

    .header-title h1 {
      font-size: 26px;
      font-weight: 700;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .header-title p {
      color: var(--text-muted);
      font-size: 13px;
      margin-top: 4px;
    }

    .controls {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    /* Enhanced Search Input */
    .search-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-width: 340px;
    }

    .search-input {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #fff;
      padding: 8px 32px 8px 12px;
      font-size: 13px;
      outline: none;
      width: 100%;
      transition: all 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
    }

    .search-clear-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 14px;
      cursor: pointer;
      display: none;
      padding: 2px;
      line-height: 1;
    }

    .search-clear-btn:hover {
      color: #fff;
    }

    mark {
      background: rgba(255, 212, 59, 0.35);
      color: #fff;
      padding: 1px 3px;
      border-radius: 3px;
    }

    /* Buttons */
    .btn {
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
      border: 1px solid transparent;
      user-select: none;
    }

    .btn-primary {
      background: var(--success);
      color: #fff;
      border-color: var(--success-light);
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--success-light);
    }

    .btn-primary:disabled {
      background: rgba(35, 134, 54, 0.4);
      cursor: not-allowed;
      opacity: 0.8;
    }

    .btn-secondary {
      background: var(--card-bg);
      border-color: var(--border);
      color: var(--text-main);
    }

    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
    }

    .spinning {
      display: inline-block;
      animation: spin 1s infinite linear;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      background: #1f6feb;
      color: #fff;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5);
      z-index: 1000;
      transition: opacity 0.3s, transform 0.3s;
    }

    .toast.hidden {
      opacity: 0;
      transform: translateY(20px);
      pointer-events: none;
    }

    /* View Switcher Tabs */
    .view-switcher {
      display: flex;
      gap: 10px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
      flex-wrap: wrap;
      align-items: center;
    }

    .view-btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text-muted);
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }

    .view-btn:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }

    .view-btn.active {
      background: rgba(88, 166, 255, 0.15);
      border-color: var(--accent);
      color: #fff;
    }

    .view-btn .pill {
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 7px;
      border-radius: 10px;
      font-size: 12px;
    }

    /* Metric Counters */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }

    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
      transition: transform 0.15s ease;
    }

    .metric-card:hover {
      transform: translateY(-2px);
    }

    .metric-value {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
    }

    .metric-value.warning {
      color: var(--warning);
    }

    .metric-value.danger {
      color: var(--danger);
    }

    .metric-label {
      font-size: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }

    /* Tables */
    .section-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 28px;
      overflow: hidden;
    }

    .section-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: rgba(255, 255, 255, 0.02);
      flex-wrap: wrap;
      gap: 10px;
    }

    .section-header h2 {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }

    th {
      background: rgba(255, 255, 255, 0.03);
      color: var(--text-muted);
      font-weight: 600;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      color: var(--text-main);
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    a {
      color: var(--accent);
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .badge-healthy {
      background: rgba(46, 160, 67, 0.2);
      color: var(--success-light);
      border: 1px solid var(--success);
    }

    .badge-warning {
      background: var(--warning-bg);
      color: var(--warning);
      border: 1px solid var(--warning);
    }

    .badge-danger {
      background: var(--danger-bg);
      color: var(--danger);
      border: 1px solid var(--danger);
    }

    .badge-draft {
      background: rgba(110, 118, 129, 0.2);
      color: var(--badge-draft);
      border: 1px solid var(--badge-draft);
    }

    .badge-tag {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent);
      border: 1px solid rgba(88, 166, 255, 0.3);
      font-family: monospace;
      margin-right: 4px;
      margin-bottom: 4px;
    }

    /* Card Details */
    .detail-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 24px;
      overflow: hidden;
    }

    .detail-card-header {
      padding: 16px 20px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .sub-section {
      padding: 20px;
    }

    .sub-title {
      font-size: 15px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .empty-state {
      padding: 24px;
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
      background: rgba(0, 0, 0, 0.1);
      border-radius: 6px;
    }

    /* Avatar */
    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      vertical-align: middle;
      border: 1px solid var(--border);
      object-fit: cover;
    }

    .user-flex {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .view-panel {
      display: block;
    }

    .view-panel.hidden {
      display: none;
    }

    /* Filter Chips */
    .filter-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .chip-btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .chip-btn:hover {
      color: #fff;
      border-color: var(--text-muted);
    }

    .chip-btn.active {
      background: rgba(88, 166, 255, 0.2);
      border-color: var(--accent);
      color: var(--accent);
    }

    footer {
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-title">
        <h1>📊 GitHub Health & Contributor Dashboard</h1>
        <p id="lastScannedText">Last scanned: ${escapeHtml(generatedAt)}</p>
      </div>

      <div class="controls">
        <!-- Add Repo Form -->
        <input type="text" id="newRepoInput" class="search-input" placeholder="Add repo: owner/repo" style="width: 170px;">
        <button class="btn btn-secondary" id="addRepoBtn" onclick="handleAddRepo()">➕ Add</button>

        <!-- Trigger Scan Button -->
        <button class="btn btn-primary" id="triggerScanBtn" onclick="triggerScan()">
          <span id="scanBtnIcon">🔄</span> <span id="scanBtnText">Run Report Now</span>
        </button>

        <!-- Search Input with Clear Button -->
        <div class="search-wrapper">
          <input type="text" id="searchInput" class="search-input" placeholder="🔍 Search all items (PR, branch, user, repo)... [/]" autocomplete="off">
          <button id="searchClearBtn" class="search-clear-btn" onclick="clearSearch()" title="Clear search (Esc)">✕</button>
        </div>
      </div>
    </header>

    <!-- Top View Switcher Tabs -->
    <div class="view-switcher" id="mainViewSwitcher">
      <button class="view-btn active" id="btnViewRepos" onclick="switchView('repos')">
        🏢 Repositories View <span class="pill" id="badgeTotalRepos">${totalRepos}</span>
      </button>
      <button class="view-btn" id="btnViewUsers" onclick="switchView('users')">
        👤 Contributor Activities <span class="pill" id="badgeTotalContributors">${totalContributors}</span>
      </button>
    </div>

    <!-- ============================================== -->
    <!-- VIEW 3: SEARCH RESULTS VIEW (Appears on search)-->
    <!-- ============================================== -->
    <div id="viewSearch" class="view-panel hidden">
      <div class="section-card">
        <div class="section-header">
          <div>
            <h2 id="searchSummaryTitle">🔍 Search Results</h2>
            <p id="searchSummarySubtitle" style="font-size: 13px; color: var(--text-muted); margin-top: 2px;"></p>
          </div>
          <div class="filter-chips">
            <button class="chip-btn active" id="chipAll" onclick="filterSearchType('all')">All (<span id="countSearchAll">0</span>)</button>
            <button class="chip-btn" id="chipPrs" onclick="filterSearchType('prs')">Pull Requests (<span id="countSearchPrs">0</span>)</button>
            <button class="chip-btn" id="chipBranches" onclick="filterSearchType('branches')">Branches (<span id="countSearchBranches">0</span>)</button>
            <button class="chip-btn" id="chipUsers" onclick="filterSearchType('users')">Contributors (<span id="countSearchUsers">0</span>)</button>
            <button class="chip-btn" id="chipRepos" onclick="filterSearchType('repos')">Repositories (<span id="countSearchRepos">0</span>)</button>
          </div>
        </div>
        <div id="searchResultsContent" style="padding: 16px;"></div>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- VIEW 1: REPOSITORIES VIEW                      -->
    <!-- ============================================== -->
    <div id="viewRepos" class="view-panel">
      <!-- Repo KPI Counters -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value">${totalRepos}</div>
          <div class="metric-label">Repositories</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${totalBranches}</div>
          <div class="metric-label">Total Branches</div>
        </div>
        <div class="metric-card">
          <div class="metric-value ${totalStaleBranches > 0 ? 'warning' : ''}">${totalStaleBranches}</div>
          <div class="metric-label">Stale Branches</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${totalOpenPrs}</div>
          <div class="metric-label">Open PRs</div>
        </div>
        <div class="metric-card">
          <div class="metric-value ${totalStalePrs > 0 ? 'warning' : ''}">${totalStalePrs}</div>
          <div class="metric-label">Inactive PRs</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${totalDraftPrs}</div>
          <div class="metric-label">Draft PRs</div>
        </div>
      </div>

      <!-- Overview Table -->
      <div class="section-card">
        <div class="section-header">
          <h2>Repositories Overview</h2>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Repository</th>
                <th style="text-align: center;">Branches</th>
                <th style="text-align: center;">Stale Branches</th>
                <th style="text-align: center;">Open PRs</th>
                <th style="text-align: center;">Inactive PRs</th>
                <th style="text-align: center;">Draft PRs</th>
                <th style="text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${results.length === 0 ? `
                <tr><td colspan="7" class="empty-state">No repositories analyzed yet. Click "Run Report Now" above!</td></tr>
              ` : results.map((r) => {
                let badgeClass = 'badge-healthy';
                let badgeLabel = 'Healthy';
                if (r.staleBranchesCount > 10 || r.stalePrsCount > 5) {
                  badgeClass = 'badge-danger';
                  badgeLabel = 'Needs Cleanup';
                } else if (r.staleBranchesCount > 0 || r.stalePrsCount > 0) {
                  badgeClass = 'badge-warning';
                  badgeLabel = 'Attention';
                }

                return `
                  <tr>
                    <td><strong><a href="#repo-${escapeHtml(r.fullName.replace('/', '-'))}">${escapeHtml(r.fullName)}</a></strong></td>
                    <td style="text-align: center;">${r.totalBranches}</td>
                    <td style="text-align: center;">
                      ${r.staleBranchesCount > 0 ? `<span class="badge badge-warning">${r.staleBranchesCount}</span>` : '0'}
                    </td>
                    <td style="text-align: center;">${r.totalOpenPrs}</td>
                    <td style="text-align: center;">
                      ${r.stalePrsCount > 0 ? `<span class="badge badge-warning">${r.stalePrsCount}</span>` : '0'}
                    </td>
                    <td style="text-align: center;">${r.draftPrsCount}</td>
                    <td style="text-align: center;"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Repo Detail Cards -->
      <div id="repoCardsContainer">
        ${results.map((r) => {
          const repoAnchor = `repo-${escapeHtml(r.fullName.replace('/', '-'))}`;
          const repoGithubUrl = `https://github.com/${escapeHtml(r.fullName)}`;

          return `
            <div class="detail-card" id="${repoAnchor}">
              <div class="detail-card-header">
                <div class="card-title">
                  <a href="${repoGithubUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.fullName)}</a>
                </div>
                <div>
                  <span class="badge badge-tag">default: ${escapeHtml(r.defaultBranch)}</span>
                  <span class="badge badge-tag">${r.isPrivate ? 'Private' : 'Public'}</span>
                </div>
              </div>

              <!-- Stale Branches -->
              <div class="sub-section">
                <div class="sub-title">🍂 Stale Branches (${r.staleBranches.length})</div>
                ${r.staleBranches.length === 0 ? `
                  <div class="empty-state">No stale branches found!</div>
                ` : `
                  <div style="overflow-x: auto;">
                    <table>
                      <thead>
                        <tr>
                          <th>Branch</th>
                          <th style="text-align: center;">Inactive Days</th>
                          <th>Last Author</th>
                          <th style="text-align: center;">Open PR?</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${r.staleBranches.map((b) => {
                          const branchUrl = `${repoGithubUrl}/tree/${encodeURIComponent(b.name)}`;
                          const badgeColor = b.isVeryStale ? 'badge-danger' : 'badge-warning';
                          const authorAvatar = b.author && b.author !== 'unknown' ? `https://github.com/${encodeURIComponent(b.author)}.png?size=40` : '';
                          return `
                            <tr>
                              <td><a href="${branchUrl}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(b.name)}</code></a></td>
                              <td style="text-align: center;"><span class="badge ${badgeColor}">${b.daysInactive} days</span></td>
                              <td>
                                <div class="user-flex">
                                  ${authorAvatar ? `<img src="${authorAvatar}" class="user-avatar" onerror="this.style.display='none'">` : ''}
                                  <a href="https://github.com/${escapeHtml(b.author)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.author)}</a>
                                </div>
                              </td>
                              <td style="text-align: center;">
                                ${b.hasOpenPr ? '<span class="badge badge-healthy">Yes</span>' : '<span style="color: var(--text-muted)">No</span>'}
                              </td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                `}
              </div>

              <!-- Open PRs -->
              <div class="sub-section" style="border-top: 1px solid var(--border);">
                <div class="sub-title">🔀 Open Pull Requests (${r.pullRequests.length})</div>
                ${r.pullRequests.length === 0 ? `
                  <div class="empty-state">No open pull requests.</div>
                ` : `
                  <div style="overflow-x: auto;">
                    <table>
                      <thead>
                        <tr>
                          <th>PR</th>
                          <th>Title</th>
                          <th>Author</th>
                          <th style="text-align: center;">Age</th>
                          <th style="text-align: center;">Last Active</th>
                          <th style="text-align: center;">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${r.pullRequests.map((pr) => {
                          const prAuthorAvatar = pr.author && pr.author !== 'unknown' ? `https://github.com/${encodeURIComponent(pr.author)}.png?size=40` : '';
                          return `
                            <tr>
                              <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer"><strong>#${pr.number}</strong></a></td>
                              <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.title)}</a></td>
                              <td>
                                <div class="user-flex">
                                  ${prAuthorAvatar ? `<img src="${prAuthorAvatar}" class="user-avatar" onerror="this.style.display='none'">` : ''}
                                  <a href="https://github.com/${escapeHtml(pr.author)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.author)}</a>
                                </div>
                              </td>
                              <td style="text-align: center;">${pr.ageDays}d</td>
                              <td style="text-align: center;">
                                ${pr.isStalePr ? `<span class="badge badge-warning">${pr.daysSinceLastUpdate}d ago</span>` : `${pr.daysSinceLastUpdate}d ago`}
                              </td>
                              <td style="text-align: center;">
                                ${pr.isDraft ? '<span class="badge badge-draft">Draft</span>' : '<span class="badge badge-healthy">Ready</span>'}
                              </td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- ============================================== -->
    <!-- VIEW 2: CONTRIBUTOR ACTIVITIES VIEW            -->
    <!-- ============================================== -->
    <div id="viewUsers" class="view-panel hidden">
      <!-- User KPI Counters -->
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-value">${totalContributors}</div>
          <div class="metric-label">Active Contributors</div>
        </div>
        <div class="metric-card">
          <div class="metric-value ${contributorsWithStaleBranches > 0 ? 'warning' : ''}">${contributorsWithStaleBranches}</div>
          <div class="metric-label">Users w/ Stale Branches</div>
        </div>
        <div class="metric-card">
          <div class="metric-value ${contributorsWithStalePrs > 0 ? 'warning' : ''}">${contributorsWithStalePrs}</div>
          <div class="metric-label">Users w/ Inactive PRs</div>
        </div>
        <div class="metric-card">
          <div class="metric-value ${totalReviewItems > 0 ? 'warning' : ''}">${totalReviewItems}</div>
          <div class="metric-label">Items Needing Review</div>
        </div>
      </div>

      <!-- Contributor Overview Table -->
      <div class="section-card">
        <div class="section-header">
          <h2>Contributor Leaderboard & Overview</h2>
        </div>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Contributor</th>
                <th>Repositories</th>
                <th style="text-align: center;">Open PRs</th>
                <th style="text-align: center;">Inactive PRs</th>
                <th style="text-align: center;">Stale Branches</th>
                <th style="text-align: center;">Items to Review</th>
                <th style="text-align: center;">Details</th>
              </tr>
            </thead>
            <tbody>
              ${userActivities.length === 0 ? `
                <tr><td colspan="7" class="empty-state">No contributors analyzed yet.</td></tr>
              ` : userActivities.map((u) => {
                const userAvatar = u.username && u.username !== 'unknown' ? `https://github.com/${encodeURIComponent(u.username)}.png?size=40` : '';
                const userAnchor = `user-${escapeHtml(u.username.replace(/[^a-zA-Z0-9_-]/g, '-'))}`;
                let statusBadge = `<span class="badge badge-healthy">All Good</span>`;
                if (u.totalNeedsAttention > 5) {
                  statusBadge = `<span class="badge badge-danger">${u.totalNeedsAttention} items</span>`;
                } else if (u.totalNeedsAttention > 0) {
                  statusBadge = `<span class="badge badge-warning">${u.totalNeedsAttention} items</span>`;
                }

                return `
                  <tr>
                    <td>
                      <div class="user-flex">
                        ${userAvatar ? `<img src="${userAvatar}" class="user-avatar" onerror="this.style.display='none'">` : ''}
                        <strong><a href="https://github.com/${escapeHtml(u.username)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.username)}</a></strong>
                      </div>
                    </td>
                    <td>
                      ${u.repositories.map((repo) => `<span class="badge badge-tag">${escapeHtml(repo)}</span>`).join('')}
                    </td>
                    <td style="text-align: center;">${u.openPrsCount}</td>
                    <td style="text-align: center;">
                      ${u.stalePrsCount > 0 ? `<span class="badge badge-warning">${u.stalePrsCount}</span>` : '0'}
                    </td>
                    <td style="text-align: center;">
                      ${u.staleBranchesCount > 0 ? `<span class="badge badge-danger">${u.staleBranchesCount}</span>` : '0'}
                    </td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td style="text-align: center;">
                      <a href="#${userAnchor}">View breakdown →</a>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Contributor Detail Cards -->
      <div id="userCardsContainer">
        ${userActivities.map((u) => {
          const userAvatar = u.username && u.username !== 'unknown' ? `https://github.com/${encodeURIComponent(u.username)}.png?size=64` : '';
          const userAnchor = `user-${escapeHtml(u.username.replace(/[^a-zA-Z0-9_-]/g, '-'))}`;

          return `
            <div class="detail-card" id="${userAnchor}">
              <div class="detail-card-header">
                <div class="card-title">
                  <div class="user-flex">
                    ${userAvatar ? `<img src="${userAvatar}" class="user-avatar" style="width: 34px; height: 34px;" onerror="this.style.display='none'">` : ''}
                    <a href="https://github.com/${escapeHtml(u.username)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.username)}</a>
                  </div>
                </div>
                <div>
                  ${u.repositories.map((repo) => `<span class="badge badge-tag">${escapeHtml(repo)}</span>`).join('')}
                  ${u.totalNeedsAttention > 0 ? `<span class="badge badge-warning">${u.totalNeedsAttention} items to review</span>` : `<span class="badge badge-healthy">Active & Healthy</span>`}
                </div>
              </div>

              <!-- User's Open PRs -->
              <div class="sub-section">
                <div class="sub-title">🔀 Open Pull Requests (${u.openPrs.length})</div>
                ${u.openPrs.length === 0 ? `
                  <div class="empty-state">No open PRs authored by ${escapeHtml(u.username)}.</div>
                ` : `
                  <div style="overflow-x: auto;">
                    <table>
                      <thead>
                        <tr>
                          <th>Repository</th>
                          <th>PR</th>
                          <th>Title</th>
                          <th style="text-align: center;">Age</th>
                          <th style="text-align: center;">Last Active</th>
                          <th style="text-align: center;">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${u.openPrs.map((pr) => `
                          <tr>
                            <td><span class="badge badge-tag">${escapeHtml(pr.repo)}</span></td>
                            <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer"><strong>#${pr.number}</strong></a></td>
                            <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.title)}</a></td>
                            <td style="text-align: center;">${pr.ageDays}d</td>
                            <td style="text-align: center;">
                              ${pr.isStalePr ? `<span class="badge badge-warning">${pr.daysSinceLastUpdate}d ago</span>` : `${pr.daysSinceLastUpdate}d ago`}
                            </td>
                            <td style="text-align: center;">
                              ${pr.isDraft ? '<span class="badge badge-draft">Draft</span>' : '<span class="badge badge-healthy">Ready</span>'}
                            </td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                `}
              </div>

              <!-- User's Stale Branches -->
              <div class="sub-section" style="border-top: 1px solid var(--border);">
                <div class="sub-title">🍂 Stale Branches (${u.staleBranches.length})</div>
                ${u.staleBranches.length === 0 ? `
                  <div class="empty-state">No stale branches authored by ${escapeHtml(u.username)}.</div>
                ` : `
                  <div style="overflow-x: auto;">
                    <table>
                      <thead>
                        <tr>
                          <th>Repository</th>
                          <th>Branch</th>
                          <th style="text-align: center;">Inactive Days</th>
                          <th style="text-align: center;">Has Open PR?</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${u.staleBranches.map((b) => {
                          const branchUrl = `https://github.com/${escapeHtml(b.repo)}/tree/${encodeURIComponent(b.name)}`;
                          const badgeColor = b.isVeryStale ? 'badge-danger' : 'badge-warning';
                          return `
                            <tr>
                              <td><span class="badge badge-tag">${escapeHtml(b.repo)}</span></td>
                              <td><a href="${branchUrl}" target="_blank" rel="noopener noreferrer"><code>${escapeHtml(b.name)}</code></a></td>
                              <td style="text-align: center;"><span class="badge ${badgeColor}">${b.daysInactive} days</span></td>
                              <td style="text-align: center;">
                                ${b.hasOpenPr ? '<span class="badge badge-healthy">Yes</span>' : '<span style="color: var(--text-muted)">No</span>'}
                              </td>
                            </tr>
                          `;
                        }).join('')}
                      </tbody>
                    </table>
                  </div>
                `}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <footer>
      Generated with <strong>fluffy-sniffle</strong> • Node.js GitHub Repository & Contributor Health Analyzer
    </footer>
  </div>

  <script>
    // Embedded Data for Instant Client-side Global Search
    const DASHBOARD_DATA = ${dashboardDataJson};

    let previousView = 'repos';
    let currentSearchCategory = 'all';
    let currentSearchResults = null;

    // View Switching
    function switchView(view) {
      const viewRepos = document.getElementById('viewRepos');
      const viewUsers = document.getElementById('viewUsers');
      const viewSearch = document.getElementById('viewSearch');
      const btnViewRepos = document.getElementById('btnViewRepos');
      const btnViewUsers = document.getElementById('btnViewUsers');

      viewSearch.classList.add('hidden');

      if (view === 'users') {
        viewRepos.classList.add('hidden');
        viewUsers.classList.remove('hidden');
        btnViewRepos.classList.remove('active');
        btnViewUsers.classList.add('active');
        previousView = 'users';
        window.location.hash = 'users';
      } else {
        viewUsers.classList.add('hidden');
        viewRepos.classList.remove('hidden');
        btnViewUsers.classList.remove('active');
        btnViewRepos.classList.add('active');
        previousView = 'repos';
        window.location.hash = 'repos';
      }
    }

    if (window.location.hash === '#users') {
      switchView('users');
    }

    // Escape regex characters
    function escapeRegExp(string) {
      return string.replace(/[.*+?^$\\{}()|[\\]\\\\]/g, '\\\\$&');
    }

    // Highlight text matching query
    function highlight(text, query) {
      if (!text) return '';
      if (!query) return escapeHtml(text);
      const safeText = String(text);
      const escapedQuery = escapeRegExp(query);
      const regex = new RegExp('(' + escapedQuery + ')', 'gi');
      return escapeHtml(safeText).replace(regex, '<mark>$1</mark>');
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Global Search Engine
    function performSearch(query) {
      const q = query.toLowerCase().trim();
      if (!q) {
        clearSearch();
        return;
      }

      document.getElementById('searchClearBtn').style.display = 'block';

      // Hide standard panels, show search panel
      document.getElementById('viewRepos').classList.add('hidden');
      document.getElementById('viewUsers').classList.add('hidden');
      document.getElementById('viewSearch').classList.remove('hidden');

      const repos = DASHBOARD_DATA.results || [];
      const users = DASHBOARD_DATA.userActivities || [];

      // 1. Search PRs
      const matchedPrs = [];
      repos.forEach(repo => {
        (repo.pullRequests || []).forEach(pr => {
          if (
            pr.title.toLowerCase().includes(q) ||
            String(pr.number).includes(q) ||
            (pr.author && pr.author.toLowerCase().includes(q)) ||
            repo.fullName.toLowerCase().includes(q)
          ) {
            matchedPrs.push({ ...pr, repoFullName: repo.fullName });
          }
        });
      });

      // 2. Search Branches
      const matchedBranches = [];
      repos.forEach(repo => {
        (repo.branches || []).forEach(b => {
          if (
            b.name.toLowerCase().includes(q) ||
            (b.author && b.author.toLowerCase().includes(q)) ||
            repo.fullName.toLowerCase().includes(q)
          ) {
            matchedBranches.push({ ...b, repoFullName: repo.fullName });
          }
        });
      });

      // 3. Search Contributors
      const matchedUsers = users.filter(u =>
        u.username.toLowerCase().includes(q) ||
        u.repositories.some(r => r.toLowerCase().includes(q))
      );

      // 4. Search Repositories
      const matchedRepos = repos.filter(r =>
        r.fullName.toLowerCase().includes(q) ||
        r.defaultBranch.toLowerCase().includes(q)
      );

      const totalMatches = matchedPrs.length + matchedBranches.length + matchedUsers.length + matchedRepos.length;

      // Update counters
      document.getElementById('countSearchAll').textContent = totalMatches;
      document.getElementById('countSearchPrs').textContent = matchedPrs.length;
      document.getElementById('countSearchBranches').textContent = matchedBranches.length;
      document.getElementById('countSearchUsers').textContent = matchedUsers.length;
      document.getElementById('countSearchRepos').textContent = matchedRepos.length;

      document.getElementById('searchSummaryTitle').innerHTML = '🔍 Search Results for "' + escapeHtml(query) + '"';
      document.getElementById('searchSummarySubtitle').textContent = 'Found ' + totalMatches + ' matching items across all tracked repositories';

      currentSearchResults = { q, matchedPrs, matchedBranches, matchedUsers, matchedRepos };
      renderSearchResults();
    }

    function filterSearchType(type) {
      currentSearchCategory = type;
      ['all', 'prs', 'branches', 'users', 'repos'].forEach(t => {
        const id = 'chip' + t.charAt(0).toUpperCase() + t.slice(1);
        const btn = document.getElementById(id);
        if (btn) btn.classList.toggle('active', t === type);
      });
      renderSearchResults();
    }

    function renderSearchResults() {
      if (!currentSearchResults) return;
      const { q, matchedPrs, matchedBranches, matchedUsers, matchedRepos } = currentSearchResults;
      const container = document.getElementById('searchResultsContent');
      let html = '';

      const showAll = currentSearchCategory === 'all';

      // Repositories Section
      if ((showAll || currentSearchCategory === 'repos') && matchedRepos.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: #fff;">🏢 Matching Repositories (' + matchedRepos.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th>Repository</th><th style="text-align: center;">Branches</th><th style="text-align: center;">Stale</th><th style="text-align: center;">Open PRs</th><th style="text-align: center;">Inactive PRs</th></tr></thead><tbody>';
        matchedRepos.forEach(r => {
          html += '<tr>';
          html += '<td><strong><a href="https://github.com/' + escapeHtml(r.fullName) + '" target="_blank">' + highlight(r.fullName, q) + '</a></strong></td>';
          html += '<td style="text-align: center;">' + r.totalBranches + '</td>';
          html += '<td style="text-align: center;"><span class="badge badge-warning">' + r.staleBranchesCount + '</span></td>';
          html += '<td style="text-align: center;">' + r.totalOpenPrs + '</td>';
          html += '<td style="text-align: center;">' + r.stalePrsCount + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Pull Requests Section
      if ((showAll || currentSearchCategory === 'prs') && matchedPrs.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: #fff;">🔀 Matching Pull Requests (' + matchedPrs.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th>Repository</th><th>PR</th><th>Title</th><th>Author</th><th style="text-align: center;">Age</th><th style="text-align: center;">Last Active</th><th style="text-align: center;">Status</th></tr></thead><tbody>';
        matchedPrs.forEach(pr => {
          html += '<tr>';
          html += '<td><span class="badge badge-tag">' + highlight(pr.repoFullName, q) + '</span></td>';
          html += '<td><a href="' + escapeHtml(pr.url) + '" target="_blank"><strong>#' + highlight(pr.number, q) + '</strong></a></td>';
          html += '<td><a href="' + escapeHtml(pr.url) + '" target="_blank">' + highlight(pr.title, q) + '</a></td>';
          html += '<td>' + highlight(pr.author, q) + '</td>';
          html += '<td style="text-align: center;">' + pr.ageDays + 'd</td>';
          html += '<td style="text-align: center;">' + (pr.isStalePr ? '<span class="badge badge-warning">' + pr.daysSinceLastUpdate + 'd ago</span>' : pr.daysSinceLastUpdate + 'd ago') + '</td>';
          html += '<td style="text-align: center;">' + (pr.isDraft ? '<span class="badge badge-draft">Draft</span>' : '<span class="badge badge-healthy">Ready</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Branches Section
      if ((showAll || currentSearchCategory === 'branches') && matchedBranches.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: #fff;">🍂 Matching Branches (' + matchedBranches.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th>Repository</th><th>Branch</th><th style="text-align: center;">Inactive Days</th><th>Last Author</th><th style="text-align: center;">Open PR?</th></tr></thead><tbody>';
        matchedBranches.forEach(b => {
          const branchUrl = 'https://github.com/' + escapeHtml(b.repoFullName) + '/tree/' + encodeURIComponent(b.name);
          const badgeClass = b.isVeryStale ? 'badge-danger' : (b.isStale ? 'badge-warning' : 'badge-healthy');
          html += '<tr>';
          html += '<td><span class="badge badge-tag">' + highlight(b.repoFullName, q) + '</span></td>';
          html += '<td><a href="' + branchUrl + '" target="_blank"><code>' + highlight(b.name, q) + '</code></a></td>';
          html += '<td style="text-align: center;"><span class="badge ' + badgeClass + '">' + (b.daysInactive !== null ? b.daysInactive + 'd' : 'Active') + '</span></td>';
          html += '<td>' + highlight(b.author, q) + '</td>';
          html += '<td style="text-align: center;">' + (b.hasOpenPr ? '<span class="badge badge-healthy">Yes</span>' : '<span style="color: var(--text-muted)">No</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Contributors Section
      if ((showAll || currentSearchCategory === 'users') && matchedUsers.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: #fff;">👤 Matching Contributors (' + matchedUsers.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th>Contributor</th><th>Repositories</th><th style="text-align: center;">Open PRs</th><th style="text-align: center;">Inactive PRs</th><th style="text-align: center;">Stale Branches</th><th style="text-align: center;">Items to Review</th></tr></thead><tbody>';
        matchedUsers.forEach(u => {
          const userAvatar = u.username && u.username !== 'unknown' ? 'https://github.com/' + encodeURIComponent(u.username) + '.png?size=40' : '';
          html += '<tr>';
          html += '<td><div class="user-flex">' + (userAvatar ? '<img src="' + userAvatar + '" class="user-avatar" onerror="this.style.display=\\'none\\'"> ' : '') + '<strong><a href="https://github.com/' + escapeHtml(u.username) + '" target="_blank">' + highlight(u.username, q) + '</a></strong></div></td>';
          html += '<td>' + u.repositories.map(repo => '<span class="badge badge-tag">' + highlight(repo, q) + '</span>').join('') + '</td>';
          html += '<td style="text-align: center;">' + u.openPrsCount + '</td>';
          html += '<td style="text-align: center;">' + (u.stalePrsCount > 0 ? '<span class="badge badge-warning">' + u.stalePrsCount + '</span>' : '0') + '</td>';
          html += '<td style="text-align: center;">' + (u.staleBranchesCount > 0 ? '<span class="badge badge-danger">' + u.staleBranchesCount + '</span>' : '0') + '</td>';
          html += '<td style="text-align: center;">' + (u.totalNeedsAttention > 0 ? '<span class="badge badge-warning">' + u.totalNeedsAttention + ' items</span>' : '<span class="badge badge-healthy">All Good</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      if (html === '') {
        html = '<div class="empty-state">No matching items found for "<strong>' + escapeHtml(q) + '</strong>".<br>Try searching by branch name, PR number, title, author handle, or repository name.</div>';
      }

      container.innerHTML = html;
    }

    function clearSearch() {
      const input = document.getElementById('searchInput');
      input.value = '';
      document.getElementById('searchClearBtn').style.display = 'none';
      currentSearchResults = null;
      switchView(previousView);
    }

    // Live search input listener
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
      performSearch(e.target.value);
    });

    // Keyboard Shortcuts: '/' to focus search, 'Escape' to clear
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'Escape' && document.activeElement === searchInput) {
        clearSearch();
        searchInput.blur();
      }
    });

    // Toast helper
    function showToast(message, type = 'info') {
      let toast = document.getElementById('toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
      }
      toast.className = 'toast';
      if (type === 'error') toast.style.background = '#da3633';
      else if (type === 'success') toast.style.background = '#238636';
      else toast.style.background = '#1f6feb';
      toast.textContent = message;
      setTimeout(() => {
        toast.className = 'toast hidden';
      }, 4000);
    }

    // Trigger Scan via Server API
    async function triggerScan() {
      if (window.location.protocol === 'file:') {
        alert('To trigger scans directly from the browser, please run the project server using: npm start');
        return;
      }

      const btn = document.getElementById('triggerScanBtn');
      const icon = document.getElementById('scanBtnIcon');
      const text = document.getElementById('scanBtnText');

      btn.disabled = true;
      icon.classList.add('spinning');
      text.textContent = 'Scanning...';
      showToast('Starting repository health scan...', 'info');

      try {
        const res = await fetch('/api/scan', { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Scan failed');
        }
        showToast('✔ Scan complete! Updating page...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 600);
      } catch (err) {
        showToast('❌ Scan failed: ' + err.message, 'error');
        btn.disabled = false;
        icon.classList.remove('spinning');
        text.textContent = 'Run Report Now';
      }
    }

    // Add Repository via Server API
    async function handleAddRepo() {
      if (window.location.protocol === 'file:') {
        alert('To add repositories dynamically, please run the project server using: npm start');
        return;
      }

      const input = document.getElementById('newRepoInput');
      const repoStr = input.value.trim();
      if (!repoStr || !repoStr.includes('/')) {
        alert('Please enter a repository in owner/repo format (e.g. facebook/react)');
        return;
      }

      const [owner, repo] = repoStr.split('/');
      input.disabled = true;
      showToast('Adding ' + repoStr + ' and starting scan...', 'info');

      try {
        const res = await fetch('/api/repos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner, repo })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to add repo');
        showToast('✔ Repository added! Refreshing...', 'success');
        input.value = '';
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        showToast('❌ Failed: ' + err.message, 'error');
      } finally {
        input.disabled = false;
      }
    }

    // Allow Enter key on newRepoInput
    document.getElementById('newRepoInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddRepo();
    });
  </script>
</body>
</html>`;
}

/**
 * Saves HTML report to disk
 */
export function saveHtmlReport(results, userActivities = [], metadata = {}, outputDir = 'reports') {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = generateHtmlReport(results, userActivities, metadata);

  // 1. Save timestamped archive
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(outputDir, `repo-health-${dateStr}.html`);
  fs.writeFileSync(archivePath, html, 'utf-8');

  // 2. Save latest dashboard (index.html)
  const latestPath = path.join(outputDir, 'index.html');
  fs.writeFileSync(latestPath, html, 'utf-8');

  return { latestPath, archivePath };
}
