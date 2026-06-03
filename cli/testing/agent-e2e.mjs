import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createWorkbook } from '@mog-sdk/node';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const skillSource = resolve(repoRoot, 'cli', 'skill');
const nativeAddon = resolve(repoRoot, 'compute', 'napi', 'compute-core-napi.node');
const platformAddon = resolve(
  repoRoot,
  'compute',
  'napi',
  'npm',
  currentPlatformPackageDir(),
  'compute-core-napi.node',
);

if (process.env.MOG_AGENT_E2E !== '1') {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: 'Set MOG_AGENT_E2E=1 to run provider-backed agent E2E tests.',
    }),
  );
  process.exit(0);
}

if (!existsSync(skillSource)) {
  throw new Error(`Skill source not found: ${skillSource}`);
}

let temporaryPlatformAddon = false;
if (!existsSync(platformAddon) && existsSync(nativeAddon)) {
  symlinkSync('../../compute-core-napi.node', platformAddon);
  temporaryPlatformAddon = true;
}

const providers = requestedProviders();
const results = [];

try {
  for (const provider of providers) {
    results.push(await runProviderCase(provider));
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  if (temporaryPlatformAddon) rmSync(platformAddon, { force: true });
}

async function runProviderCase(provider) {
  const root = mkdtempSync(join(tmpdir(), `mog-${provider}-agent-e2e-`));
  const workbookDir = join(root, 'workbooks');
  const workbookName = `agent-${provider}-${Date.now()}`;
  const workbookPath = join(workbookDir, `${workbookName}.xlsx`);
  const expectedValue = `agent-e2e:${provider}`;

  try {
    prepareAgentProject(root);
    const prompt = buildPrompt({
      provider,
      workbookDir,
      workbookName,
      workbookPath,
      expectedValue,
    });
    const transcript =
      provider === 'codex'
        ? await runCodexAgent({ cwd: root, prompt })
        : await runClaudeAgent({ cwd: root, prompt });

    const reported = parseFinalJson(transcript.finalResponse);
    if (reported.workbookPath !== workbookPath) {
      throw new Error(
        `${provider} reported workbookPath ${reported.workbookPath}, expected ${workbookPath}`,
      );
    }

    const workbook = await createWorkbook(workbookPath);
    const value = await workbook.activeSheet.getValue('A1');
    const formulaValue = await workbook.activeSheet.getValue('B1');
    await workbook.dispose();

    if (value !== expectedValue) {
      throw new Error(`${provider} wrote A1=${JSON.stringify(value)}, expected ${expectedValue}`);
    }
    if (formulaValue !== expectedValue.length) {
      throw new Error(
        `${provider} wrote B1=${JSON.stringify(formulaValue)}, expected ${expectedValue.length}`,
      );
    }

    return {
      provider,
      workbookPath,
      value,
      formulaValue,
      finalResponse: transcript.finalResponse,
      commandCount: transcript.commandCount,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
    shutdownDaemonBestEffort();
  }
}

function prepareAgentProject(root) {
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  writeFileSync(join(root, 'README.md'), 'Mog agent E2E sandbox.\n');

  mkdirSync(join(root, '.claude', 'skills'), { recursive: true });
  mkdirSync(join(root, '.codex', 'skills'), { recursive: true });
  cpSync(skillSource, join(root, '.claude', 'skills', 'mog-cli-kernel'), { recursive: true });
  cpSync(skillSource, join(root, '.codex', 'skills', 'mog-cli-kernel'), { recursive: true });
}

function buildPrompt({ provider, workbookDir, workbookName, workbookPath, expectedValue }) {
  return `
You are running a provider-backed E2E test for the Mog CLI.

Use the Mog repo at:
${repoRoot}

Use the local skill instructions if available:
- .claude/skills/mog-cli-kernel/SKILL.md
- .codex/skills/mog-cli-kernel/SKILL.md

Task:
1. Create a new workbook using the Mog CLI with name "${workbookName}" at directory "${workbookDir}".
2. Execute Mog code against the returned workbook id to set A1 to "${expectedValue}" and B1 to "=LEN(A1)".
3. Commit the workbook and unload the workbook handle.
4. Do not edit source files in the Mog repo or this sandbox.
5. Respond only with minified JSON exactly matching this shape:
{"provider":"${provider}","workbookPath":"${workbookPath}","value":"${expectedValue}","formulaValue":${expectedValue.length}}

Use shell commands from the Mog repo root, for example:
pnpm --filter @mog/cli exec mog create --name "${workbookName}" --path "${workbookDir}"
`.trim();
}

async function runCodexAgent({ cwd, prompt }) {
  const { Codex } = await import('@openai/codex-sdk');
  const codex = new Codex({
    env: process.env,
    config: {
      sandbox_workspace_write: { network_access: true },
    },
  });
  const thread = codex.startThread({
    workingDirectory: cwd,
    skipGitRepoCheck: true,
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
    networkAccessEnabled: true,
    additionalDirectories: [repoRoot],
  });
  const turn = await thread.run(prompt, {
    outputSchema: finalJsonSchema(),
  });
  return {
    finalResponse: turn.finalResponse,
    commandCount: turn.items.filter((item) => item.type === 'command_execution').length,
  };
}

async function runClaudeAgent({ cwd, prompt }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const messages = [];

  for await (const message of query({
    prompt,
    options: {
      cwd,
      additionalDirectories: [repoRoot],
      allowedTools: ['Bash', 'Read', 'Grep', 'Glob'],
      allowDangerouslySkipPermissions: true,
      env: process.env,
      maxTurns: 12,
      permissionMode: 'bypassPermissions',
      settingSources: ['project'],
      skills: ['mog-cli-kernel'],
      tools: ['Bash', 'Read', 'Grep', 'Glob'],
    },
  })) {
    messages.push(message);
  }

  const result = [...messages].reverse().find((message) => message.type === 'result');
  if (!result) throw new Error('Claude Agent SDK did not return a result message.');
  if (result.subtype !== 'success') {
    throw new Error(`Claude Agent SDK failed: ${JSON.stringify(result)}`);
  }

  return {
    finalResponse: result.result,
    commandCount: messages.filter((message) => JSON.stringify(message).includes('"Bash"')).length,
  };
}

function requestedProviders() {
  const raw = process.env.MOG_AGENT_E2E_PROVIDER ?? process.env.MOG_AGENT_E2E_PROVIDERS ?? 'codex';
  const names = raw === 'all' ? ['codex', 'claude'] : raw.split(',');
  const providers = names.map((name) => name.trim()).filter(Boolean);

  for (const provider of providers) {
    if (provider !== 'codex' && provider !== 'claude') {
      throw new Error(
        `Unsupported MOG_AGENT_E2E_PROVIDER "${provider}". Use codex, claude, or all.`,
      );
    }
  }
  return providers.length > 0 ? providers : ['codex'];
}

function parseFinalJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Agent response did not contain JSON: ${text}`);
    return JSON.parse(match[0]);
  }
}

function finalJsonSchema() {
  return {
    type: 'object',
    properties: {
      provider: { type: 'string' },
      workbookPath: { type: 'string' },
      value: { type: 'string' },
      formulaValue: { type: 'number' },
    },
    required: ['provider', 'workbookPath', 'value', 'formulaValue'],
    additionalProperties: false,
  };
}

function shutdownDaemonBestEffort() {
  try {
    execFileSync('pnpm', ['--filter', '@mog/cli', 'exec', 'mog', 'shutdown'], {
      cwd: repoRoot,
      stdio: 'ignore',
    });
  } catch {
    // Best-effort cleanup.
  }
}

function currentPlatformPackageDir() {
  if (process.platform === 'darwin') return `darwin-${process.arch}`;
  if (process.platform === 'win32') return `win32-${process.arch}-msvc`;
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return `linux-${process.arch}-${glibc ? 'gnu' : 'musl'}`;
  }
  throw new Error(`Unsupported platform for Mog agent E2E: ${process.platform}/${process.arch}`);
}
