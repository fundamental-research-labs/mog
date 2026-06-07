import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const npmArtifactsDir = resolve(repoRoot, 'artifacts', 'npm');
const tarballPath = latestCliTarball();
const root = await mkdtemp(resolve(tmpdir(), 'mog-cli-npm-local-'));
const prefix = resolve(root, 'prefix');
const workbooks = resolve(root, 'workbooks');
mkdirSync(prefix, { recursive: true });
mkdirSync(workbooks, { recursive: true });

try {
  execFileSync('npm', ['install', '--prefix', prefix, '--global', tarballPath], {
    cwd: root,
    stdio: 'inherit',
  });

  const mog = resolve(prefix, 'bin', 'mog');
  if (!existsSync(mog)) throw new Error(`Installed mog binary not found: ${mog}`);

  const created = JSON.parse(
    execFileSync(mog, ['create', '--name', 'npm-local-smoke', '--path', workbooks], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  if (!created.id) throw new Error(`create did not return an id: ${JSON.stringify(created)}`);

  const executed = JSON.parse(
    execFileSync(
      mog,
      [
        'execute',
        '--id',
        created.id,
        '--code',
        'await ws.setCell("A1", "npm local ok"); return await ws.getValue("A1");',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  );
  if (executed.result !== 'npm local ok') {
    throw new Error(`execute returned ${JSON.stringify(executed)}`);
  }

  execFileSync(mog, ['commit', '--id', created.id], { cwd: root, stdio: 'ignore' });
  execFileSync(mog, ['unload', '--id', created.id], { cwd: root, stdio: 'ignore' });
  execFileSync(mog, ['shutdown'], { cwd: root, stdio: 'ignore' });

  const workbookPath = resolve(workbooks, 'npm-local-smoke.xlsx');
  if (!existsSync(workbookPath)) throw new Error(`Workbook was not written: ${workbookPath}`);

  writeFileSync(
    resolve(root, 'result.json'),
    `${JSON.stringify({ ok: true, workbookPath }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true, tarballPath, workbookPath }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

function latestCliTarball() {
  const { version } = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8'));
  const tarball = resolve(npmArtifactsDir, `mog-sdk-cli-${version}.tgz`);
  if (!existsSync(tarball)) throw new Error(`No @mog-sdk/cli npm tarball found at ${tarball}`);
  return tarball;
}
