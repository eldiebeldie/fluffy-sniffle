import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import chalk from 'chalk';
import { getRepositoryHealthData, hasToken } from './github.js';
import { analyzeRepository, aggregateUserActivities } from './analyzer.js';
import { printOverviewTable, printDetailedRepo, printUserOverviewTable, saveMarkdownReport } from './reporter.js';
import { saveHtmlReport } from './htmlReporter.js';

function openInBrowser(filePath) {
  const fullPath = path.resolve(filePath);
  const startCmd =
    process.platform === 'win32'
      ? `start "" "${fullPath}"`
      : process.platform === 'darwin'
      ? `open "${fullPath}"`
      : `xdg-open "${fullPath}"`;

  exec(startCmd, (err) => {
    if (err) {
      console.log(chalk.gray(`Could not automatically launch browser: ${err.message}`));
    }
  });
}

async function main() {
  console.log(chalk.bold.magenta('\n🔍 GitHub Stale Branches & PR Status Checker'));

  if (!hasToken) {
    console.log(
      chalk.yellow(
        '⚠️  Notice: GITHUB_TOKEN not found in environment. Running with unauthenticated REST API.'
      )
    );
    console.log(
      chalk.gray(
        '   To increase rate limits and use fast GraphQL queries, add GITHUB_TOKEN to your .env file.\n'
      )
    );
  } else {
    console.log(chalk.green('🔑 GitHub Token detected. Using authenticated GraphQL API.\n'));
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
    } catch (err) {
      console.error(chalk.red(`Failed to parse config.json: ${err.message}`));
      process.exit(1);
    }
  }

  // Check command line arguments
  const args = process.argv.slice(2);
  const shouldSaveMarkdown = args.includes('--markdown');
  const shouldSaveHtml = args.includes('--html') || args.includes('--open') || true; // always generate html dashboard
  const shouldOpenBrowser = args.includes('--open');

  const cliRepos = args
    .filter((arg) => !arg.startsWith('--') && arg.includes('/'))
    .map((arg) => {
      const [owner, repo] = arg.split('/');
      return { owner, repo };
    });

  const reposToScan = cliRepos.length > 0 ? cliRepos : config.repositories;

  if (!reposToScan || reposToScan.length === 0) {
    console.log(
      chalk.red('No repositories configured. Add repos to config.json or pass owner/repo as an argument.')
    );
    console.log(chalk.gray('Example: npm start facebook/react\n'));
    process.exit(1);
  }

  const results = [];

  for (const { owner, repo } of reposToScan) {
    process.stdout.write(chalk.blue(`⏳ Analyzing ${chalk.bold(`${owner}/${repo}`)}... `));
    try {
      const rawData = await getRepositoryHealthData(owner, repo);
      const analyzed = analyzeRepository(rawData, {
        staleDaysThreshold: config.defaultStaleDays || 30,
        warnStaleDays: config.warnStaleDays || 60,
      });
      results.push(analyzed);
      process.stdout.write(chalk.green('Done!\n'));
    } catch (err) {
      process.stdout.write(chalk.red('Failed!\n'));
      console.error(chalk.red(`   Error: ${err.message}`));
    }
  }

  if (results.length === 0) {
    console.log(chalk.red('\nNo repository data could be retrieved.'));
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
  printUserOverviewTable(userActivities);

  // Generate HTML Dashboard
  if (shouldSaveHtml) {
    const { latestPath, archivePath } = saveHtmlReport(results, userActivities);
    const fileUrl = `file:///${path.resolve(latestPath).replace(/\\/g, '/')}`;
    console.log(chalk.bold.green(`\n🌐 HTML Dashboard generated:`));
    console.log(chalk.cyan(`   Latest:  ${fileUrl}`));
    console.log(chalk.gray(`   Archive: ${archivePath}`));

    if (shouldOpenBrowser) {
      console.log(chalk.blue(`🚀 Opening dashboard in browser...`));
      openInBrowser(latestPath);
    }
  }

  // Generate Markdown report if requested
  if (shouldSaveMarkdown) {
    const reportPath = saveMarkdownReport(results, userActivities);
    console.log(chalk.bold.green(`\n📄 Markdown report generated: ${chalk.underline(reportPath)}`));
  }
}

main().catch((err) => {
  console.error(chalk.red('\nFatal error:'), err);
  process.exit(1);
});
