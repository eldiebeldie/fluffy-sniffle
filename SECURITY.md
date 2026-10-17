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

---

## 🔐 Recommended Operational Best Practices

1. **Use Fine-Grained Personal Access Tokens (PATs):**
   - Prefer GitHub **Fine-Grained PATs** over Classic PATs (`repo` scope).
   - Scope the token strictly to the specific repositories you intend to audit, with **Read-only** permissions for `Contents`, `Metadata`, and `Pull requests`.
2. **Use `GITHUB_CA_CERT_PATH` Instead of `GITHUB_ALLOW_INSECURE_TLS`:**
   - In corporate proxy environments, always configure `GITHUB_CA_CERT_PATH=/path/to/corporate-ca.pem` rather than leaving `GITHUB_ALLOW_INSECURE_TLS=true` enabled.
3. **Keep `HOST=127.0.0.1` for Local Usage:**
   - Only override `HOST=0.0.0.0` if you are intentionally deploying behind an authenticated reverse proxy, VPN, or isolated container network, and enable `DASHBOARD_READONLY=true` when exposing the dashboard to multiple viewers.
