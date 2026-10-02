// Read-only protocol and isolated config checks; no login, quota or model calls.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { resolveCli } = require('../src/official-login');
const { withConfigServer, writeSkillConfig, readConfig } = require('../src/skills/config');
const { cliArgs } = require('../src/knowledge/cli');
const execute = promisify(execFile);

(async () => {
  const cli = await resolveCli(process.env.CAM_CLI_DIR ? { env: { PATH: process.env.CAM_CLI_DIR } } : {});
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cam-codex-compat-'));
  const env = { ...process.env, CODEX_HOME: temp };
  for (const key of Object.keys(env)) if (/^(OPENAI_|CODEX_(ACCESS_TOKEN|API_KEY|BASE_URL)|ELECTRON_RUN_AS_NODE$)/i.test(key)) delete env[key];
  const run = args => execute(cli.command, [...cli.args, ...args], { env, cwd: temp, windowsHide: true, timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
  try {
    const version = (await run(['--version'])).stdout.trim();
    await run(['login', '--help']);
    await run([...cliArgs('', '', undefined).slice(0, -1), '--help']);
    const schemaDir = path.join(temp, 'schema');
    await run(['app-server', 'generate-json-schema', '--out', schemaDir]);
    const schema = JSON.parse(await fs.readFile(path.join(schemaDir, 'v2', 'GetAccountRateLimitsResponse.json'), 'utf8'));
    for (const key of ['rateLimits', 'rateLimitsByLimitId', 'rateLimitResetCredits']) assert.ok(schema.properties[key], key);
    await fs.writeFile(path.join(temp, 'config.toml'), '# Keep comments\nmodel = "fixture"\n');
    const resolve = async () => cli;
    const account = await withConfigServer(temp, rpc => rpc('account/read', { refreshToken: false }), { resolve });
    assert.equal(account.account, null, 'isolated server must have no logged-in account');
    const skill = path.join(temp, 'skills', 'fixture', 'SKILL.md');
    await fs.mkdir(path.dirname(skill), { recursive: true });
    await fs.writeFile(skill, '---\nname: fixture\ndescription: synthetic fixture\n---\n');
    await writeSkillConfig(temp, [{ path: skill, enabled: false }], { resolve });
    assert.equal((await readConfig(temp)).skills.config[0].enabled, false);
    await writeSkillConfig(temp, [{ path: skill, enabled: true }], { resolve });
    const config = await readConfig(temp);
    assert.equal(config.skills.config.length, 1);
    assert.equal(config.skills.config[0].enabled, true);
    assert.equal(config.model, 'fixture');
    assert.match(await fs.readFile(path.join(temp, 'config.toml'), 'utf8'), /# Keep comments/);
    console.log(`CODEX COMPAT PASS: ${version}; login/exec flags, usage schema, stdio initialization, logged-out account/read, versioned skill config writes. No online authentication or model calls.`);
  } finally {
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
