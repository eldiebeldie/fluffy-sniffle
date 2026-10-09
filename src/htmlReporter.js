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
 * Generate complete self-contained HTML dashboard
 */
export function generateHtmlReport(results) {
  const generatedAt = new Date().toUTCString();

  // Aggregate metrics
  const totalRepos = results.length;
  const totalBranches = results.reduce((acc, r) => acc + r.totalBranches, 0);
  const totalStaleBranches = results.reduce((acc, r) => acc + r.staleBranchesCount, 0);
  const totalOpenPrs = results.reduce((acc, r) => acc + r.totalOpenPrs, 0);
  const totalStalePrs = results.reduce((acc, r) => acc + r.stalePrsCount, 0);
  const totalDraftPrs = results.reduce((acc, r) => acc + r.draftPrsCount, 0);

  const reposJson = JSON.stringify(results);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Repository Health Dashboard</title>
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
      max-width: 1300px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 24px;
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
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .search-input {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #fff;
      padding: 8px 14px;
      font-size: 14px;
      outline: none;
      min-width: 260px;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent);
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

    /* Overview Table */
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
    }

    /* Repo Cards */
    .repo-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 24px;
      overflow: hidden;
    }

    .repo-card-header {
      padding: 16px 20px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .repo-title {
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .repo-tags {
      display: flex;
      gap: 8px;
      align-items: center;
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
      padding: 16px;
      text-align: center;
      color: var(--text-muted);
      font-style: italic;
      background: rgba(0, 0, 0, 0.1);
      border-radius: 6px;
    }

    .tab-buttons {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }

    .tab-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 6px;
      padding: 6px 14px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .tab-btn.active, .tab-btn:hover {
      background: var(--border);
      color: #fff;
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
        <h1>📊 GitHub Repository Health Dashboard</h1>
        <p>Generated: ${escapeHtml(generatedAt)}</p>
      </div>
      <div class="controls">
        <input type="text" id="searchInput" class="search-input" placeholder="🔍 Search branches or PRs...">
      </div>
    </header>

    <!-- Top KPI Counters -->
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
            ${results.map((r) => {
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

    <!-- Repository Details -->
    <div id="repoCardsContainer">
      ${results.map((r) => {
        const repoAnchor = `repo-${escapeHtml(r.fullName.replace('/', '-'))}`;
        const repoGithubUrl = `https://github.com/${escapeHtml(r.fullName)}`;

        return `
          <div class="repo-card" id="${repoAnchor}">
            <div class="repo-card-header">
              <div class="repo-title">
                <a href="${repoGithubUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.fullName)}</a>
              </div>
              <div class="repo-tags">
                <span class="badge badge-tag">default: ${escapeHtml(r.defaultBranch)}</span>
                <span class="badge badge-tag">${r.isPrivate ? 'Private' : 'Public'}</span>
              </div>
            </div>

            <!-- Stale Branches -->
            <div class="sub-section">
              <div class="sub-title">
                🍂 Stale Branches (${r.staleBranches.length})
              </div>
              ${r.staleBranches.length === 0 ? `
                <div class="empty-state">No stale branches found! All branches are active or merged.</div>
              ` : `
                <div style="overflow-x: auto;">
                  <table class="filterable-table branch-table">
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
                        return `
                          <tr>
                            <td>
                              <a href="${branchUrl}" target="_blank" rel="noopener noreferrer">
                                <code>${escapeHtml(b.name)}</code>
                              </a>
                            </td>
                            <td style="text-align: center;">
                              <span class="badge ${badgeColor}">${b.daysInactive} days</span>
                            </td>
                            <td>${escapeHtml(b.author)}</td>
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

            <!-- Open Pull Requests -->
            <div class="sub-section" style="border-top: 1px solid var(--border);">
              <div class="sub-title">
                🔀 Open Pull Requests (${r.pullRequests.length})
              </div>
              ${r.pullRequests.length === 0 ? `
                <div class="empty-state">No open pull requests.</div>
              ` : `
                <div style="overflow-x: auto;">
                  <table class="filterable-table pr-table">
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
                        return `
                          <tr>
                            <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer"><strong>#${pr.number}</strong></a></td>
                            <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.title)}</a></td>
                            <td>${escapeHtml(pr.author)}</td>
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

    <footer>
      Generated with <strong>fluffy-sniffle</strong> • Node.js GitHub Repository Health Analyzer
    </footer>
  </div>

  <script>
    // Live Search Filter
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const rows = document.querySelectorAll('.filterable-table tbody tr');

      rows.forEach((row) => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
      });
    });
  </script>
</body>
</html>`;
}

/**
 * Saves HTML report to disk
 */
export function saveHtmlReport(results, outputDir = 'reports') {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const html = generateHtmlReport(results);

  // 1. Save timestamped archive
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(outputDir, `repo-health-${dateStr}.html`);
  fs.writeFileSync(archivePath, html, 'utf-8');

  // 2. Save latest dashboard (index.html)
  const latestPath = path.join(outputDir, 'index.html');
  fs.writeFileSync(latestPath, html, 'utf-8');

  return { latestPath, archivePath };
}

