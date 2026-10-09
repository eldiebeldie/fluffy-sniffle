import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import chalk from 'chalk';
import dotenv from 'dotenv';
import { getRepositoryHealthData, hasToken } from './github.js';
import { analyzeRepository, aggregateUserActivities } from './analyzer.js';
import { generateHtmlReport, saveHtmlReport } from './htmlReporter.js';
import { logger } from './logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const configPath = path.resolve(process.cwd(), 'config.json');

// In-memory cache
let cachedResults = [];
let cachedUserActivities = [];
let lastScanTime = null;
let isScanning = false;

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  logger.action('HTTP Request', `${req.method} ${req.url}`);
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
      lastScanTime = new Date().toISOString();
      return { results: [], userActivities: [], lastScanTime };
    }

    const results = [];
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
      }
    }

    cachedResults = results;
    cachedUserActivities = aggregateUserActivities(results);
    lastScanTime = new Date().toISOString();

    // Persist to reports/index.html
    saveHtmlReport(cachedResults, cachedUserActivities, { lastScanTime });
    const elapsedMs = Date.now() - startTime;
    logger.success(`Multi-repo scan completed in ${elapsedMs}ms (${results.length} repos analyzed)`);

    return {
      results: cachedResults,
      userActivities: cachedUserActivities,
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
  const html = generateHtmlReport(cachedResults, cachedUserActivities, { lastScanTime });
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
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
    const { owner, repo } = req.body;
    if (!owner || !repo) {
      logger.warn('POST /api/repos missing owner or repo in body');
      return res.status(400).json({ error: 'Owner and repo are required (e.g. { owner: "facebook", repo: "react" })' });
    }

    logger.action('Add Repository', `${owner}/${repo}`);
    const config = loadConfig();
    config.repositories = config.repositories || [];

    const exists = config.repositories.some(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase()
    );

    if (!exists) {
      config.repositories.push({ owner: owner.trim(), repo: repo.trim() });
      saveConfig(config);
      logger.success(`Added repository ${owner}/${repo} to config.json`);
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
    config.repositories = (config.repositories || []).filter(
      (r) => !(r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase())
    );
    saveConfig(config);
    logger.success(`Removed repository ${owner}/${repo} from config.json`);

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
  console.log(chalk.bold.magenta('\n🚀 GitHub Health Dashboard Server is running!'));
  logger.success(`Server active at ${chalk.underline(url)}`);
  logger.info('Press Ctrl+C to stop.\n');

  if (!hasToken) {
    logger.warn('GITHUB_TOKEN not detected in .env. Running with unauthenticated GitHub REST API.');
    logger.info('Add GITHUB_TOKEN to .env for 5,000 req/hr rate limits and fast GraphQL queries.\n');
  }

  // Perform initial scan
  try {
    await performScan();
  } catch (err) {
    logger.error(`Initial scan error: ${err.message}`);
  }

  // Open in browser if requested
  const args = process.argv.slice(2);
  if (args.includes('--open')) {
    openInBrowser(url);
  }
});
