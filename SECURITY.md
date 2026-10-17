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

### 1. Network Exposure of Web Server & API (`127.0.0.1` Loopback Binding)
- **Risk:** Binding an unauthenticated Express server to `0.0.0.0` (all network interfaces) allows other devices on the same LAN/Wi-Fi to view `/api/data` (exposing private repository branch/PR metadata) or send `POST /api/repos` requests to probe private repositories using the server's `GITHUB_TOKEN`.
- **Mitigation Applied:**
  - `src/server.js` now binds strictly to **`127.0.0.1` (`localhost`)** by default (`const HOST = process.env.HOST || '127.0.0.1'`).
  - `docker-compose.yml` and `package.json` (`docker:run`) now map host ports strictly to loopback: `"127.0.0.1:3000:3000"`.
  - **Optional Read-Only Mode (`DASHBOARD_READONLY=true`):** Setting `DASHBOARD_READONLY=true` in `.env` disables `POST /api/repos` and `DELETE /api/repos/:owner/:repo` so the tracked repository list cannot be modified at runtime via the web API.

### 2. Token Redaction in Console & CI/CD Logs
- **Risk:** Printing the last 4 characters of a Personal Access Token (e.g., `ghp_...abcd`) in terminal logs can leak partial token entropy if stdout is captured in shared or public CI/CD build logs.
- **Mitigation Applied:**
  - `maskToken()` in `src/github.js` now performs **full secret redaction**. It reveals only the recognized non-secret token type prefix (`ghp_`, `github_pat_`, `gho_`, `ghs_`, `ghr_`) followed by fixed asterisks (`ghp_****...****`), or `<REDACTED>` for custom tokens. Zero secret characters from the token body or suffix are ever printed.

### 3. Man-in-the-Middle (MitM) Risk with Insecure TLS
- **Risk:** Enabling `GITHUB_ALLOW_INSECURE_TLS=true` sets `rejectUnauthorized: false` and `NODE_TLS_REJECT_UNAUTHORIZED = '0'`. On an untrusted network, an active MitM attacker could spoof `api.github.com` and intercept the `Authorization` header containing `GITHUB_TOKEN`.
- **Mitigation Applied:**
  - Strict TLS verification is enforced by default (`GITHUB_ALLOW_INSECURE_TLS=false`).
  - First-class custom CA certificate bundle support (`GITHUB_CA_CERT_PATH`) is provided so enterprise users behind SSL inspection proxies can maintain full certificate chain verification without disabling TLS security.
  - Prominent console warnings are emitted whenever `GITHUB_ALLOW_INSECURE_TLS=true` is used.

### 4. Shell Command Execution When Opening Browser
- **Risk:** Using shell string interpolation (`exec`) to launch the system browser can introduce command injection risks if paths or URLs contain shell metacharacters.
- **Mitigation Applied:**
  - `openInBrowser()` in `src/index.js` and `src/server.js` uses `execFile` with argument arrays rather than raw shell interpolation.

### 5. Local Disk Persistence (`reports/` & `reports/.cache.json`)
- **Risk:** Scanning private repositories writes branch names, PR titles, and contributor usernames into `reports/index.html`, `reports/repo-health-*.html`, `reports/repo-health-*.md`, and `reports/.cache.json`.
- **Operational Guidance:**
  - Do not publicly host or share generated files from `reports/` if your scan includes private internal repositories, as `reports/index.html` embeds the full scan dataset (`dashboardDataJson`) for client-side search and filtering.

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
   - Scope the token strictly to the specific repositories you intend to audit, with **Read-only** permissions for `Contents`, `Metadata`, and `Pull requests`.
2. **Use `GITHUB_CA_CERT_PATH` Instead of `GITHUB_ALLOW_INSECURE_TLS`:**
   - In corporate proxy environments, always configure `GITHUB_CA_CERT_PATH=/path/to/corporate-ca.pem` rather than leaving `GITHUB_ALLOW_INSECURE_TLS=true` enabled.
3. **Keep `HOST=127.0.0.1` and `ALLOW_GIT_PUSH=false` in Restricted Environments:**
   - Leave `ALLOW_GIT_PUSH=false` (`"allowGitPush": false`) enabled during all routine auditing in restricted or corporate environments, and only toggle it to `true` when intentionally publishing vetted code changes upstream.
