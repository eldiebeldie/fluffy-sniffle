import chalk from 'chalk';

function getTimestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export const logger = {
  info: (msg, ...args) => {
    console.log(`${chalk.gray(`[${getTimestamp()}]`)} ${chalk.cyan('[INFO]')} ${msg}`, ...args);
  },
  action: (action, details = '', ...args) => {
    console.log(
      `${chalk.gray(`[${getTimestamp()}]`)} ${chalk.magenta.bold(`[ACTION: ${action}]`)} ${details}`,
      ...args
    );
  },
  success: (msg, ...args) => {
    console.log(`${chalk.gray(`[${getTimestamp()}]`)} ${chalk.green.bold('[SUCCESS]')} ${msg}`, ...args);
  },
  warn: (msg, ...args) => {
    console.log(`${chalk.gray(`[${getTimestamp()}]`)} ${chalk.yellow.bold('[WARN]')} ${msg}`, ...args);
  },
  error: (msg, ...args) => {
    console.log(`${chalk.gray(`[${getTimestamp()}]`)} ${chalk.red.bold('[ERROR]')} ${msg}`, ...args);
  },
};
