import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { getRepositoryHealthData, parseRepoString, hasToken } from './github.js';
import { analyzeRepository, aggregateUserActivities } from './analyzer.js';
import { generateHtmlReport, saveHtmlReport } from './htmlReporter.js';
import { logger } from './logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const configPath = path.resolve(process.cwd(), 'config.json');

const isDevMode = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const cachePath = path.resolve(process.cwd(), 'reports', '.cache.json');
const sseClients = new Set();

// In-memory cache
let cachedResults = [];
let cachedUserActivities = [];
let cachedFailedRepos = [];
let lastScanTime = null;
let isScanning = false;

app.use(express.json());

// Request duration and access logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  const path = req.originalUrl || req.url;

  res.on('finish', () => {
    const elapsedMs = Date.now() - startTime;
    const status = res.statusCode;
    const logMsg = `${req.method} ${path} -> ${status} (${elapsedMs}ms)`;
    if (status >= 400) {
      logger.error(`[HTTP] ${logMsg}`);
    } else {
      logger.action('HTTP Request', logMsg);
    }
  });

  next();
});

function openInBrowser(url) {
  logger.action('Open Browser', url);
  const startCmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(startCmd, (err) => {
    if (err) {
      logger.warn(`Could not automatically launch browser: ${err.message}`);
    }
  });
}

/**
 * Save scan cache to disk for instant dev server restart
 */
function saveCache(data) {
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ version: 2, ...data }, null, 2), 'utf-8');
  } catch (err) {
    logger.warn(`Could not save disk cache: ${err.message}`);
  }
}

/**
 * Load scan cache from disk
 */
function loadCache() {
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
  logger.info(`Updated ${configPath}`);
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
      logger.info(`Starting scan for ${owner}/${repo}...`);
      try {
        const rawData = await getRepositoryHealthData(owner, repo);
        const analyzed = analyzeRepository(rawData, {
          staleDaysThreshold: config.defaultStaleDays || 30,
          warnStaleDays: config.warnStaleDays || 60,
        });
        results.push(analyzed);
      } catch (err) {
        logger.error(`Failed to scan ${owner}/${repo}: ${err.message}`);
        failedRepos.push({ owner, repo, error: err.message });
      }
    }

    cachedResults = results;
    cachedUserActivities = aggregateUserActivities(results);
    cachedFailedRepos = failedRepos;
    lastScanTime = new Date().toISOString();

    // Persist to reports/index.html
    saveHtmlReport(cachedResults, cachedUserActivities, {
      lastScanTime,
      failedRepos: cachedFailedRepos,
      isDev: isDevMode,
    });

    // Save to disk cache for instant startup
    saveCache({
      results: cachedResults,
      userActivities: cachedUserActivities,
      failedRepos: cachedFailedRepos,
      lastScanTime,
      repoKeys: (config.repositories || []).map((r) => `${r.owner}/${r.repo}`).sort(),
    });

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
 * Main dashboard view
 */
app.get('/', (req, res) => {
  logger.info('Rendering dashboard for client request');
  const html = generateHtmlReport(cachedResults, cachedUserActivities, {
    lastScanTime,
    failedRepos: cachedFailedRepos,
    isDev: isDevMode,
  });
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

/**
 * API: Server-Sent Events for Live Auto-Reload
 */
app.get('/api/live-reload', (req, res) => {
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
 * API: Trigger scan on-demand
 */
app.post('/api/scan', async (req, res) => {
  logger.action('API Trigger', 'POST /api/scan requested by user');
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
 * API: Get current status and cached data
 */
app.get('/api/data', (req, res) => {
  res.json({
    isScanning,
    lastScanTime,
    results: cachedResults,
    userActivities: cachedUserActivities,
    failedRepos: cachedFailedRepos,
  });
});

/**
 * API: Get configured repositories
 */
app.get('/api/repos', (req, res) => {
  const config = loadConfig();
  res.json({ repositories: config.repositories || [] });
});

/**
 * API: Add a new repository and scan immediately
 */
app.post('/api/repos', async (req, res) => {
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

    logger.action('Add Repository', `Verifying ${owner}/${repo} on GitHub...`);

    // Verify repository exists and is accessible on GitHub BEFORE saving to config.json
    try {
      await getRepositoryHealthData(owner, repo);
    } catch (fetchErr) {
      logger.error(`Validation failed for ${owner}/${repo}: ${fetchErr.message}`);
      return res.status(404).json({
        success: false,
        error: `Repository "${owner}/${repo}" could not be found or accessed on GitHub: ${fetchErr.message}`,
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
      logger.success(`Added verified repository ${owner}/${repo} to config.json`);
    } else {
      logger.info(`Repository ${owner}/${repo} is already in config.json`);
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
 * API: Remove a repository
 */
app.delete('/api/repos/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    logger.action('Remove Repository', `${owner}/${repo}`);
    const config = loadConfig();
    const originalLength = (config.repositories || []).length;
    config.repositories = (config.repositories || []).filter(
      (r) => !(r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase())
    );
    if (config.repositories.length !== originalLength) {
      saveConfig(config);
      logger.success(`Removed repository ${owner}/${repo} from config.json`);
    } else {
      logger.warn(`Repository ${owner}/${repo} was not in config.json`);
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
app.listen(PORT, async () => {
  const url = `http://localhost:${PORT}`;
  if (isDevMode) {
    console.log(chalk.bold.cyan('\n⚡ DEV SERVER Active with Instant Live Auto-Reload!'));
  } else {
    console.log(chalk.bold.magenta('\n🚀 GitHub Health Dashboard Server is running!'));
  }
  logger.success(`Server active at ${chalk.underline(url)}`);
  logger.info('Press Ctrl+C to stop.\n');

  if (!hasToken) {
    logger.warn('GITHUB_TOKEN not detected in .env. Running with unauthenticated GitHub REST API.');
    logger.info('Add GITHUB_TOKEN to .env for 5,000 req/hr rate limits and fast GraphQL queries.\n');
  }

  // Check if we have cached results for instant startup
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
    saveHtmlReport(cachedResults, cachedUserActivities, {
      lastScanTime,
      failedRepos: cachedFailedRepos,
      isDev: isDevMode,
    });
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
