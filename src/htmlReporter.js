import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

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
 * Generate complete self-contained HTML dashboard with Repository & User views,
 * Global Item Search, Section 508 Accessibility, and 4 Visual Themes.
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
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GitHub Repository & Contributor Health Dashboard</title>
  <style>
    /* --------------------------------------------------
       THEMES & ACCESSIBILITY TOKENS (Section 508 / WCAG)
       -------------------------------------------------- */

    /* 1. Dark Theme (Default) */
    :root, [data-theme="dark"] {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --header-text: #ffffff;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --accent-bg: rgba(88, 166, 255, 0.15);
      --success: #3fb950;
      --success-light: #56d364;
      --success-bg: rgba(63, 185, 80, 0.18);
      --warning: #d29922;
      --warning-bg: rgba(210, 153, 34, 0.18);
      --danger: #f85149;
      --danger-bg: rgba(248, 81, 73, 0.18);
      --badge-draft: #8b949e;
      --table-hover: rgba(255, 255, 255, 0.03);
      --focus-ring: #58a6ff;
      --chip-active-bg: rgba(88, 166, 255, 0.2);
    }

    /* 2. Light Theme (High Readability, Contrast Ratio >= 4.5:1 / 7:1) */
    [data-theme="light"] {
      --bg: #f6f8fa;
      --card-bg: #ffffff;
      --border: #d0d7de;
      --text-main: #1f2328;
      --text-muted: #4a5568;
      --header-text: #090a0c;
      --accent: #0969da;
      --accent-hover: #0550ae;
      --accent-bg: rgba(9, 105, 218, 0.1);
      --success: #1a7f37;
      --success-light: #116329;
      --success-bg: rgba(26, 127, 55, 0.14);
      --warning: #9a6700;
      --warning-bg: rgba(154, 103, 0, 0.14);
      --danger: #cf222e;
      --danger-bg: rgba(207, 34, 46, 0.12);
      --badge-draft: #4a5568;
      --table-hover: #f3f4f6;
      --focus-ring: #0969da;
      --chip-active-bg: rgba(9, 105, 218, 0.15);
    }

    /* 3. Midnight Theme (Deep Oceanic Navy & Electric Cyan) */
    [data-theme="midnight"] {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --header-text: #ffffff;
      --accent: #38bdf8;
      --accent-hover: #7dd3fc;
      --accent-bg: rgba(56, 189, 248, 0.15);
      --success: #34d399;
      --success-light: #10b981;
      --success-bg: rgba(52, 211, 153, 0.15);
      --warning: #fbbf24;
      --warning-bg: rgba(251, 191, 36, 0.18);
      --danger: #f87171;
      --danger-bg: rgba(248, 113, 113, 0.18);
      --badge-draft: #9ca3af;
      --table-hover: rgba(255, 255, 255, 0.04);
      --focus-ring: #38bdf8;
      --chip-active-bg: rgba(56, 189, 248, 0.2);
    }

    /* 4. High Contrast Theme (Section 508 & WCAG 2.1 AAA Compliant) */
    [data-theme="high-contrast"] {
      --bg: #000000;
      --card-bg: #080808;
      --border: #ffffff;
      --text-main: #ffffff;
      --text-muted: #e6e6e6;
      --header-text: #ffffff;
      --accent: #79c0ff;
      --accent-hover: #a5d6ff;
      --accent-bg: #112a45;
      --success: #56d364;
      --success-light: #7ee787;
      --success-bg: #0d2e14;
      --warning: #f2cc60;
      --warning-bg: #332600;
      --danger: #ff7b72;
      --danger-bg: #401519;
      --badge-draft: #ffffff;
      --table-hover: #212121;
      --focus-ring: #f2cc60;
      --chip-active-bg: #18385e;
    }

    /* --------------------------------------------------
       BASE & ACCESSIBILITY STYLES
       -------------------------------------------------- */
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* Section 508 / WCAG AAA Visible Focus States */
    *:focus-visible {
      outline: 3px solid var(--focus-ring) !important;
      outline-offset: 2px !important;
    }

    /* Skip to content link for screen reader / keyboard navigation */
    .skip-link {
      position: absolute;
      top: -60px;
      left: 16px;
      background: var(--accent);
      color: #ffffff;
      padding: 10px 18px;
      z-index: 10000;
      text-decoration: none;
      font-weight: 700;
      border-radius: 6px;
      transition: top 0.2s;
    }

    .skip-link:focus {
      top: 16px;
    }

    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border-width: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      padding: 24px;
      transition: background-color 0.2s, color 0.2s;
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
      color: var(--header-text);
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

    /* Theme Selector Dropdown */
    .theme-select {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      outline: none;
      transition: border-color 0.2s;
    }

    .theme-select:hover {
      border-color: var(--accent);
    }

    /* Enhanced Search Input */
    .search-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-width: 320px;
    }

    .search-input {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-main);
      padding: 8px 32px 8px 12px;
      font-size: 13px;
      outline: none;
      width: 100%;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent);
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
      color: var(--header-text);
    }

    mark {
      background: rgba(255, 212, 59, 0.4);
      color: inherit;
      padding: 1px 3px;
      border-radius: 3px;
      font-weight: 600;
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
      color: #ffffff;
      border-color: var(--success-light);
    }

    .btn-primary:hover:not(:disabled) {
      background: var(--success-light);
    }

    .btn-primary:disabled {
      background: var(--success);
      cursor: not-allowed;
      opacity: 0.6;
    }

    .btn-secondary {
      background: var(--card-bg);
      border-color: var(--border);
      color: var(--text-main);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--table-hover);
      color: var(--header-text);
      border-color: var(--accent);
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
      background: var(--accent);
      color: #ffffff;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
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
      background: var(--table-hover);
      color: var(--header-text);
    }

    .view-btn.active {
      background: var(--accent-bg);
      border-color: var(--accent);
      color: var(--accent);
    }

    .view-btn .pill {
      background: rgba(125, 125, 125, 0.18);
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
      color: var(--header-text);
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
      font-weight: 600;
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
      background: var(--table-hover);
      flex-wrap: wrap;
      gap: 10px;
    }

    .section-header h2 {
      font-size: 18px;
      font-weight: 600;
      color: var(--header-text);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }

    th {
      background: var(--table-hover);
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
      background: var(--table-hover);
    }

    a {
      color: var(--accent);
      text-decoration: none;
    }

    a:hover, a:focus {
      text-decoration: underline;
    }

    /* Badges with Icon + Text for Section 508 Color Independence */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-healthy {
      background: var(--success-bg);
      color: var(--success);
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
      background: rgba(125, 125, 125, 0.15);
      color: var(--badge-draft);
      border: 1px solid var(--border);
    }

    .badge-tag {
      background: var(--accent-bg);
      color: var(--accent);
      border: 1px solid var(--accent);
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
      background: var(--table-hover);
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
      color: var(--header-text);
    }

    .sub-section {
      padding: 20px;
    }

    .sub-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--header-text);
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
      background: var(--table-hover);
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
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .chip-btn:hover {
      color: var(--header-text);
      border-color: var(--accent);
    }

    .chip-btn.active {
      background: var(--chip-active-bg);
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
  <!-- Section 508: Accessible Skip Link -->
  <a href="#mainViewSwitcher" class="skip-link">Skip to main content</a>

  <div class="container">
    <header role="banner">
      <div class="header-title">
        <h1>📊 GitHub Health & Contributor Dashboard</h1>
        <p id="lastScannedText">Last scanned: ${escapeHtml(generatedAt)} ${metadata.isDev ? `<span class="badge" style="background: rgba(35, 134, 54, 0.15); border: 1px solid var(--success); color: var(--success); font-weight: 600; padding: 2px 8px; border-radius: 6px; font-size: 11px; margin-left: 8px;">⚡ LIVE RELOAD ACTIVE</span>` : ''}</p>
      </div>

      <div class="controls" role="toolbar" aria-label="Dashboard Controls">
        <!-- Section 508 / Accessible Theme Switcher -->
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

    ${metadata.failedRepos && metadata.failedRepos.length > 0 ? `
      <div class="alert-banner" role="alert" style="background: rgba(218, 54, 51, 0.15); border: 1px solid var(--danger); color: var(--header-text); padding: 14px 18px; border-radius: 8px; margin-bottom: 24px;">
        <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">⚠️ Unreachable Repositories (${metadata.failedRepos.length})</div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 8px;">The following repositories configured in <code>config.json</code> could not be resolved or fetched from GitHub:</div>
        <ul style="margin: 0 0 6px 20px; font-size: 13px;">
          ${metadata.failedRepos.map((f) => `
            <li style="margin-bottom: 4px;">
              <strong>${escapeHtml(f.owner)}/${escapeHtml(f.repo)}</strong>: ${escapeHtml(f.error)}
              <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px; margin-left: 8px; cursor: pointer;" onclick="handleRemoveRepo('${escapeHtml(f.owner)}/${escapeHtml(f.repo)}')">Remove from Config</button>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}

    <!-- Top View Switcher Tabs -->
    <nav class="view-switcher" id="mainViewSwitcher" role="tablist" aria-label="Dashboard Views">
      <button class="view-btn active" id="btnViewRepos" onclick="switchView('repos')" role="tab" aria-selected="true" aria-controls="viewRepos">
        🏢 Repositories View <span class="pill" id="badgeTotalRepos">${totalRepos}</span>
      </button>
      <button class="view-btn" id="btnViewUsers" onclick="switchView('users')" role="tab" aria-selected="false" aria-controls="viewUsers">
        👤 Contributor Activities <span class="pill" id="badgeTotalContributors">${totalContributors}</span>
      </button>
    </nav>

    <!-- ============================================== -->
    <!-- VIEW 3: SEARCH RESULTS VIEW (Appears on search)-->
    <!-- ============================================== -->
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

    <!-- ============================================== -->
    <!-- VIEW 1: REPOSITORIES VIEW                      -->
    <!-- ============================================== -->
    <main id="viewRepos" class="view-panel" role="region" aria-label="Repositories Overview">
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
              ${results.length === 0 ? `
                <tr><td colspan="8" class="empty-state">No repositories analyzed yet. Click "Run Report Now" above!</td></tr>
              ` : results.map((r) => {
                let badgeClass = 'badge-healthy';
                let badgeLabel = '✔ Healthy';
                if (r.staleBranchesCount > 10 || r.stalePrsCount > 5) {
                  badgeClass = 'badge-danger';
                  badgeLabel = '🛑 Needs Cleanup';
                } else if (r.staleBranchesCount > 0 || r.stalePrsCount > 0) {
                  badgeClass = 'badge-warning';
                  badgeLabel = '⚠️ Attention';
                }

                return `
                  <tr>
                    <td><strong><a href="#repo-${escapeHtml(r.fullName.replace('/', '-'))}">${escapeHtml(r.fullName)}</a></strong></td>
                    <td style="text-align: center;">${r.totalBranches}</td>
                    <td style="text-align: center;">
                      ${r.staleBranchesCount > 0 ? `<span class="badge badge-warning">🍂 ${r.staleBranchesCount}</span>` : '0'}
                    </td>
                    <td style="text-align: center;">${r.totalOpenPrs}</td>
                    <td style="text-align: center;">
                      ${r.stalePrsCount > 0 ? `<span class="badge badge-warning">⏳ ${r.stalePrsCount}</span>` : '0'}
                    </td>
                    <td style="text-align: center;">${r.draftPrsCount}</td>
                    <td style="text-align: center;"><span class="badge ${badgeClass}">${badgeLabel}</span></td>
                    <td style="text-align: center;">
                      <button class="btn btn-secondary" style="padding: 2px 7px; font-size: 11px; cursor: pointer;" onclick="handleRemoveRepo('${escapeHtml(r.fullName)}')" title="Stop tracking ${escapeHtml(r.fullName)}" aria-label="Remove repository ${escapeHtml(r.fullName)}">🗑️</button>
                    </td>
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
                  <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; margin-left: 8px; cursor: pointer;" onclick="handleRemoveRepo('${escapeHtml(r.fullName)}')" aria-label="Remove repository ${escapeHtml(r.fullName)}">🗑️ Remove</button>
                </div>
              </div>

              <!-- Stale Branches -->
              <div class="sub-section">
                <div class="sub-title">🍂 Stale Branches (${r.staleBranches.length})</div>
                ${r.staleBranches.length === 0 ? `
                  <div class="empty-state">No stale branches found!</div>
                ` : `
                  <div style="overflow-x: auto;">
                    <table aria-label="Stale Branches for ${escapeHtml(r.fullName)}">
                      <thead>
                        <tr>
                          <th scope="col">Branch</th>
                          <th scope="col" style="text-align: center;">Inactive Days</th>
                          <th scope="col">Last Author</th>
                          <th scope="col" style="text-align: center;">Open PR?</th>
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
                                  ${authorAvatar ? `<img src="${authorAvatar}" class="user-avatar" alt="" onerror="this.style.display='none'">` : ''}
                                  <a href="https://github.com/${escapeHtml(b.author)}" target="_blank" rel="noopener noreferrer">${escapeHtml(b.author)}</a>
                                </div>
                              </td>
                              <td style="text-align: center;">
                                ${b.hasOpenPr ? '<span class="badge badge-healthy">✔ Yes</span>' : '<span style="color: var(--text-muted)">No</span>'}
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
                    <table aria-label="Open Pull Requests for ${escapeHtml(r.fullName)}">
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
                        ${r.pullRequests.map((pr) => {
                          const prAuthorAvatar = pr.author && pr.author !== 'unknown' ? `https://github.com/${encodeURIComponent(pr.author)}.png?size=40` : '';
                          return `
                            <tr>
                              <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer"><strong>#${pr.number}</strong></a></td>
                              <td><a href="${escapeHtml(pr.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.title)}</a></td>
                              <td>
                                <div class="user-flex">
                                  ${prAuthorAvatar ? `<img src="${prAuthorAvatar}" class="user-avatar" alt="" onerror="this.style.display='none'">` : ''}
                                  <a href="https://github.com/${escapeHtml(pr.author)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.author)}</a>
                                </div>
                              </td>
                              <td style="text-align: center;">${pr.ageDays}d</td>
                              <td style="text-align: center;">
                                ${pr.isStalePr ? `<span class="badge badge-warning">⏳ ${pr.daysSinceLastUpdate}d ago</span>` : `${pr.daysSinceLastUpdate}d ago`}
                              </td>
                              <td style="text-align: center;">
                                ${pr.isDraft ? '<span class="badge badge-draft">Draft</span>' : '<span class="badge badge-healthy">✔ Ready</span>'}
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
    </main>

    <!-- ============================================== -->
    <!-- VIEW 2: CONTRIBUTOR ACTIVITIES VIEW            -->
    <!-- ============================================== -->
    <main id="viewUsers" class="view-panel hidden" role="region" aria-label="Contributor Activities">
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
          <table aria-label="Contributor Leaderboard Table">
            <thead>
              <tr>
                <th scope="col">Contributor</th>
                <th scope="col">Repositories</th>
                <th scope="col" style="text-align: center;">Open PRs</th>
                <th scope="col" style="text-align: center;">Inactive PRs</th>
                <th scope="col" style="text-align: center;">Stale Branches</th>
                <th scope="col" style="text-align: center;">Items to Review</th>
                <th scope="col" style="text-align: center;">Details</th>
              </tr>
            </thead>
            <tbody>
              ${userActivities.length === 0 ? `
                <tr><td colspan="7" class="empty-state">No contributors analyzed yet.</td></tr>
              ` : userActivities.map((u) => {
                const userAvatar = u.username && u.username !== 'unknown' ? `https://github.com/${encodeURIComponent(u.username)}.png?size=40` : '';
                const userAnchor = `user-${escapeHtml(u.username.replace(/[^a-zA-Z0-9_-]/g, '-'))}`;
                let statusBadge = `<span class="badge badge-healthy">✔ All Good</span>`;
                if (u.totalNeedsAttention > 5) {
                  statusBadge = `<span class="badge badge-danger">🛑 ${u.totalNeedsAttention} items</span>`;
                } else if (u.totalNeedsAttention > 0) {
                  statusBadge = `<span class="badge badge-warning">⚠️ ${u.totalNeedsAttention} items</span>`;
                }

                return `
                  <tr>
                    <td>
                      <div class="user-flex">
                        ${userAvatar ? `<img src="${userAvatar}" class="user-avatar" alt="" onerror="this.style.display='none'">` : ''}
                        <strong><a href="https://github.com/${escapeHtml(u.username)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.username)}</a></strong>
                      </div>
                    </td>
                    <td>
                      ${u.repositories.map((repo) => `<span class="badge badge-tag">${escapeHtml(repo)}</span>`).join('')}
                    </td>
                    <td style="text-align: center;">${u.openPrsCount}</td>
                    <td style="text-align: center;">
                      ${u.stalePrsCount > 0 ? `<span class="badge badge-warning">⏳ ${u.stalePrsCount}</span>` : '0'}
                    </td>
                    <td style="text-align: center;">
                      ${u.staleBranchesCount > 0 ? `<span class="badge badge-danger">🍂 ${u.staleBranchesCount}</span>` : '0'}
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
                    ${userAvatar ? `<img src="${userAvatar}" class="user-avatar" style="width: 34px; height: 34px;" alt="" onerror="this.style.display='none'">` : ''}
                    <a href="https://github.com/${escapeHtml(u.username)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.username)}</a>
                  </div>
                </div>
                <div>
                  ${u.repositories.map((repo) => `<span class="badge badge-tag">${escapeHtml(repo)}</span>`).join('')}
                  ${u.totalNeedsAttention > 0 ? `<span class="badge badge-warning">⚠️ ${u.totalNeedsAttention} items to review</span>` : `<span class="badge badge-healthy">✔ Active & Healthy</span>`}
                </div>
              </div>

              <!-- User's Open PRs -->
              <div class="sub-section">
                <div class="sub-title">🔀 Open Pull Requests (${u.openPrs.length})</div>
                ${u.openPrs.length === 0 ? `
                  <div class="empty-state">No open PRs authored by ${escapeHtml(u.username)}.</div>
                ` : `
                  <div style="overflow-x: auto;">
                    <table aria-label="Open PRs for ${escapeHtml(u.username)}">
                      <thead>
                        <tr>
                          <th scope="col">Repository</th>
                          <th scope="col">PR</th>
                          <th scope="col">Title</th>
                          <th scope="col" style="text-align: center;">Age</th>
                          <th scope="col" style="text-align: center;">Last Active</th>
                          <th scope="col" style="text-align: center;">Status</th>
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
                              ${pr.isStalePr ? `<span class="badge badge-warning">⏳ ${pr.daysSinceLastUpdate}d ago</span>` : `${pr.daysSinceLastUpdate}d ago`}
                            </td>
                            <td style="text-align: center;">
                              ${pr.isDraft ? '<span class="badge badge-draft">Draft</span>' : '<span class="badge badge-healthy">✔ Ready</span>'}
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
                    <table aria-label="Stale Branches for ${escapeHtml(u.username)}">
                      <thead>
                        <tr>
                          <th scope="col">Repository</th>
                          <th scope="col">Branch</th>
                          <th scope="col" style="text-align: center;">Inactive Days</th>
                          <th scope="col" style="text-align: center;">Has Open PR?</th>
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
                                ${b.hasOpenPr ? '<span class="badge badge-healthy">✔ Yes</span>' : '<span style="color: var(--text-muted)">No</span>'}
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
    </main>

    <footer role="contentinfo">
      Generated with <strong>fluffy-sniffle</strong> • Node.js GitHub Repository & Contributor Health Analyzer
    </footer>
  </div>

  <script>
    // Embedded Data for Instant Client-side Global Search
    const DASHBOARD_DATA = ${dashboardDataJson};

    let previousView = 'repos';
    let currentSearchCategory = 'all';
    let currentSearchResults = null;

    // Theme Management (Supports Dark, Light, Midnight, High Contrast - Section 508 / WCAG AAA)
    function setTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      try {
        localStorage.setItem('fluffy-theme', theme);
      } catch (e) {}
      const select = document.getElementById('themeSelect');
      if (select && select.value !== theme) {
        select.value = theme;
      }
      console.log('[Dashboard:Theme] Switched theme to:', theme);
    }

    // Initialize Theme
    (function initTheme() {
      try {
        const saved = localStorage.getItem('fluffy-theme');
        if (saved) {
          setTheme(saved);
          return;
        }
      } catch (e) {}

      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        setTheme('light');
      } else {
        setTheme('dark');
      }
    })();

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
        btnViewRepos.setAttribute('aria-selected', 'false');
        btnViewUsers.classList.add('active');
        btnViewUsers.setAttribute('aria-selected', 'true');
        previousView = 'users';
        window.location.hash = 'users';
      } else {
        viewUsers.classList.add('hidden');
        viewRepos.classList.remove('hidden');
        btnViewUsers.classList.remove('active');
        btnViewUsers.setAttribute('aria-selected', 'false');
        btnViewRepos.classList.add('active');
        btnViewRepos.setAttribute('aria-selected', 'true');
        previousView = 'repos';
        window.location.hash = 'repos';
      }
      console.log('[Dashboard:View] Active view changed to:', view);
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

      console.log('[Dashboard:Search] Searched for: "' + query + '" -> Found ' + totalMatches + ' matches');
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
      console.log('[Dashboard:SearchFilter] Filter category changed to:', type);
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
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">🏢 Matching Repositories (' + matchedRepos.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Repository</th><th scope="col" style="text-align: center;">Branches</th><th scope="col" style="text-align: center;">Stale</th><th scope="col" style="text-align: center;">Open PRs</th><th scope="col" style="text-align: center;">Inactive PRs</th></tr></thead><tbody>';
        matchedRepos.forEach(r => {
          html += '<tr>';
          html += '<td><strong><a href="https://github.com/' + escapeHtml(r.fullName) + '" target="_blank">' + highlight(r.fullName, q) + '</a></strong></td>';
          html += '<td style="text-align: center;">' + r.totalBranches + '</td>';
          html += '<td style="text-align: center;"><span class="badge badge-warning">🍂 ' + r.staleBranchesCount + '</span></td>';
          html += '<td style="text-align: center;">' + r.totalOpenPrs + '</td>';
          html += '<td style="text-align: center;"><span class="badge badge-warning">⏳ ' + r.stalePrsCount + '</span></td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Pull Requests Section
      if ((showAll || currentSearchCategory === 'prs') && matchedPrs.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">🔀 Matching Pull Requests (' + matchedPrs.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Repository</th><th scope="col">PR</th><th scope="col">Title</th><th scope="col">Author</th><th scope="col" style="text-align: center;">Age</th><th scope="col" style="text-align: center;">Last Active</th><th scope="col" style="text-align: center;">Status</th></tr></thead><tbody>';
        matchedPrs.forEach(pr => {
          html += '<tr>';
          html += '<td><span class="badge badge-tag">' + highlight(pr.repoFullName, q) + '</span></td>';
          html += '<td><a href="' + escapeHtml(pr.url) + '" target="_blank"><strong>#' + highlight(pr.number, q) + '</strong></a></td>';
          html += '<td><a href="' + escapeHtml(pr.url) + '" target="_blank">' + highlight(pr.title, q) + '</a></td>';
          html += '<td>' + highlight(pr.author, q) + '</td>';
          html += '<td style="text-align: center;">' + pr.ageDays + 'd</td>';
          html += '<td style="text-align: center;">' + (pr.isStalePr ? '<span class="badge badge-warning">⏳ ' + pr.daysSinceLastUpdate + 'd ago</span>' : pr.daysSinceLastUpdate + 'd ago') + '</td>';
          html += '<td style="text-align: center;">' + (pr.isDraft ? '<span class="badge badge-draft">Draft</span>' : '<span class="badge badge-healthy">✔ Ready</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Branches Section
      if ((showAll || currentSearchCategory === 'branches') && matchedBranches.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">🍂 Matching Branches (' + matchedBranches.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Repository</th><th scope="col">Branch</th><th scope="col" style="text-align: center;">Inactive Days</th><th scope="col">Last Author</th><th scope="col" style="text-align: center;">Open PR?</th></tr></thead><tbody>';
        matchedBranches.forEach(b => {
          const branchUrl = 'https://github.com/' + escapeHtml(b.repoFullName) + '/tree/' + encodeURIComponent(b.name);
          const badgeClass = b.isVeryStale ? 'badge-danger' : (b.isStale ? 'badge-warning' : 'badge-healthy');
          html += '<tr>';
          html += '<td><span class="badge badge-tag">' + highlight(b.repoFullName, q) + '</span></td>';
          html += '<td><a href="' + branchUrl + '" target="_blank"><code>' + highlight(b.name, q) + '</code></a></td>';
          html += '<td style="text-align: center;"><span class="badge ' + badgeClass + '">' + (b.daysInactive !== null ? b.daysInactive + 'd' : 'Active') + '</span></td>';
          html += '<td>' + highlight(b.author, q) + '</td>';
          html += '<td style="text-align: center;">' + (b.hasOpenPr ? '<span class="badge badge-healthy">✔ Yes</span>' : '<span style="color: var(--text-muted)">No</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      // Contributors Section
      if ((showAll || currentSearchCategory === 'users') && matchedUsers.length > 0) {
        html += '<div style="margin-bottom: 24px;">';
        html += '<h3 style="font-size: 16px; margin-bottom: 12px; color: var(--header-text);">👤 Matching Contributors (' + matchedUsers.length + ')</h3>';
        html += '<div style="overflow-x: auto;"><table><thead><tr><th scope="col">Contributor</th><th scope="col">Repositories</th><th scope="col" style="text-align: center;">Open PRs</th><th scope="col" style="text-align: center;">Inactive PRs</th><th scope="col" style="text-align: center;">Stale Branches</th><th scope="col" style="text-align: center;">Items to Review</th></tr></thead><tbody>';
        matchedUsers.forEach(u => {
          const userAvatar = u.username && u.username !== 'unknown' ? 'https://github.com/' + encodeURIComponent(u.username) + '.png?size=40' : '';
          html += '<tr>';
          html += '<td><div class="user-flex">' + (userAvatar ? '<img src="' + userAvatar + '" class="user-avatar" alt="" onerror="this.style.display=\\'none\\'"> ' : '') + '<strong><a href="https://github.com/' + escapeHtml(u.username) + '" target="_blank">' + highlight(u.username, q) + '</a></strong></div></td>';
          html += '<td>' + u.repositories.map(repo => '<span class="badge badge-tag">' + highlight(repo, q) + '</span>').join('') + '</td>';
          html += '<td style="text-align: center;">' + u.openPrsCount + '</td>';
          html += '<td style="text-align: center;">' + (u.stalePrsCount > 0 ? '<span class="badge badge-warning">⏳ ' + u.stalePrsCount + '</span>' : '0') + '</td>';
          html += '<td style="text-align: center;">' + (u.staleBranchesCount > 0 ? '<span class="badge badge-danger">🍂 ' + u.staleBranchesCount + '</span>' : '0') + '</td>';
          html += '<td style="text-align: center;">' + (u.totalNeedsAttention > 0 ? '<span class="badge badge-warning">⚠️ ' + u.totalNeedsAttention + ' items</span>' : '<span class="badge badge-healthy">✔ All Good</span>') + '</td>';
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      }

      if (html === '') {
        html = '<div class="empty-state">No matching items found for "<strong>' + escapeHtml(q) + '</strong>".<br>Try searching by branch name, PR number, title, author handle, or repository name.</div>';
      }

      container.innerHTML = html;
    }

    console.log('[Dashboard] Loaded with', DASHBOARD_DATA.results.length, 'repositories and', DASHBOARD_DATA.userActivities.length, 'contributors.');

    function clearSearch() {
      console.log('[Dashboard:Search] Cleared search. Returning to view:', previousView);
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
        console.log('[Dashboard:Shortcut] Pressed / to focus search input');
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'Escape' && document.activeElement === searchInput) {
        console.log('[Dashboard:Shortcut] Pressed Escape to clear search');
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
      if (type === 'error') toast.style.background = 'var(--danger)';
      else if (type === 'success') toast.style.background = 'var(--success)';
      else toast.style.background = 'var(--accent)';
      toast.textContent = message;
      setTimeout(() => {
        toast.className = 'toast hidden';
      }, 4000);
    }

    // Trigger Scan via Server API
    async function triggerScan() {
      if (window.location.protocol === 'file:') {
        console.warn('[Dashboard:Scan] Trigger failed: page opened via file:// protocol.');
        alert('To trigger scans directly from the browser, please run the project server using: npm start');
        return;
      }

      console.log('[Dashboard:Action] Triggering repository health scan via POST /api/scan...');
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
        console.log('[Dashboard:API] POST /api/scan response:', data);
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Scan failed');
        }
        showToast('✔ Scan complete! Updating page...', 'success');
        setTimeout(() => {
          window.location.reload();
        }, 600);
      } catch (err) {
        console.error('[Dashboard:API] Scan error:', err);
        showToast('❌ Scan failed: ' + err.message, 'error');
        btn.disabled = false;
        icon.classList.remove('spinning');
        text.textContent = 'Run Report Now';
      }
    }

    // Remove Repository via Server API
    async function handleRemoveRepo(fullName) {
      if (window.location.protocol === 'file:') {
        alert('To manage repositories dynamically, please run the project server using: npm start');
        return;
      }
      if (!confirm('Are you sure you want to stop tracking "' + fullName + '"?')) {
        return;
      }

      const [owner, repo] = fullName.split('/');
      showToast('Removing ' + fullName + '...', 'info');
      try {
        const res = await fetch('/api/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo), {
          method: 'DELETE'
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to remove repository');
        }
        showToast('✔ Removed ' + fullName + '! Refreshing...', 'success');
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        console.error('[Dashboard:API] Remove repo error:', err);
        showToast('❌ ' + err.message, 'error');
      }
    }

    // Add Repository via Server API
    async function handleAddRepo() {
      if (window.location.protocol === 'file:') {
        console.warn('[Dashboard:Repo] Add repo failed: page opened via file:// protocol.');
        alert('To add repositories dynamically, please run the project server using: npm start');
        return;
      }

      const input = document.getElementById('newRepoInput');
      const addBtn = document.getElementById('addRepoBtn');
      const repoStr = input.value.trim();
      if (!repoStr) {
        showToast('Please enter a repository (e.g. facebook/react or github.com/facebook/react)', 'error');
        input.focus();
        return;
      }

      console.log('[Dashboard:Action] Adding repository via POST /api/repos:', repoStr);
      input.disabled = true;
      if (addBtn) addBtn.disabled = true;
      showToast('Verifying ' + repoStr + ' on GitHub...', 'info');

      try {
        const res = await fetch('/api/repos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoStr })
        });
        const data = await res.json();
        console.log('[Dashboard:API] POST /api/repos response:', data);
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to add repository');
        }
        showToast('✔ Repository verified & added! Refreshing...', 'success');
        input.value = '';
        setTimeout(() => window.location.reload(), 600);
      } catch (err) {
        console.error('[Dashboard:API] Add repo error:', err);
        showToast('❌ ' + err.message, 'error');
      } finally {
        input.disabled = false;
        if (addBtn) addBtn.disabled = false;
      }
    }

    // Allow Enter key on newRepoInput
    document.getElementById('newRepoInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddRepo();
    });

    // Live Auto-Reload Stream Client
    (function initLiveReload() {
      if (window.location.protocol === 'file:') return;

      let isReconnecting = false;
      let reconnectInterval = null;

      function connect() {
        const es = new EventSource('/api/live-reload');

        es.addEventListener('connected', () => {
          if (isReconnecting) {
            console.log('[DevServer:LiveReload] Reconnected to server. Reloading page...');
            window.location.reload();
          } else {
            console.log('[DevServer:LiveReload] Live auto-reload stream connected.');
          }
        });

        es.addEventListener('reload', (e) => {
          console.log('[DevServer:LiveReload] Reload event received:', e.data);
          window.location.reload();
        });

        es.onerror = () => {
          es.close();
          isReconnecting = true;
          if (!reconnectInterval) {
            reconnectInterval = setInterval(async () => {
              try {
                const res = await fetch('/api/data', { method: 'GET', cache: 'no-store' });
                if (res.ok) {
                  clearInterval(reconnectInterval);
                  reconnectInterval = null;
                  console.log('[DevServer:LiveReload] Dev server back online. Reloading page...');
                  window.location.reload();
                }
              } catch {
                // Server still restarting...
              }
            }, 250);
          }
        };
      }

      connect();
    })();
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

  logger.action('Generate HTML Dashboard', `Rendering dashboard for ${results.length} repos and ${userActivities.length} contributors`);
  const html = generateHtmlReport(results, userActivities, metadata);

  // 1. Save timestamped archive
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(outputDir, `repo-health-${dateStr}.html`);
  fs.writeFileSync(archivePath, html, 'utf-8');
  logger.info(`Saved HTML report archive: ${archivePath}`);

  // 2. Save latest dashboard (index.html)
  const latestPath = path.join(outputDir, 'index.html');
  fs.writeFileSync(latestPath, html, 'utf-8');
  logger.success(`Updated primary dashboard: ${latestPath} (${html.length} bytes)`);

  return { latestPath, archivePath };
}
