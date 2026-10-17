import express from 'express';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import chalk from 'chalk';
import dotenv from 'dotenv';
import {
  getRepositoryHealthData,
  parseRepoString,
  hasToken,
  token,
  maskToken,
  isPlaceholder,
  isPlaceholderToken,
  logPushProtectionStatus,
} from './github.js';
import { analyzeRepository, aggregateUserActivities } from './analyzer.js';
import { generateHtmlReport, saveHtmlReport, isDiskReportEnabled } from './htmlReporter.js';
import { logger } from './logger.js';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
// Bind strictly to localhost (127.0.0.1) by default to prevent unintended LAN exposure
const HOST = process.env.HOST || '127.0.0.1';
// Optional read-only lock for POST/DELETE /api/repos endpoints
const isReadOnly =
  process.env.DASHBOARD_READONLY === 'true' || process.env.DASHBOARD_READONLY === '1';
// Optional authentication requirement for the root / dashboard route
const isDashboardAuthRequired =
  process.env.DASHBOARD_REQUIRE_AUTH === 'true' ||
  process.env.DASHBOARD_REQUIRE_AUTH === '1' ||
  process.env.DASHBOARD_AUTH_REQUIRED === 'true' ||
  process.env.DASHBOARD_AUTH_REQUIRED === '1';
// No-disk persistence by default: cache and HTML/Markdown reports are only written when explicitly enabled
const enableDiskCache =
  process.env.ENABLE_DISK_CACHE === 'true' ||
  process.env.ENABLE_DISK_CACHE === '1' ||
  process.env.ENABLE_DISK_PERSISTENCE === 'true' ||
  process.env.ENABLE_DISK_PERSISTENCE === '1';
const enableDiskReports = isDiskReportEnabled();
const enableEmbeddedReportData =
  process.env.ENABLE_EMBEDDED_REPORT_DATA === 'true' ||
  process.env.ENABLE_EMBEDDED_REPORT_DATA === '1';

// API key authentication for all /api/* routes (falls back to an ephemeral key if unconfigured or placeholder)
const rawConfiguredApiKey = (process.env.DASHBOARD_API_KEY || process.env.API_KEY || '').trim();
const isApiKeyPlaceholder = isPlaceholderToken(rawConfiguredApiKey);
const hasConfiguredApiKey = Boolean(rawConfiguredApiKey && !isApiKeyPlaceholder);
// Always enforce an active API key on /api routes (ephemeral key if not configured in .env)
const activeApiKey = hasConfiguredApiKey
  ? rawConfiguredApiKey
  : crypto.randomBytes(24).toString('hex');

const configPath = path.resolve(process.cwd(), 'config.json');

const isDevMode = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const cachePath = enableDiskCache ? path.resolve(process.cwd(), 'reports', '.cache.json') : null;
const sseClients = new Set();

// In-memory cache
let cachedResults = [];
let cachedUserActivities = [];
let cachedFailedRepos = [];
let lastScanTime = null;
let isScanning = false;

app.use(express.json());

/**
 * Redacts sensitive query parameters (e.g. apiKey, token) from logged request URLs
 */
function sanitizeRequestPath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  return rawPath.replace(/([?&](?:api[_-]?key|token)=)[^&#]*/gi, '$1<TOKEN>');
}

/**
 * Extracts API key from X-API-Key header, Authorization Bearer/Basic header, or query parameter
 */
function extractRequestApiKey(req) {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return headerKey.trim();
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.trim()) {
    const trimmed = authHeader.trim();
    if (/^Bearer\s+/i.test(trimmed)) {
      return trimmed.replace(/^Bearer\s+/i, '').trim();
    }
    if (/^Basic\s+/i.test(trimmed)) {
      try {
        const decoded = Buffer.from(trimmed.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf-8');
        const colonIdx = decoded.indexOf(':');
        const passPart = colonIdx >= 0 ? decoded.slice(colonIdx + 1) : decoded;
        const userPart = colonIdx >= 0 ? decoded.slice(0, colonIdx) : '';
        return (passPart || userPart).trim();
      } catch {
        return '';
      }
    }
  }

  const queryKey = req.query?.apiKey || req.query?.api_key;
  if (typeof queryKey === 'string' && queryKey.trim()) {
    return queryKey.trim();
  }

  return '';
}

/**
 * Constant-time API key verification
 */
function isRequestAuthenticated(req) {
  const provided = extractRequestApiKey(req);
  if (!provided || !activeApiKey) return false;
  const providedBuf = Buffer.from(provided, 'utf-8');
  const expectedBuf = Buffer.from(activeApiKey, 'utf-8');
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

/**
 * Middleware: Require API key authentication on all /api routes
 */
function requireApiAuth(req, res, next) {
  if (!isRequestAuthenticated(req)) {
    logger.warn(
      `Unauthorized API request rejected: ${req.method} ${sanitizeRequestPath(req.originalUrl || req.url)}`
    );
    return res.status(401).json({
      success: false,
      error:
        'Unauthorized: valid API key required. Provide X-API-Key or Authorization: Bearer <API_KEY> header.',
    });
  }
  next();
}

/**
 * Middleware: Optional authentication for root / dashboard route when DASHBOARD_REQUIRE_AUTH=true
 */
function optionalDashboardAuth(req, res, next) {
  if (isDashboardAuthRequired && !isRequestAuthenticated(req)) {
    logger.warn(
      `Unauthorized dashboard request rejected (DASHBOARD_REQUIRE_AUTH=true): ${req.method} ${sanitizeRequestPath(req.originalUrl || req.url)}`
    );
    res.setHeader('WWW-Authenticate', 'Bearer realm="Fluffy-Sniffle Dashboard"');
    return res.status(401).send(
      '401 Unauthorized: Dashboard authentication is enabled (DASHBOARD_REQUIRE_AUTH=true). Provide a valid API key via X-API-Key or Authorization header.'
    );
  }
  next();
}

// Request duration and access logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const safePath = sanitizeRequestPath(req.originalUrl || req.url);

  res.on('finish', () => {
    const elapsedMs = Date.now() - startTime;
    const status = res.statusCode;
    const logMsg = `${req.method} ${safePath} -> ${status} (${elapsedMs}ms)`;
    if (status >= 400) {
      logger.error(`[HTTP] ${logMsg}`);
    } else {
      logger.action('HTTP Request', logMsg);
    }
  });

  next();
});

// Protect all /api routes with API key authentication middleware
app.use('/api', requireApiAuth);

function openInBrowser(url) {
  logger.action('Open Browser', url);
  const [cmd, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];

  execFile(cmd, args, (err) => {
    if (err) {
      logger.warn(`Could not automatically launch browser: ${err.message}`);
    }
  });
}

/**
 * Save scan cache to disk only when ENABLE_DISK_CACHE=true (disabled by default)
 */
function saveCache(data) {
  if (!enableDiskCache || !cachePath) {
    return;
  }
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ version: 2, ...data }, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`Could not save disk cache: ${err.message}`);
  }
}

/**
 * Load scan cache from disk only when ENABLE_DISK_CACHE=true (disabled by default)
 */
function loadCache() {
  if (!enableDiskCache || !cachePath) {
    return null;
  }
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      if (data.version === 2 && Array.isArray(data.results) && data.results.length > 0) {
        return data;
      }
    } catch (err) {
      logger.warn(`Could not read disk cache: ${err.message}`);
    }
  }
  return null;
}

/**
 * Broadcast live-reload event to all connected browsers
 */
export function broadcastReload(reason = 'change') {
  if (sseClients.size === 0) return;
  logger.action('Live Reload', `Broadcasting reload to ${sseClients.size} browser(s) (${reason})`);
  for (const client of sseClients) {
    try {
      client.write(`event: reload\ndata: ${JSON.stringify({ reason, timestamp: Date.now() })}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Load configuration
 */
function loadConfig() {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (err) {
      logger.error(`Error reading config.json: ${err.message}`);
    }
  }
  return { defaultStaleDays: 30, warnStaleDays: 60, repositories: [] };
}

/**
 * Save configuration
 */
function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  logger.info('Updated config.json');
}

/**
 * Perform health scan across repositories
 */
async function performScan(customRepos = null) {
  if (isScanning) {
    logger.warn('Scan request rejected: a scan is already currently in progress.');
    throw new Error('A scan is already in progress. Please wait.');
  }

  isScanning = true;
  const startTime = Date.now();
  logger.action('Scan Start', 'Beginning comprehensive multi-repository scan');

  try {
    const config = loadConfig();
    const reposToScan = customRepos || config.repositories || [];

    if (reposToScan.length === 0) {
      logger.warn('No repositories configured to scan.');
      cachedResults = [];
      cachedUserActivities = [];
      cachedFailedRepos = [];
      lastScanTime = new Date().toISOString();
      return { results: [], userActivities: [], failedRepos: [], lastScanTime };
    }

    const results = [];
    const failedRepos = [];
    for (const { owner, repo } of reposToScan) {
      const repoUrl = `https://github.com/${owner}/${repo}`;
      logger.info(`Starting scan for ${owner}/${repo} (${repoUrl})...`);
      try {
        const rawData = await getRepositoryHealthData(owner, repo);
        const analyzed = analyzeRepository(rawData, {
          staleDaysThreshold: config.defaultStaleDays || 30,
          warnStaleDays: config.warnStaleDays || 60,
        });
        results.push(analyzed);
      } catch (err) {
        logger.error(`Failed to scan ${owner}/${repo} (${repoUrl}): ${err.message}`);
        failedRepos.push({ owner, repo, error: err.message, url: repoUrl });
      }
    }

    cachedResults = results;
    cachedUserActivities = aggregateUserActivities(results);
    cachedFailedRepos = failedRepos;
    lastScanTime = new Date().toISOString();

    // Persist to reports/index.html only when explicitly enabled via ENABLE_DISK_REPORTS=true
    if (enableDiskReports) {
      saveHtmlReport(cachedResults, cachedUserActivities, {
        lastScanTime,
        failedRepos: cachedFailedRepos,
        isDev: isDevMode,
        embedData: enableEmbeddedReportData,
      });
    }

    // Save to disk cache only when explicitly enabled via ENABLE_DISK_CACHE=true
    if (enableDiskCache) {
      saveCache({
        results: cachedResults,
        userActivities: cachedUserActivities,
        failedRepos: cachedFailedRepos,
        lastScanTime,
        repoKeys: (config.repositories || []).map((r) => `${r.owner}/${r.repo}`).sort(),
      });
    }

    const elapsedMs = Date.now() - startTime;
    logger.success(
      `Multi-repo scan completed in ${elapsedMs}ms (${results.length} repos analyzed, ${failedRepos.length} failed)`
    );

    // Notify connected browser clients to reload
    broadcastReload('scan-completed');

    return {
      results: cachedResults,
      userActivities: cachedUserActivities,
      failedRepos: cachedFailedRepos,
      lastScanTime,
    };
  } finally {
    isScanning = false;
  }
}

// ----------------------------------------------------
// Routes
// ----------------------------------------------------

/**
 * Main dashboard view (with optional authentication via DASHBOARD_REQUIRE_AUTH=true)
 * Unauthenticated responses never embed the scanned dataset in HTML or JS.
 */
app.get('/', optionalDashboardAuth, (req, res) => {
  const authenticated = isRequestAuthenticated(req);
  logger.info(
    `Rendering dashboard for client request (authenticated: ${authenticated ? 'yes' : 'no'})`
  );
  const html = generateHtmlReport(
    authenticated ? cachedResults : [],
    authenticated ? cachedUserActivities : [],
    {
      lastScanTime,
      failedRepos: authenticated ? cachedFailedRepos : [],
      isDev: isDevMode,
      embedData: authenticated && enableEmbeddedReportData,
      requiresClientAuth: !authenticated,
    }
  );
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * API: Server-Sent Events for Live Auto-Reload
 */
app.get('/api/live-reload', requireApiAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

/**
 * API: Trigger scan on-demand (Protected by API key authentication)
 */
app.post('/api/scan', requireApiAuth, async (req, res) => {
  logger.action('API Trigger', 'POST /api/scan requested by authenticated user');
  try {
    const data = await performScan();
    logger.success(`POST /api/scan finished: ${data.results.length} repos updated`);
    res.json({ success: true, ...data });
  } catch (err) {
    logger.error(`POST /api/scan failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Get current status and cached data (Protected by API key authentication)
 */
app.get('/api/data', requireApiAuth, (req, res) => {
  res.json({
    isScanning,
    lastScanTime,
    results: cachedResults,
    userActivities: cachedUserActivities,
    failedRepos: cachedFailedRepos,
  });
});

/**
 * API: Get configured repositories (Protected by API key authentication)
 */
app.get('/api/repos', requireApiAuth, (req, res) => {
  const config = loadConfig();
  res.json({ repositories: config.repositories || [] });
});

/**
 * API: Add a new repository and scan immediately (Protected by API key authentication)
 */
app.post('/api/repos', requireApiAuth, async (req, res) => {
  if (isReadOnly) {
    logger.warn('POST /api/repos rejected: server is running in read-only mode (DASHBOARD_READONLY=true)');
    return res.status(403).json({
      success: false,
      error: 'Repository modifications are disabled in read-only mode (DASHBOARD_READONLY=true).',
    });
  }
  try {
    let { owner, repo, repoStr } = req.body;
    let parsed;
    try {
      parsed = parseRepoString(repoStr || (owner && repo ? `${owner}/${repo}` : ''));
    } catch (parseErr) {
      logger.warn(`POST /api/repos invalid input: ${parseErr.message}`);
      return res.status(400).json({ success: false, error: parseErr.message });
    }

    if (!parsed) {
      logger.warn('POST /api/repos missing repository input');
      return res.status(400).json({
        success: false,
        error: 'Repository is required (e.g. "facebook/react" or "https://github.com/facebook/react")',
      });
    }

    owner = parsed.owner;
    repo = parsed.repo;

    const repoUrl = `https://github.com/${owner}/${repo}`;
    logger.action('Add Repository', `Verifying ${owner}/${repo} (${repoUrl}) on GitHub...`);

    // Verify repository exists and is accessible on GitHub BEFORE saving to config.json
    try {
      await getRepositoryHealthData(owner, repo);
    } catch (fetchErr) {
      logger.error(`Validation failed for ${owner}/${repo} (${repoUrl}): ${fetchErr.message}`);
      return res.status(404).json({
        success: false,
        error: `Repository "${owner}/${repo}" (${repoUrl}) could not be found or accessed on GitHub: ${fetchErr.message}`,
      });
    }

    const config = loadConfig();
    config.repositories = config.repositories || [];

    const exists = config.repositories.some(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase()
    );

    if (!exists) {
      config.repositories.push({ owner, repo });
      saveConfig(config);
      logger.success(`Added verified repository ${owner}/${repo} (${repoUrl}) to config.json`);
    } else {
      logger.info(`Repository ${owner}/${repo} (${repoUrl}) is already in config.json`);
    }

    // Trigger scan with newly added repo
    const scanData = await performScan();
    res.json({ success: true, repositories: config.repositories, ...scanData });
  } catch (err) {
    logger.error(`POST /api/repos error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API: Remove a repository (Protected by API key authentication)
 */
app.delete('/api/repos/:owner/:repo', requireApiAuth, async (req, res) => {
  if (isReadOnly) {
    logger.warn('DELETE /api/repos rejected: server is running in read-only mode (DASHBOARD_READONLY=true)');
    return res.status(403).json({
      success: false,
      error: 'Repository modifications are disabled in read-only mode (DASHBOARD_READONLY=true).',
    });
  }
  try {
    const { owner, repo } = req.params;
    const repoUrl = `https://github.com/${owner}/${repo}`;
    logger.action('Remove Repository', `${owner}/${repo} (${repoUrl})`);
    const config = loadConfig();
    const originalLength = (config.repositories || []).length;
    config.repositories = (config.repositories || []).filter(
      (r) => !(r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase())
    );
    if (config.repositories.length !== originalLength) {
      saveConfig(config);
      logger.success(`Removed repository ${owner}/${repo} (${repoUrl}) from config.json`);
    } else {
      logger.warn(`Repository ${owner}/${repo} (${repoUrl}) was not in config.json`);
    }

    const scanData = await performScan();
    res.json({ success: true, repositories: config.repositories, ...scanData });
  } catch (err) {
    logger.error(`DELETE /api/repos error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// Start Server
// ----------------------------------------------------
app.listen(PORT, HOST, async () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  const url = `http://${displayHost}:${PORT}`;
  if (isDevMode) {
    console.log(chalk.bold.cyan('\n⚡ DEV SERVER Active with Instant Live Auto-Reload!'));
  } else {
    console.log(chalk.bold.magenta('\n🚀 GitHub Health Dashboard Server is running!'));
  }
  logger.success(`Server active at ${chalk.underline(url)} (bound to ${HOST}:${PORT})`);
  if (isReadOnly) {
    logger.info('Read-only mode enabled (DASHBOARD_READONLY=true): repository list modifications are locked.');
  }
  if (hasConfiguredApiKey) {
    logger.success(
      `API Key authentication active for /api routes (DASHBOARD_API_KEY masked: ${maskToken(rawConfiguredApiKey)}).`
    );
  } else if (isApiKeyPlaceholder) {
    logger.warn(
      `DASHBOARD_API_KEY appears to be a placeholder (${maskToken(rawConfiguredApiKey)}). Generated ephemeral runtime key (<TOKEN>) to keep /api routes protected.`
    );
  } else {
    logger.warn(
      'DASHBOARD_API_KEY not set in environment. Generated ephemeral runtime key (<TOKEN>) to keep /api routes protected against unauthenticated access.'
    );
  }
  if (isDashboardAuthRequired) {
    logger.info('Dashboard root (/) authentication enabled (DASHBOARD_REQUIRE_AUTH=true).');
  }
  logger.info(
    `Disk persistence: cache=${enableDiskCache ? 'ENABLED' : 'DISABLED (default)'}, reports=${enableDiskReports ? 'ENABLED' : 'DISABLED (default)'}`
  );
  logger.info('Press Ctrl+C to stop.\n');

  if (!hasToken) {
    if (isPlaceholder) {
      logger.warn(
        `GITHUB_TOKEN appears to be a placeholder value ("${maskToken(token)}"). Running with unauthenticated GitHub REST API.`
      );
    } else {
      logger.warn('GITHUB_TOKEN not detected in .env. Running with unauthenticated GitHub REST API.');
    }
    logger.info('Add GITHUB_TOKEN to .env for 5,000 req/hr rate limits and fast GraphQL queries.\n');
  } else {
    logger.success(`GitHub Token detected (masked: ${maskToken(token)}). Using authenticated GraphQL API.\n`);
  }

  logPushProtectionStatus();

  // Check if we have cached results for instant startup (only when ENABLE_DISK_CACHE=true)
  const diskCache = loadCache();
  const config = loadConfig();
  const currentRepoKeys = (config.repositories || []).map((r) => `${r.owner}/${r.repo}`).sort();
  const cachedRepoKeys = diskCache?.repoKeys || [];
  const reposMatch = JSON.stringify(currentRepoKeys) === JSON.stringify(cachedRepoKeys);

  if (diskCache && reposMatch && !process.env.FORCE_SCAN) {
    cachedResults = diskCache.results || [];
    cachedUserActivities = diskCache.userActivities || [];
    cachedFailedRepos = diskCache.failedRepos || [];
    lastScanTime = diskCache.lastScanTime || new Date().toISOString();
    logger.success(`⚡ Loaded cached scan data for ${cachedResults.length} repositories (instant startup)`);
    if (enableDiskReports) {
      saveHtmlReport(cachedResults, cachedUserActivities, {
        lastScanTime,
        failedRepos: cachedFailedRepos,
        isDev: isDevMode,
        embedData: enableEmbeddedReportData,
      });
    }
    broadcastReload('server-restarted');
  } else {
    // Perform initial scan
    try {
      await performScan();
    } catch (err) {
      logger.error(`Initial scan error: ${err.message}`);
    }
  }

  // If in dev mode, watch src/ directory to broadcast reload immediately on edits
  if (isDevMode) {
    const watchDir = path.resolve(process.cwd(), 'src');
    try {
      fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith('.js') || filename.endsWith('.json') || filename.endsWith('.css'))) {
          logger.info(`[Dev Watcher] Change detected in src/${filename}`);
          broadcastReload(`src/${filename}`);
        }
      });
      logger.success('Live file watcher initialized for src/ directory');
    } catch (err) {
      logger.warn(`Could not initialize fs.watch: ${err.message}`);
    }
  }

  // Open in browser if requested
  const args = process.argv.slice(2);
  if (args.includes('--open')) {
    openInBrowser(url);
  }
});
