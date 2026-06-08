import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const version = process.env.VERSION ?? releasePackageVersion();
const root = await mkdtemp(resolve(tmpdir(), 'mog-cli-registry-'));
const prefix = resolve(root, 'prefix');
const workbooks = resolve(root, 'workbooks');
mkdirSync(prefix, { recursive: true });
mkdirSync(workbooks, { recursive: true });

try {
  execFileSync('npm', ['install', '--prefix', prefix, `@mog-sdk/cli@${version}`], {
    cwd: root,
    stdio: 'inherit',
  });

  const mog = executablePath(resolve(prefix, 'node_modules', '.bin'), 'mog');
  if (!existsSync(mog)) throw new Error(`Installed mog binary not found: ${mog}`);
  execFileSync(mog, ['--help'], { cwd: root, stdio: 'ignore' });

  const created = JSON.parse(
    execFileSync(mog, ['create', '--name', 'registry-smoke', '--path', workbooks], {
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
        'await ws.setCell("A1", "registry ok"); return await ws.getValue("A1");',
      ],
      { cwd: root, encoding: 'utf8' },
    ),
  );
  if (executed.result !== 'registry ok') {
    throw new Error(`execute returned ${JSON.stringify(executed)}`);
  }

  execFileSync(mog, ['commit', '--id', created.id], { cwd: root, stdio: 'ignore' });
  execFileSync(mog, ['unload', '--id', created.id], { cwd: root, stdio: 'ignore' });
  execFileSync(mog, ['shutdown'], { cwd: root, stdio: 'ignore' });

  const workbookPath = resolve(workbooks, 'registry-smoke.xlsx');
  const verifyScript = resolve(prefix, 'verify-workbook.mjs');
  writeFileSync(
    verifyScript,
    [
      "import { createWorkbook } from '@mog-sdk/sdk/node';",
      `const workbook = await createWorkbook(${JSON.stringify(workbookPath)});`,
      "const value = await workbook.activeSheet.getValue('A1');",
      'await workbook.dispose();',
      "if (value !== 'registry ok') throw new Error(`A1 was ${value}`);",
    ].join('\n'),
  );
  execFileSync(process.execPath, [verifyScript], { cwd: prefix, stdio: 'inherit' });

  console.log(JSON.stringify({ ok: true, version, workbookPath }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

function executablePath(binDir, name) {
  return resolve(binDir, process.platform === 'win32' ? `${name}.cmd` : name);
}

function releasePackageVersion() {
  const packageJson = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8'));
  const sdkPackageJson = JSON.parse(
    readFileSync(resolve(repoRoot, 'runtime', 'sdk', 'package.json'), 'utf8'),
  );
  if (packageJson.version !== sdkPackageJson.version) {
    throw new Error(
      `@mog-sdk/cli version ${packageJson.version} must match @mog-sdk/sdk version ${sdkPackageJson.version}`,
    );
  }
  return packageJson.version;
}
