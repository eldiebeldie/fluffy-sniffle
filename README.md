# fluffy-sniffle 🔍

> GitHub repository health inspector: scans stale branches, open Pull Requests, and generates clean summaries and an interactive HTML dashboard across multiple repositories.

---

## 🚀 Features

- **Multi-Repository Monitoring:** Add as many repositories as you want via `config.json` or pass them directly as CLI arguments.
- **Interactive HTML Dashboard:** Generates a modern, responsive HTML page with:
  - Metric counters (Total Repos, Stale Branches, Open PRs, Draft PRs, Inactive PRs).
  - Quick-navigation overview table.
  - Per-repository breakdown for stale branches and open PRs.
  - Real-time instant search/filter across all branches and PRs.
  - Direct links to GitHub branches, commits, and PRs.
- **Stale Branch Detection:** Identifies branches with no recent commits past configurable thresholds (default: 30 days stale, 60 days warning), filtering out default branches and indicating if an open PR exists.
- **Pull Request Overview:** Lists open PRs, their age, inactive days since last update, and draft status.
- **Dual API Support:**
  - **GraphQL (Fast):** Uses GraphQL when `GITHUB_TOKEN` is provided to fetch branches, commits, and PRs in a single query per repo.
  - **REST API (Fallback):** Works without a token for public repositories.
- **Reporting Options:**
  - Colorized terminal tables.
  - Self-contained HTML dashboard (`reports/index.html`).
  - Markdown reports (`--markdown`).

---

## 🛠️ Setup

1. **Clone & install dependencies:**
   ```bash
   npm install
   ```

2. **Configure your GitHub Token (Recommended):**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Add your GitHub Personal Access Token (PAT) to `.env`:
   ```env
   GITHUB_TOKEN=ghp_your_personal_access_token_here
   ```
   *(With token: 5,000 requests/hr & fast GraphQL queries. Without token: 60 requests/hr via REST).*

---

## ⚙️ Configuration (`config.json`)

Configure your repositories and thresholds in `config.json`:

```json
{
  "defaultStaleDays": 30,
  "warnStaleDays": 60,
  "repositories": [
    { "owner": "expressjs", "repo": "express" },
    { "owner": "facebook", "repo": "react" }
  ]
}
```

---

## 📖 Usage

### Scan and generate report
```bash
npm start
```
This runs the health check, prints tables in your terminal, and automatically updates the interactive HTML dashboard at:
👉 `reports/index.html`

### Open dashboard directly in your browser
```bash
npm run dashboard
# or:
node src/index.js --open
```

### Scan a specific repository on-the-fly
```bash
node src/index.js owner/repo
# e.g.:
node src/index.js expressjs/express --open
```

### Export a Markdown report
```bash
npm run report:markdown
```