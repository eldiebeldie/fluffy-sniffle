# fluffy-sniffle 🔍⚡

<div align="center">

![GitHub Health Analyzer](https://img.shields.io/badge/GitHub-Health%20Analyzer-181717?style=for-the-badge&logo=github&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.x-000000?style=for-the-badge&logo=express&logoColor=white)
![GraphQL](https://img.shields.io/badge/GraphQL-Enabled-E10098?style=for-the-badge&logo=graphql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

<br/>

**An enterprise-grade, real-time GitHub repository health & contributor analytics engine.**  
*Track stale branches, audit open pull requests, benchmark team activities, and eliminate technical debt across multiple repositories.*

</div>

---

## 👤 Author & Creator

| Detail | Information |
| :--- | :--- |
| **Creator & Owner** | **EldieBeldie** |
| **GitHub** | [@EldieBeldie](https://github.com/EldieBeldie) |
| **Email** | [eldargr@gmail.com](mailto:eldargr@gmail.com) |
| **Code Ownership** | Defined in [`.github/CODEOWNERS`](.github/CODEOWNERS) (`@EldieBeldie`) |
| **Project** | [fluffy-sniffle](https://github.com/EldieBeldie/fluffy-sniffle) |

> *"Built to provide engineering teams with crystal-clear visibility into repository hygiene, cross-project contributor momentum, and open PR bottlenecks without friction."*

---

## 🏛️ System Architecture

`fluffy-sniffle` is architected as an event-driven, dual-engine inspection pipeline. It seamlessly connects with GitHub via authenticated GraphQL or unauthenticated REST, processes branch and PR trees through a multi-pass analyzer, aggregates developer metrics cross-repository, and delivers real-time intelligence via an Express web server, interactive HTML dashboard, and CLI runner.

### 📐 High-Level Architectural Flow

```mermaid
flowchart TD
    subgraph DataSources["GitHub API Sources"]
        GH_GQL["GitHub GraphQL API (Authenticated, Fast)"]
        GH_REST["GitHub REST API v3 (Public Fallback)"]
    end

    subgraph CoreEngine["Core Analysis & Ingestion Engine"]
        GH_CLIENT["GitHub Client (src/github.js)"]
        ANALYZER["Health Analyzer (src/analyzer.js)"]
        AGGREGATOR["Contributor Aggregator (src/analyzer.js)"]
        LOGGER["Activity Logger (src/logger.js)"]
    end

    subgraph StorageConfig["Configuration & Persistence"]
        CONFIG["config.json (Tracked Repos & Thresholds)"]
        CACHE["In-Memory Cache (Live Results & State)"]
        REPORTS["reports/ (HTML & Markdown Archives)"]
    end

    subgraph Delivery["Delivery & Presentation Layer"]
        SERVER["Express Server (src/server.js)"]
        CLI["CLI Runner (src/index.js)"]
        HTML_DASH["Interactive HTML Dashboard"]
        TERM_VIEW["Colorized Terminal Tables"]
        MD_EXPORT["Markdown Health Reports"]
    end

    GH_CLIENT -->|Fetch Trees & PRs| GH_GQL
    GH_CLIENT -->|Fallback Request| GH_REST
    CONFIG -->|Repo List & Thresholds| GH_CLIENT
    GH_CLIENT --> ANALYZER
    ANALYZER -->|Repo Metrics| AGGREGATOR
    ANALYZER -.->|Logs Activities| LOGGER
    AGGREGATOR --> CACHE
    CACHE --> SERVER
    CACHE --> CLI
    SERVER -->|Serves on :3000| HTML_DASH
    SERVER -->|On-demand API Triggers| GH_CLIENT
    CLI --> TERM_VIEW
    CLI --> MD_EXPORT
    HTML_DASH --> REPORTS
```

---

### 🔄 In-Page On-Demand Scan Sequence

When you trigger a scan directly from the web interface, the following asynchronous lifecycle executes:

```mermaid
sequenceDiagram
    autonumber
    actor User as Developer / Lead
    participant UI as HTML Dashboard (Browser)
    participant Server as Express Server (:3000)
    participant Client as GitHub Client
    participant Analyzer as Health Analyzer
    participant Store as Reports Storage

    User->>UI: Clicks "Run Report Now" (or Adds Repo)
    UI->>UI: Disables Button, Spins Icon, Shows Toast
    UI->>Server: POST /api/scan (or POST /api/repos)
    Note over Server: Validates non-collision lock (isScanning = true)
    Server->>Client: performScan(configuredRepos)
    loop For each tracked repository
        Client->>Client: Check GITHUB_TOKEN (GraphQL vs REST)
        Client-->>Server: Raw branches, commits & PR payloads
        Server->>Analyzer: analyzeRepository(repoData, thresholds)
        Analyzer-->>Server: Stale branches, age metrics, draft status
    end
    Server->>Analyzer: aggregateUserActivities(allResults)
    Analyzer-->>Server: Multi-repo contributor rankings & review items
    Server->>Store: saveHtmlReport() -> reports/index.html & archive
    Server-->>UI: 200 OK { success: true, count, lastScanTime }
    UI->>UI: Shows Success Toast & Reloads Fresh View
    User->>UI: Inspects updated charts, tables & search results
```

---

### 🍂 Branch & PR Staleness Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> Active: Commit Pushed / PR Created
    Active --> Stale: Inactive >= 30 days
    Stale --> CriticalStale: Inactive >= 60 days
    
    state Active {
        [*] --> InReview: PR Opened
        InReview --> Merged: PR Merged
        InReview --> Draft: Converted to Draft
        Draft --> InReview: Marked Ready
    }
    
    state Stale {
        HasActivePR: Associated with Open PR
        Abandoned: No Open PR
    }
    
    CriticalStale --> CleanedUp: Branch Deleted / PR Closed
    Merged --> CleanedUp: Branch Deleted
    CleanedUp --> [*]
```

---

## ✨ Features & Capabilities

- **⚡ Blazing Multi-Repository Audits:** Monitor dozens of repositories simultaneously without touching Git locally.
- **🏢 Repository Health View:** Inspect default branches, private/public status, and categorized branch lists with staleness counters.
- **👤 Contributor Activities & All-Time Details:**
  - **All-Time Scope Option:** Toggle between `🌐 All Times (Complete History)` and `⚠️ Needs Attention Only` with instant switching and persistence in `localStorage`.
  - **All-Time Pull Requests & Branches:** View complete contributor work including merged PRs, closed PRs, active branches, stale branches, and acceptance merge rates.
  - **In-Card Interactive Filter Tabs:** Filter PRs (`All`, `Open`, `Merged`, `Closed`) and branches (`All`, `Active`, `Stale`) directly inside each contributor card.
  - **CLI Support:** Run `npm run cli -- --all-time` for colorized terminal tables with complete contributor lifespans and metrics.
- **🔍 Global Instant Search Engine:**
  - Full-text search across PR titles, PR numbers, branch names, commit authors, and repository names.
  - Category filter chips: `All`, `Pull Requests`, `Branches`, `Contributors`, `Repositories`.
  - In-place `<mark>` keyword highlighting.
  - Keyboard shortcuts: Press <kbd>/</kbd> to focus, <kbd>Escape</kbd> to clear.
- **🔄 In-Browser Interactive Controls:**
  - **"Run Report Now" button:** Trigger fresh scans on demand with zero page reloads needed.
  - **"Add Repo" input:** Add new repositories (`owner/repo`) right from the web header to persist and scan instantly.
- **📡 Dual API Architecture:**
  - **GraphQL (Primary):** Authenticated via `GITHUB_TOKEN` for 5,000 req/hr rate limit and batched single-query tree fetches.
  - **REST v3 (Fallback):** Works unauthenticated out of the box for public repositories.
- **🎨 4 Accessible Visual Themes & Section 508 / WCAG Compliance:**
  - 🌙 **Dark (Default):** Deep slate background (`#0f172a`), refined borders, and gentle accents.
  - ☀️ **Light:** Crisp daytime layout with high contrast ($\ge 4.5:1$ contrast ratio).
  - 🌌 **Midnight:** Oceanic navy palette with vivid cyan and sapphire accents.
  - 👁️ **High Contrast (Section 508 / WCAG AAA):** Pure black (`#000000`) canvas, pure white (`#ffffff`) text, high-visibility borders ($\ge 7:1$ contrast ratio).
  - **Section 508 Features:** Skip-to-content navigation links, visible focus indicator rings (`:focus-visible`), dual visual indicators (icons + text labels so information doesn't rely solely on color), semantic table headers (`scope="col"`), screen-reader labels (`.sr-only`), and `localStorage` persistence.
- **🔒 Enterprise TLS & Custom CA Integration:** Built-in custom CA certificate bundle support (`GITHUB_CA_CERT_PATH` / `NODE_EXTRA_CA_CERTS`) and diagnostic insecure TLS toggle (`GITHUB_ALLOW_INSECURE_TLS`). Ensures reliable operation behind corporate proxies, custom PKI infrastructures, and enterprise firewall gateways across both Node HTTPS and fetch/undici HTTP transports.
- **🛡️ Masked Credential Logging & Placeholder Detection:** Startup credential inspection with strict token masking (`ghp_****...abcd`), proactive warnings for unconfigured placeholder values (`your_github_pat_token_here`), and explicit owner/repo GitHub URLs (`https://github.com/owner/repo`) on all fetch, scan, success, and error logs.
- **📝 Comprehensive Activity Logging:** Colorized console logging with precise millisecond timestamps, action tags, and HTTP request tracking.

---

## 🛠️ Quickstart & Setup

### 1. Clone & Install
```bash
git clone https://github.com/EldieBeldie/fluffy-sniffle.git
cd fluffy-sniffle
npm install
```

### 2. Configure Environment (`.env`)
Copy the environment template:
```bash
cp .env.example .env
```

Configure your credentials and TLS options in `.env`:
```env
# GitHub Personal Access Token (Classic with repo scope, or Fine-grained with PR/Contents Read)
GITHUB_TOKEN=ghp_your_token_here

# Optional: Custom CA certificate bundle (e.g. corporate proxy or private root CA)
# GITHUB_CA_CERT_PATH=C:/certs/corporate-root-ca.pem

# Optional: Insecure TLS mode for local troubleshooting only (default: false)
GITHUB_ALLOW_INSECURE_TLS=false
```

---

## ⚙️ Configuration (`config.json`)

Configure stale thresholds and your target repositories in `config.json`:

```json
{
  "defaultStaleDays": 30,
  "warnStaleDays": 60,
  "repositories": [
    { "owner": "expressjs", "repo": "express" },
    { "owner": "fastify", "repo": "fastify" },
    { "owner": "octokit", "repo": "octokit.js" },
    { "owner": "sindresorhus", "repo": "chalk" }
  ]
}
```

---

## 📖 Usage

### ⚡ Live Auto-Reload Dev Server (Development Mode)
```bash
npm run dev
```
*Starts the dev server with live auto-reload enabled! Watches all code in `src/` and `config.json`. When you modify styles, templates, or configuration, the browser re-renders automatically in ~300ms without manual refreshing.*

```bash
# Start dev server without auto-opening browser:
npm run dev:no-open
```

### 🌐 Launch the Interactive Web Dashboard (Production Mode)
```bash
npm start
```
*Starts the Express server on `http://localhost:3000` and automatically launches your browser.*

```bash
# Start server without auto-opening browser:
npm run server
```

### 💻 CLI Runner (Terminal / CI-CD Mode)
```bash
# Scan configured repositories in terminal:
npm run cli

# Scan an ad-hoc repository on-the-fly:
node src/index.js facebook/react

# Export a Markdown report:
npm run report:markdown
```

### 🐳 Run with Docker & Docker Compose

#### Option A: Docker Compose (Recommended)
```bash
# Start the container in background:
docker compose up -d

# View live container logs:
docker compose logs -f

# Stop the container:
docker compose down
```
*Access the dashboard at `http://localhost:3000`. Reports persist in `./reports` on your host machine.*

#### Option B: Docker CLI
```bash
# Build the production image:
npm run docker:build

# Run container with mounted reports volume:
docker run -d -p 3000:3000 \
  --name fluffy-sniffle \
  --env-file .env \
  -v ${PWD}/reports:/app/reports \
  fluffy-sniffle
```

---

## 🔌 REST API Endpoints

The built-in Express server exposes a clean REST API:

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Serves the interactive HTML dashboard |
| `POST` | `/api/scan` | Triggers a fresh multi-repository health scan |
| `GET` | `/api/data` | Returns current metrics and contributor activity as JSON |
| `GET` | `/api/repos` | Returns the list of tracked repositories |
| `POST` | `/api/repos` | Body: `{ owner, repo }` — Adds repo to `config.json` and immediately scans |
| `DELETE` | `/api/repos/:owner/:repo` | Removes repository from tracking |

---

## 📁 Project Structure

```
fluffy-sniffle/
├── .env.example          # Environment token template
├── .gitignore            # Ignores node_modules, .env, and reports
├── config.json           # Tracked repositories and staleness thresholds
├── package.json          # Dependencies, scripts, and author metadata
├── reports/              # Generated HTML dashboards & Markdown reports
│   └── index.html        # Always-latest interactive web dashboard
└── src/
    ├── analyzer.js       # Staleness detection & cross-repo contributor aggregator
    ├── github.js         # Octokit GraphQL client & REST fallback
    ├── htmlReporter.js   # Dynamic HTML generator & client search engine
    ├── index.js          # CLI scanner entrypoint
    ├── logger.js         # Colorized timestamped activity logging utility
    ├── reporter.js       # Terminal tables & Markdown export formatter
    └── server.js         # Express web server with live in-page triggers
```

---

## 🔐 Enterprise TLS, Custom CA & Proxy Troubleshooting

In enterprise environments with SSL/TLS inspection proxies (e.g., corporate firewalls, Zscaler, Netskope, or internal PKI gateways), outbound requests to GitHub APIs may encounter certificate trust failures:
```
Error: self-signed certificate in certificate chain
```

`fluffy-sniffle` provides first-class configuration options to handle enterprise environments securely across both Node HTTPS and Undici/`fetch` client paths:

### 1. Custom CA Certificate Bundle (Recommended for Enterprise)
Export your corporate root and intermediate CA certificates to a `.pem` bundle file and configure `GITHUB_CA_CERT_PATH` in `.env`:
```env
GITHUB_CA_CERT_PATH=C:/certs/corporate-root-ca.pem
```
The client automatically loads the bundle into the underlying `https.Agent` and assigns `NODE_EXTRA_CA_CERTS`.

### 2. Insecure TLS Mode (Local Diagnostics & Troubleshooting Only)
For temporary local debugging or staging sandbox tests:
```env
GITHUB_ALLOW_INSECURE_TLS=true
```
> [!WARNING]
> Insecure TLS mode bypasses server certificate verification (`NODE_TLS_REJECT_UNAUTHORIZED='0'`). Use exclusively for local troubleshooting. It must **never** be enabled in production environments.

### 3. Credential Safety & Logging
- **Masked Token Output:** Token presence is logged only in masked format (`ghp_****...abcd`). Plaintext secrets are never emitted to logs or stdout.
- **Placeholder Detection:** If `.env` contains template defaults (e.g., `your_github_pat_token_here`), a descriptive warning is logged and the application safely falls back to the unauthenticated public REST API.
- **Clear Repository Logging:** Every fetch, scan, success, and error message outputs the full GitHub URL (`https://github.com/<owner>/<repo>`) for immediate traceability.

---

## 📜 License

Created with ❤️ by **[EldieBeldie](https://github.com/EldieBeldie)**. Released under the **[MIT License](LICENSE)**.