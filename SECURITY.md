# Security & Data Privacy Guide (`SECURITY.md`)

This document details the security architecture of `fluffy-sniffle`, potential data exposure vectors when running the application, the mitigations implemented in the codebase, and operational best practices.

---

## ✅ Built-In Protections (What Does Not Leak)

1. **Zero External Telemetry or Third-Party Requests**
   - The application communicates **exclusively** with `api.github.com` (via `@octokit/rest` and GitHub GraphQL API).
   - The generated HTML dashboard (`src/htmlReporter.js`) is **100% self-contained** — it loads no external scripts, CDNs, fonts, analytics, or tracking pixels.
2. **Strict `GITHUB_TOKEN` Isolation from Client & Reports**
   - Your `GITHUB_TOKEN` and environment variables are **never** serialized into `reports/index.html`, Markdown reports, `reports/.cache.json`, or API responses (`/api/data`, `/api/repos`).
3. **Source Control & Container Build Exclusions**
   - `.gitignore` and `.dockerignore` block `.env`, `.env.*`, private keys, certificate bundles (`*.pem`, `*.crt`, `*.cer`, `*.key`), and the `reports/` directory from being committed to Git or baked into Docker images.

---

## 🛡️ Mitigated Leak Vectors & Hardening Controls

Below are the potential data exposure vectors identified during security auditing and the hardening controls implemented to resolve them:

### 1. Network Exposure & API Authentication (`127.0.0.1` Loopback Binding + `DASHBOARD_API_KEY`)
- **Risk:** Binding an unauthenticated Express server to `0.0.0.0` or leaving `/api/data` and `/api/scan` open allows unauthorized local processes or LAN callers to read full scan datasets or trigger scans using the server's `GITHUB_TOKEN`.
- **Mitigation Applied:**
  - `src/server.js` binds strictly to **`127.0.0.1` (`localhost`)** by default (`const HOST = process.env.HOST || '127.0.0.1'`).
  - `docker-compose.yml` and `package.json` (`docker:run`) map host ports strictly to loopback: `"127.0.0.1:3000:3000"`.
  - **Mandatory API Key Authentication (`/api/*`):** All `/api` endpoints (`GET /api/data`, `POST /api/scan`, `GET /api/repos`, `POST /api/repos`, `DELETE /api/repos/:owner/:repo`, `GET /api/live-reload`) are protected by `requireApiAuth` middleware (`DASHBOARD_API_KEY`). If `DASHBOARD_API_KEY` is not set in `.env`, an ephemeral random key is generated at startup so `/api` routes always reject unauthenticated callers with `401 Unauthorized`.
  - **Optional Root Dashboard Authentication (`DASHBOARD_REQUIRE_AUTH=true`):** Setting `DASHBOARD_REQUIRE_AUTH=true` requires a valid API key to access `GET /`.
  - **Zero Unauthenticated HTML/JS Data Embedding:** `generateHtmlReport()` in `src/htmlReporter.js` and `GET /` in `src/server.js` no longer embed the scanned dataset into unauthenticated HTML/JS responses (`DASHBOARD_DATA` defaults to `{"results":[],"userActivities":[]}` and is hydrated via authenticated `GET /api/data`).
  - **Optional Read-Only Mode (`DASHBOARD_READONLY=true`):** Setting `DASHBOARD_READONLY=true` in `.env` disables `POST /api/repos` and `DELETE /api/repos/:owner/:repo` so the tracked repository list cannot be modified at runtime via the web API.

### 2. Token & Path Redaction in Console & CI/CD Logs
- **Risk:** Printing partial token characters, certificate contents, or machine-specific paths in terminal logs can leak sensitive environment details if stdout is captured in shared or public CI/CD build logs.
- **Mitigation Applied:**
  - `maskToken()` in `src/github.js` performs **full secret redaction**, revealing only the recognized non-secret token type prefix followed by `<TOKEN>` (e.g. `ghp_<TOKEN>`), `<PLACEHOLDER>`, or `<NONE>`.
  - Certificate paths and query parameters in logs are sanitized using `<CERT_PATH>` and `<TOKEN>` placeholders.

### 3. Man-in-the-Middle (MitM) Risk with Insecure TLS
- **Risk:** Enabling `GITHUB_ALLOW_INSECURE_TLS=true` sets `rejectUnauthorized: false` and `NODE_TLS_REJECT_UNAUTHORIZED = '0'`. On an untrusted network, an active MitM attacker could spoof `api.github.com` and intercept the `Authorization` header containing `GITHUB_TOKEN`.
- **Mitigation Applied:**
  - Strict TLS verification is enforced by default (`GITHUB_ALLOW_INSECURE_TLS=false`).
  - First-class custom CA certificate bundle support (`GITHUB_CA_CERT_PATH=<CERT_PATH>`) is applied across both `node:https` (`https.Agent`) and `fetch`/`undici` request paths so enterprise users behind SSL inspection proxies can maintain full certificate chain verification without disabling TLS security.
  - Prominent console warnings are emitted whenever `GITHUB_ALLOW_INSECURE_TLS=true` is used.

### 4. Shell Command Execution When Opening Browser
- **Risk:** Using shell string interpolation (`exec`) to launch the system browser can introduce command injection risks if paths or URLs contain shell metacharacters.
- **Mitigation Applied:**
  - `openInBrowser()` in `src/index.js` and `src/server.js` uses `execFile` with argument arrays rather than raw shell interpolation.

### 5. No-Disk Persistence by Default (`ENABLE_DISK_CACHE=false`, `ENABLE_DISK_REPORTS=false`)
- **Risk:** Automatically writing `reports/index.html`, `reports/repo-health-*.html`, `reports/repo-health-*.md`, and `reports/.cache.json` to disk can leave sensitive private repository branch names, PR titles, and contributor usernames persisted on the local filesystem.
- **Mitigation Applied:**
  - Both disk cache (`saveCache` / `loadCache` in `src/server.js`) and disk report generation (`saveHtmlReport` in `src/htmlReporter.js`, `saveMarkdownReport` in `src/reporter.js`) are **disabled by default**.
  - Disk persistence only occurs if explicitly enabled via `ENABLE_DISK_CACHE=true`, `ENABLE_DISK_REPORTS=true`, or `ENABLE_DISK_PERSISTENCE=true`.

### 6. Restricted-Environment Push & Write Safeguard (`ALLOW_GIT_PUSH=false` / `"allowGitPush": false`)
- **Security Rationale:** When cloning open-source or internal auditing tools into restricted corporate workstations, bastion hosts, or regulated environments, engineers frequently modify `config.json` (e.g., adding private organization repository names) or local scripts. Without an explicit outbound push lock, an accidental `git push` or automated script could inadvertently publish internal repository identifiers or local environment customizations to an upstream remote.
- **Fail-Safe Default (`false`):** Outbound Git pushes and mutating GitHub API operations are **disabled by default** out of the box.
- **Dual-Layer Enforcement:**
  1. **Git `pre-push` Hook (`.githooks/pre-push` & `.githooks/pre-push.js`):** Automatically registered via `git config core.hooksPath .githooks` (and `npm prepare`). Intercepts every `git push` attempt and aborts execution if both `ALLOW_GIT_PUSH` (in `.env`) and `allowGitPush` (in `config.json`) evaluate to `false`, outputting a clear diagnostic banner with step-by-step opt-in instructions.
  2. **Runtime Octokit Request Guard (`src/github.js`):** Registers a `before('request')` hook on the Octokit client that inspects all outgoing API calls and blocks any non-read HTTP method (`POST`, `PUT`, `PATCH`, `DELETE`) or GraphQL `mutation` while `allowGitPush` is `false`.
  3. **Proactive Startup Notice:** Both the CLI (`src/index.js`) and Express server (`src/server.js`) clearly log the active push-protection lock and opt-in instructions at startup.
- **How to Intentionally Authorize Pushes:**
  - **Option 1 (`.env`):** Set `ALLOW_GIT_PUSH=true` in your local `.env` file.
  - **Option 2 (`config.json`):** Set `"allowGitPush": true` in `config.json`.
  - **Option 3 (Single Command):** Prefix a one-off push with `ALLOW_GIT_PUSH=true git push`.

---

## 🔐 Recommended Operational Best Practices

1. **Use Fine-Grained Personal Access Tokens (PATs):**
   - Prefer GitHub **Fine-Grained PATs** over Classic PATs (`repo` scope).
   - Scope the token strictly to the specific `<OWNER/REPO>` repositories you intend to audit, with **Read-only** permissions for `Contents`, `Metadata`, and `Pull requests`.
2. **Configure a Strong `DASHBOARD_API_KEY`:**
   - Set `DASHBOARD_API_KEY=<API_KEY>` in `.env` and set `DASHBOARD_REQUIRE_AUTH=true` if you want the root `/` route gated alongside `/api/*`.
3. **Use `GITHUB_CA_CERT_PATH` Instead of `GITHUB_ALLOW_INSECURE_TLS`:**
   - In corporate proxy environments, always configure `GITHUB_CA_CERT_PATH=<CERT_PATH>` rather than leaving `GITHUB_ALLOW_INSECURE_TLS=true` enabled.
4. **Keep `HOST=127.0.0.1` and `ALLOW_GIT_PUSH=false` in Restricted Environments:**
   - Leave `ALLOW_GIT_PUSH=false` (`"allowGitPush": false`) enabled during all routine auditing in restricted or corporate environments, and only toggle it to `true` when intentionally publishing vetted code changes upstream.
