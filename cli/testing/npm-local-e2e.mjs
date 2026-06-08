import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const version = releasePackageVersion();
const tarballDir = argValue('--tarball-dir') ?? resolve(repoRoot, 'artifacts', 'npm');
const cliTarball = tarballForPackage('mog-sdk-cli', tarballDir, true);
const root = await mkdtemp(resolve(tmpdir(), 'mog-cli-npm-local-'));
const prefix = resolve(root, 'prefix');
const workbooks = resolve(root, 'workbooks');
mkdirSync(prefix, { recursive: true });
mkdirSync(workbooks, { recursive: true });

try {
  const installTargets = localInstallTargets(tarballDir);
  execFileSync('npm', ['install', '--prefix', prefix, ...installTargets], {
    cwd: root,
    stdio: 'inherit',
  });

  const mog = executablePath(resolve(prefix, 'node_modules', '.bin'), 'mog');
  if (!existsSync(mog)) throw new Error(`Installed mog binary not found: ${mog}`);

  execFileSync(mog, ['--help'], { cwd: root, stdio: 'ignore' });

  const installedSdk = JSON.parse(
    readFileSync(resolve(prefix, 'node_modules', '@mog-sdk', 'sdk', 'package.json'), 'utf8'),
  ).version;
  if (installedSdk !== version) {
    throw new Error(`installed @mog-sdk/sdk@${installedSdk}, expected ${version}`);
  }

  const workbookPath = await runInstalledCliSmoke({ mog, cwd: root, workbooks });

  writeFileSync(
    resolve(root, 'result.json'),
    `${JSON.stringify({ ok: true, workbookPath, version }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true, cliTarball, tarballDir, workbookPath, version }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}

function localInstallTargets(dir) {
  const tarballs = [
    tarballForPackage(hostNativeTarballPrefix(), dir, false),
    tarballForPackage('mog-sdk-wasm', dir, false),
    tarballForPackage('mog-sdk-contracts', dir, false),
    tarballForPackage('mog-sdk-sdk', dir, false),
    cliTarball,
  ].filter(Boolean);
  return tarballs.length > 1 ? tarballs : [cliTarball];
}

async function runInstalledCliSmoke({ mog, cwd, workbooks }) {
  const created = JSON.parse(
    execFileSync(mog, ['create', '--name', 'npm-local-smoke', '--path', workbooks], {
      cwd,
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
        'console.log("npm local smoke"); await ws.setCell("A1", "npm local ok"); return await ws.getValue("A1");',
      ],
      { cwd, encoding: 'utf8' },
    ),
  );
  if (
    executed.result !== 'npm local ok' ||
    !executed.logs?.some((line) => line.includes('npm local smoke'))
  ) {
    throw new Error(`execute returned ${JSON.stringify(executed)}`);
  }

  execFileSync(mog, ['commit', '--id', created.id], { cwd, stdio: 'ignore' });
  execFileSync(mog, ['unload', '--id', created.id], { cwd, stdio: 'ignore' });
  execFileSync(mog, ['shutdown'], { cwd, stdio: 'ignore' });

  const workbookPath = resolve(workbooks, 'npm-local-smoke.xlsx');
  if (!existsSync(workbookPath)) throw new Error(`Workbook was not written: ${workbookPath}`);

  const installRoot = resolve(dirname(mog), '..', '..');
  const verifyScript = resolve(installRoot, 'verify-workbook.mjs');
  writeFileSync(
    verifyScript,
    [
      "import { createWorkbook } from '@mog-sdk/sdk/node';",
      `const workbook = await createWorkbook(${JSON.stringify(workbookPath)});`,
      "const value = await workbook.activeSheet.getValue('A1');",
      'await workbook.dispose();',
      "if (value !== 'npm local ok') throw new Error(`A1 was ${value}`);",
    ].join('\n'),
  );
  execFileSync(process.execPath, [verifyScript], { cwd: installRoot, stdio: 'inherit' });

  return workbookPath;
}

function tarballForPackage(prefix, dir, required) {
  const tarball = resolve(dir, `${prefix}-${version}.tgz`);
  if (!existsSync(tarball)) {
    if (required) throw new Error(`No tarball found at ${tarball}`);
    return null;
  }
  return tarball;
}

function hostNativeTarballPrefix() {
  if (process.platform === 'darwin') return `mog-sdk-darwin-${process.arch}`;
  if (process.platform === 'win32') return `mog-sdk-win32-${process.arch}-msvc`;
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return `mog-sdk-linux-${process.arch}-${glibc ? 'gnu' : 'musl'}`;
  }
  throw new Error(
    `Unsupported platform for Mog CLI npm smoke: ${process.platform}/${process.arch}`,
  );
}

function executablePath(binDir, name) {
  return resolve(binDir, process.platform === 'win32' ? `${name}.cmd` : name);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const prefix = `${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
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
