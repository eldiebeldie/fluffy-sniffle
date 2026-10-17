import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const configPath = path.resolve(process.cwd(), 'config.json');
let configAllowPush = false;

if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    configAllowPush = config.allowGitPush === true;
  } catch {
    // Ignore parse errors, default to false
  }
}

const envAllowPush =
  process.env.ALLOW_GIT_PUSH === 'true' || process.env.ALLOW_GIT_PUSH === '1';

const isPushAllowed = envAllowPush || configAllowPush;

if (!isPushAllowed) {
  console.error('\n================================================================================');
  console.error('🔒 PUSH BLOCKED: Pushing changes is disabled by default (allowGitPush = false).');
  console.error('================================================================================');
  console.error('Why: This repository has a safety flag enabled to prevent unintended pushes.');
  console.error('');
  console.error('How to enable pushing when needed (choose one):');
  console.error('  • Option 1 (.env):        Set ALLOW_GIT_PUSH=true in your .env file');
  console.error('  • Option 2 (config.json): Set "allowGitPush": true in config.json');
  console.error('  • Option 3 (One-time):    Run with ALLOW_GIT_PUSH=true git push');
  console.error('================================================================================\n');
  process.exit(1);
}

console.log('✔ [PUSH AUTHORIZED] Push protection flag is set to true. Proceeding with git push...');
process.exit(0);
