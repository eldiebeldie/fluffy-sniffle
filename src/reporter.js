import chalk from 'chalk';
import Table from 'cli-table3';
import fs from 'fs';
import path from 'path';

/**
 * Print overview table across all repositories
 */
export function printOverviewTable(results) {
  console.log('\n' + chalk.bold.cyan('📊 GitHub Repositories Health Overview'));

  const table = new Table({
    head: [
      chalk.white.bold('Repository'),
      chalk.white.bold('Branches'),
      chalk.white.bold('Stale Branches'),
      chalk.white.bold('Open PRs'),
      chalk.white.bold('Stale PRs'),
      chalk.white.bold('Draft PRs'),
      chalk.white.bold('Health Status'),
    ],
    colAligns: ['left', 'center', 'center', 'center', 'center', 'center', 'center'],
  });

  results.forEach((res) => {
    let statusText = chalk.green('Healthy');
    if (res.staleBranchesCount > 10 || res.stalePrsCount > 5) {
      statusText = chalk.red('Needs Cleanup');
    } else if (res.staleBranchesCount > 0 || res.stalePrsCount > 0) {
      statusText = chalk.yellow('Attention');
    }

    table.push([
      chalk.bold(res.fullName),
      res.totalBranches,
      res.staleBranchesCount > 0 ? chalk.red.bold(res.staleBranchesCount) : chalk.green('0'),
      res.totalOpenPrs,
      res.stalePrsCount > 0 ? chalk.yellow.bold(res.stalePrsCount) : chalk.green('0'),
      res.draftPrsCount,
      statusText,
    ]);
  });

  console.log(table.toString());
}

/**
 * Print detailed tables for each repository
 */
export function printDetailedRepo(res) {
  console.log('\n' + chalk.bold.blue(`====================================================`));
  console.log(chalk.bold.blue(`  Repository: ${chalk.white.underline(res.fullName)}`));
  console.log(chalk.bold.blue(`====================================================`));

  // --- Stale Branches Section ---
  if (res.staleBranches.length === 0) {
    console.log(chalk.green('✔ No stale branches found!'));
  } else {
    console.log(chalk.yellow.bold(`\n🍂 Stale Branches (${res.staleBranches.length}):`));
    const branchTable = new Table({
      head: [
        chalk.white.bold('Branch'),
        chalk.white.bold('Days Inactive'),
        chalk.white.bold('Last Author'),
        chalk.white.bold('Has Open PR?'),
      ],
      colAligns: ['left', 'center', 'left', 'center'],
    });

    res.staleBranches.slice(0, 15).forEach((b) => {
      branchTable.push([
        chalk.magenta(b.name),
        b.isVeryStale ? chalk.red.bold(`${b.daysInactive}d`) : chalk.yellow(`${b.daysInactive}d`),
        b.author,
        b.hasOpenPr ? chalk.green('Yes') : chalk.gray('No'),
      ]);
    });

    console.log(branchTable.toString());
    if (res.staleBranches.length > 15) {
      console.log(chalk.gray(`...and ${res.staleBranches.length - 15} more stale branches.`));
    }
  }

  // --- Open PRs Section ---
  if (res.pullRequests.length === 0) {
    console.log(chalk.green('\n✔ No open pull requests.'));
  } else {
    console.log(chalk.cyan.bold(`\n🔀 Open Pull Requests (${res.pullRequests.length}):`));
    const prTable = new Table({
      head: [
        chalk.white.bold('#'),
        chalk.white.bold('Title'),
        chalk.white.bold('Author'),
        chalk.white.bold('Age'),
        chalk.white.bold('Inactive'),
        chalk.white.bold('Draft?'),
      ],
      colAligns: ['left', 'left', 'left', 'center', 'center', 'center'],
    });

    res.pullRequests.slice(0, 15).forEach((pr) => {
      const titleShort = pr.title.length > 40 ? pr.title.slice(0, 37) + '...' : pr.title;
      prTable.push([
        chalk.cyan(`#${pr.number}`),
        titleShort,
        pr.author,
        `${pr.ageDays}d`,
        pr.isStalePr ? chalk.yellow(`${pr.daysSinceLastUpdate}d`) : chalk.green(`${pr.daysSinceLastUpdate}d`),
        pr.isDraft ? chalk.gray('Draft') : chalk.green('Ready'),
      ]);
    });

    console.log(prTable.toString());
    if (res.pullRequests.length > 15) {
      console.log(chalk.gray(`...and ${res.pullRequests.length - 15} more pull requests.`));
    }
  }
}

/**
 * Generate Markdown report file
 */
export function saveMarkdownReport(results, outputDir = 'reports') {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filePath = path.join(outputDir, `repo-health-${dateStr}.md`);

  let md = `# GitHub Repository Health Report\n\n`;
  md += `_Generated on: ${new Date().toUTCString()}_\n\n`;

  // Overview Table
  md += `## Overview\n\n`;
  md += `| Repository | Branches | Stale Branches | Open PRs | Stale PRs | Draft PRs |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;
  results.forEach((r) => {
    md += `| [${r.fullName}](https://github.com/${r.fullName}) | ${r.totalBranches} | ${r.staleBranchesCount} | ${r.totalOpenPrs} | ${r.stalePrsCount} | ${r.draftPrsCount} |\n`;
  });
  md += `\n---\n\n`;

  // Details per repo
  results.forEach((r) => {
    md += `## [${r.fullName}](https://github.com/${r.fullName})\n\n`;

    md += `### Stale Branches (${r.staleBranchesCount})\n\n`;
    if (r.staleBranches.length === 0) {
      md += `No stale branches.\n\n`;
    } else {
      md += `| Branch | Days Inactive | Last Author | Has Open PR |\n`;
      md += `| :--- | :---: | :--- | :---: |\n`;
      r.staleBranches.forEach((b) => {
        md += `| \`${b.name}\` | ${b.daysInactive}d | ${b.author} | ${b.hasOpenPr ? 'Yes' : 'No'} |\n`;
      });
      md += `\n`;
    }

    md += `### Open Pull Requests (${r.totalOpenPrs})\n\n`;
    if (r.pullRequests.length === 0) {
      md += `No open pull requests.\n\n`;
    } else {
      md += `| PR | Title | Author | Age | Inactive For | Status |\n`;
      md += `| :--- | :--- | :--- | :---: | :---: | :---: |\n`;
      r.pullRequests.forEach((pr) => {
        const cleanTitle = pr.title.replace(/\|/g, '\\|');
        md += `| [#${pr.number}](${pr.url}) | ${cleanTitle} | ${pr.author} | ${pr.ageDays}d | ${pr.daysSinceLastUpdate}d | ${pr.isDraft ? 'Draft' : 'Ready'} |\n`;
      });
      md += `\n`;
    }

    md += `---\n\n`;
  });

  fs.writeFileSync(filePath, md, 'utf-8');
  return filePath;
}

