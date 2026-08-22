import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const cliRoot = resolve(repoRoot, 'cli');
const skillSource = resolve(cliRoot, 'skill');
const tarballPath = latestCliTarball();

if (process.env.MOG_CODEX_BINARY_E2E !== '1') {
  console.log(
    JSON.stringify({
      skipped: true,
      reason: 'Set MOG_CODEX_BINARY_E2E=1 to run the Codex-backed packaged CLI E2E test.',
    }),
  );
  process.exit(0);
}

if (!existsSync(skillSource)) throw new Error(`Skill source not found: ${skillSource}`);

const root = mkdtempSync(join(tmpdir(), 'mog-codex-binary-e2e-'));
const prefix = join(root, 'prefix');
const binDir = join(prefix, 'bin');
const project = join(root, 'project');
const workbookDir = join(root, 'workbooks');
const workbookName = `codex-binary-${Date.now()}`;
const workbookPath = join(workbookDir, `${workbookName}.xlsx`);
const expectedValue = 'codex packaged binary ok';
const expectedFormulaValue = expectedValue.length;

try {
  mkdirSync(prefix, { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(workbookDir, { recursive: true });
  prepareAgentProject(project);

  execFileSync('npm', ['install', '--prefix', prefix, '--global', tarballPath], {
    cwd: root,
    stdio: 'inherit',
  });

  const mog = resolve(binDir, 'mog');
  if (!existsSync(mog)) throw new Error(`Installed mog binary not found: ${mog}`);

  const prompt = buildPrompt();
  const transcript = await runCodexAgent({
    cwd: project,
    prompt,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  });

  const reported = parseFinalJson(transcript.finalResponse);
  if (reported.workbookPath !== workbookPath) {
    throw new Error(`Codex reported workbookPath ${reported.workbookPath}, expected ${workbookPath}`);
  }
  if (reported.value !== expectedValue) {
    throw new Error(`Codex reported value ${JSON.stringify(reported.value)}, expected ${expectedValue}`);
  }
  if (reported.formulaValue !== expectedFormulaValue) {
    throw new Error(
      `Codex reported formulaValue ${reported.formulaValue}, expected ${expectedFormulaValue}`,
    );
  }

  const reloaded = JSON.parse(
    execFileSync(mog, ['load', workbookPath], { cwd: project, encoding: 'utf8' }),
  );
  const verified = JSON.parse(
    execFileSync(
      mog,
      [
        'execute',
        '--id',
        reloaded.id,
        '--code',
        'return { a1: await ws.getValue("A1"), b1: await ws.getValue("B1") };',
      ],
      { cwd: project, encoding: 'utf8' },
    ),
  );
  execFileSync(mog, ['unload', '--id', reloaded.id], { cwd: project, stdio: 'ignore' });

  const value = verified.result?.a1;
  const formulaValue = verified.result?.b1;

  if (value !== expectedValue) {
    throw new Error(`Workbook A1=${JSON.stringify(value)}, expected ${expectedValue}`);
  }
  if (formulaValue !== expectedFormulaValue) {
    throw new Error(`Workbook B1=${JSON.stringify(formulaValue)}, expected ${expectedFormulaValue}`);
  }

  execFileSync(mog, ['shutdown'], { cwd: project, stdio: 'ignore' });

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: 'codex',
        tarballPath,
        mog,
        workbookPath,
        value,
        formulaValue,
        commandCount: transcript.commandCount,
        finalResponse: transcript.finalResponse,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    execFileSync(resolve(binDir, 'mog'), ['shutdown'], { cwd: project, stdio: 'ignore' });
  } catch {
    // Best-effort daemon cleanup.
  }
  rmSync(root, { recursive: true, force: true });
}

function prepareAgentProject(projectRoot) {
  execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  writeFileSync(join(projectRoot, 'README.md'), 'Mog Codex packaged binary E2E sandbox.\n');
  mkdirSync(join(projectRoot, '.codex', 'skills'), { recursive: true });
  cpSync(skillSource, join(projectRoot, '.codex', 'skills', 'mog-cli-kernel'), { recursive: true });
}

function buildPrompt() {
  return `
You are running a Codex E2E test for the npm-packaged Mog CLI.

Use the installed "mog" command on PATH. Do not use pnpm, npm install, node scripts, source files, or a Mog repo checkout.
The local skill is available at .codex/skills/mog-cli-kernel/SKILL.md.

Task:
1. Verify the CLI command with: command -v mog
2. Create a new workbook using the Mog CLI with name "${workbookName}" at directory "${workbookDir}".
3. Execute Mog code against the returned workbook id to set A1 to "${expectedValue}" and B1 to "=LEN(A1)".
4. Commit the workbook and unload the workbook handle.
5. Respond only with minified JSON exactly matching this shape:
{"provider":"codex","workbookPath":"${workbookPath}","value":"${expectedValue}","formulaValue":${expectedFormulaValue}}
`.trim();
}

async function runCodexAgent({ cwd, prompt, env }) {
  const { Codex } = await import('@openai/codex-sdk');
  const codex = new Codex({
    env,
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
  });
  const turn = await thread.run(prompt, {
    outputSchema: finalJsonSchema(),
  });
  return {
    finalResponse: turn.finalResponse,
    commandCount: turn.items.filter((item) => item.type === 'command_execution').length,
  };
}

function parseFinalJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Codex response did not contain JSON: ${text}`);
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

function latestCliTarball() {
  const { version } = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8'));
  const tarball = resolve(repoRoot, 'artifacts', 'npm', `mog-cli-${version}.tgz`);
  if (!existsSync(tarball)) throw new Error(`No @mog/cli npm tarball found at ${tarball}`);
  return tarball;
}
