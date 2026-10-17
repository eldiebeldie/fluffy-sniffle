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
  console.error('🔒 PUSH BLOCKED: Restricted-Environment Push Safeguard Active (allowGitPush = false)');
  console.error('================================================================================');
  console.error('Why: As a preventative security measure for clones operating in restricted or');
  console.error('     corporate environments, outbound pushes are disabled by default to prevent');
  console.error('     accidental upstream publishing of local configurations or changes.');
  console.error('');
  console.error('How to intentionally authorize pushing when needed (choose one):');
  console.error('  • Option 1 (.env):        Set ALLOW_GIT_PUSH=true in your .env file');
  console.error('  • Option 2 (config.json): Set "allowGitPush": true in config.json');
  console.error('  • Option 3 (One-time):    Run with ALLOW_GIT_PUSH=true git push');
  console.error('================================================================================\n');
  process.exit(1);
}

console.log('✔ [PUSH AUTHORIZED] Push protection flag is set to true. Proceeding with git push...');
process.exit(0);
