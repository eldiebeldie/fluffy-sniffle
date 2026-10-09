# fluffy-sniffle 🔍

> GitHub repository health inspector: scans stale branches, open Pull Requests, and generates clean summaries and an interactive HTML dashboard across multiple repositories.

---

## 🚀 Features

- **Multi-Repository Monitoring:** Add as many repositories as you want via `config.json` or pass them directly as CLI arguments.
- **Dual Dashboard Views in HTML:**
  - 🏢 **Repository Health View:** Repo-level health, stale branch lists, open PR tables, and health status indicators.
  - 👤 **Contributor Activities View:** Aggregates activity per developer across all monitored repositories. Shows open PRs, stale PRs, stale branches authored by each user, and review attention indicators.
- **Global Item Search Engine:**
  - Instantly searches across **all items**: Pull Requests (title, #, author), Branches (name, author), Contributors (usernames, repos), and Repositories.
  - **Category Filter Chips:** Filter search results on the fly by `All`, `Pull Requests`, `Branches`, `Contributors`, or `Repositories`.
  - **Keyword Highlighting:** Matches are highlighted (`<mark>`) in titles, branch names, and usernames.
  - **Keyboard Shortcuts:** Press `/` anywhere to focus the search bar, and `Escape` (or click `✕`) to clear and exit search.
- **Interactive HTML Dashboard:** Generates a modern, responsive HTML page with:
  - Metric counters (Total Repos, Active Contributors, Stale Branches, Open PRs, Draft PRs, Inactive PRs).
  - Contributor leaderboard with GitHub avatars and links.
  - Quick-navigation overview table.
  - Per-repository & per-contributor breakdown cards.
  - Direct links to GitHub branches, commits, and PRs.
- **Stale Branch Detection:** Identifies branches with no recent commits past configurable thresholds (default: 30 days stale, 60 days warning), filtering out default branches and indicating if an open PR exists.
- **Pull Request Overview:** Lists open PRs, their age, inactive days since last update, author, and draft status.
- **Dual API Support:**
  - **GraphQL (Fast):** Uses GraphQL when `GITHUB_TOKEN` is provided to fetch branches, commits, and PRs in a single query per repo.
  - **REST API (Fallback):** Works without a token for public repositories.
- **Reporting Options:**
  - Colorized terminal tables (Repository summary + Contributor summary).
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

### 🌐 Start the Web Server (Recommended)
```bash
npm start
```
Starts the Express server on `http://localhost:3000` and automatically opens the dashboard in your default browser.
- **🔄 Trigger Scan in UI:** Click the **"Run Report Now"** button in the header to re-scan all repositories on demand.
- **➕ Add Repository in UI:** Type `owner/repo` (e.g. `facebook/react`) in the header input and click **"+ Add"** to save it to `config.json` and immediately scan it.
- **Toggle Views:** Switch between **🏢 Repositories View** and **👤 Contributor Activities**.
- **Live Search:** Instant filter across all branches, PRs, and users.

```bash
# Start server without auto-opening browser:
npm run server
```

---

### 💻 CLI Runner (Terminal Mode)

If you prefer running scans in your terminal or in a CI/CD pipeline:

```bash
# Run configured repositories in terminal:
npm run cli

# Scan an ad-hoc repository:
node src/index.js owner/repo

# Generate Markdown report:
npm run report:markdown
```

---

## 🔌 Server API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Serves the interactive dashboard HTML |
| `POST` | `/api/scan` | Triggers a fresh repository scan on demand |
| `GET` | `/api/data` | Returns current scan health metrics & user activities as JSON |
| `GET` | `/api/repos` | Returns the list of configured repositories |
| `POST` | `/api/repos` | Adds a new repository `{ owner, repo }` to `config.json` and scans |
| `DELETE` | `/api/repos/:owner/:repo` | Removes a repository from tracking |