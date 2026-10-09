import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import chalk from 'chalk';
import { getRepositoryHealthData, parseRepoString, hasToken } from './github.js';
import { analyzeRepository, aggregateUserActivities } from './analyzer.js';
import { printOverviewTable, printDetailedRepo, printUserOverviewTable, saveMarkdownReport } from './reporter.js';
import { saveHtmlReport } from './htmlReporter.js';
import { logger } from './logger.js';

function openInBrowser(filePath) {
  logger.action('Open Browser', filePath);
  const fullPath = path.resolve(filePath);
  const startCmd =
    process.platform === 'win32'
      ? `start "" "${fullPath}"`
      : process.platform === 'darwin'
      ? `open "${fullPath}"`
      : `xdg-open "${fullPath}"`;

  exec(startCmd, (err) => {
    if (err) {
      logger.warn(`Could not launch browser: ${err.message}`);
    }
  });
}

async function main() {
  console.log(chalk.bold.magenta('\n🔍 GitHub Stale Branches & PR Status Checker'));

  if (!hasToken) {
    logger.warn('GITHUB_TOKEN not found in environment. Running with unauthenticated REST API.');
    logger.info('To increase rate limits and use fast GraphQL queries, add GITHUB_TOKEN to .env\n');
  } else {
    logger.success('GitHub Token detected. Using authenticated GraphQL API.\n');
  }

  // Read config
  const configPath = path.resolve(process.cwd(), 'config.json');
  let config = {
    defaultStaleDays: 30,
    warnStaleDays: 60,
    repositories: [],
  };

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      logger.info(`Loaded configuration from ${configPath} (${(config.repositories || []).length} repositories configured)`);
    } catch (err) {
      logger.error(`Failed to parse config.json: ${err.message}`);
      process.exit(1);
    }
  }

  // Check command line arguments
  const args = process.argv.slice(2);
  const shouldSaveMarkdown = args.includes('--markdown');
  const shouldSaveHtml = args.includes('--html') || args.includes('--open') || true;
  const shouldOpenBrowser = args.includes('--open');
  const showAllTime = args.includes('--all-time');

  const cliRepos = [];
  for (const arg of args.filter((a) => !a.startsWith('--'))) {
    try {
      const parsed = parseRepoString(arg);
      if (parsed) cliRepos.push(parsed);
    } catch (err) {
      logger.warn(`Skipping invalid repository argument "${arg}": ${err.message}`);
    }
  }

  const reposToScan = cliRepos.length > 0 ? cliRepos : config.repositories;

  if (!reposToScan || reposToScan.length === 0) {
    logger.error('No repositories configured. Add repos to config.json or pass owner/repo as an argument.');
    console.log(chalk.gray('Example: npm run cli expressjs/express\n'));
    process.exit(1);
  }

  logger.action('CLI Scan Started', `Scanning ${reposToScan.length} repositories...`);
  const results = [];

  for (const { owner, repo } of reposToScan) {
    try {
      const rawData = await getRepositoryHealthData(owner, repo);
      const analyzed = analyzeRepository(rawData, {
        staleDaysThreshold: config.defaultStaleDays || 30,
        warnStaleDays: config.warnStaleDays || 60,
      });
      results.push(analyzed);
      logger.success(`Processed repository ${owner}/${repo}`);
    } catch (err) {
      logger.error(`Failed processing ${owner}/${repo}: ${err.message}`);
    }
  }

  if (results.length === 0) {
    logger.error('No repository data could be retrieved.');
    return;
  }

  // Aggregate contributor activity across repositories
  const userActivities = aggregateUserActivities(results);

  // Print results to terminal
  printOverviewTable(results);

  for (const result of results) {
    printDetailedRepo(result);
  }

  // Print contributor summary to terminal
  printUserOverviewTable(userActivities, { allTime: showAllTime });

  // Generate HTML Dashboard
  if (shouldSaveHtml) {
    const { latestPath, archivePath } = saveHtmlReport(results, userActivities);
    const fileUrl = `file:///${path.resolve(latestPath).replace(/\\/g, '/')}`;
    console.log(chalk.bold.green(`\n🌐 HTML Dashboard generated:`));
    console.log(chalk.cyan(`   Latest:  ${fileUrl}`));
    console.log(chalk.gray(`   Archive: ${archivePath}`));

    if (shouldOpenBrowser) {
      openInBrowser(latestPath);
    }
  }

  // Generate Markdown report if requested
  if (shouldSaveMarkdown) {
    const reportPath = saveMarkdownReport(results, userActivities);
    logger.success(`Markdown report saved: ${reportPath}`);
  }

  logger.success('CLI scan completed successfully!');
}

main().catch((err) => {
  logger.error('Fatal CLI execution error:', err);
  process.exit(1);
});
