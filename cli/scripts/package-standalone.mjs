import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts');
const standaloneDist = resolve(cliRoot, 'dist-standalone');
const platform = currentPlatform();
const packageName = `mog-cli-${platform}`;
const stageRoot = resolve(artifactsDir, packageName);
const tarballPath = resolve(artifactsDir, `${packageName}.tar.gz`);
const installerPath = resolve(artifactsDir, 'install-mog-cli.sh');
const nativeSource = resolve(repoRoot, 'compute', 'napi', 'compute-core-napi.node');
const nativePackageName = platformPackageName(platform);
const nativePackageInstallDir = resolve(stageRoot, 'node_modules', '@mog-sdk', platform);
const nativePackageSourceDir = resolve(repoRoot, 'compute', 'napi', 'npm', platform);
const version = await releasePackageVersion();

if (!existsSync(nativeSource)) {
  throw new Error(
    `Native addon not found at ${nativeSource}. Build it first with: pnpm --filter @mog/compute-core-napi build:release`,
  );
}
if (!existsSync(resolve(nativePackageSourceDir, 'package.json'))) {
  throw new Error(`Native package metadata not found: ${nativePackageSourceDir}`);
}

run(
  'pnpm',
  [
    '-w',
    'run',
    'build:public-artifacts',
    '--',
    '--through',
    '@mog-sdk/node',
    '--skip-native-build',
    '--skip-host-native-artifact',
    '--skip-wasm-build',
  ],
  repoRoot,
);
run('pnpm', ['exec', 'tsup', '--config', 'tsup.config.ts'], cliRoot, {
  ...process.env,
  MOG_CLI_STANDALONE: '1',
  MOG_CLI_OUT_DIR: relative(cliRoot, standaloneDist),
});

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(resolve(stageRoot, 'bin'), { recursive: true });
mkdirSync(nativePackageInstallDir, { recursive: true });

cpSync(resolve(standaloneDist, 'mog.cjs'), resolve(stageRoot, 'bin', 'mog.cjs'));
cpSync(resolve(standaloneDist, 'mog.cjs.map'), resolve(stageRoot, 'bin', 'mog.cjs.map'));
cpSync(
  resolve(nativePackageSourceDir, 'package.json'),
  resolve(nativePackageInstallDir, 'package.json'),
);
cpSync(nativeSource, resolve(nativePackageInstallDir, 'compute-core-napi.node'));

writeFileSync(
  resolve(stageRoot, 'package.json'),
  `${JSON.stringify(
    {
      name: '@mog/cli-standalone',
      version,
      private: true,
      type: 'commonjs',
      bin: {
        mog: './bin/mog.cjs',
      },
      bundledPlatform: platform,
      bundledNativePackage: nativePackageName,
      engines: {
        node: '>=18',
      },
    },
    null,
    2,
  )}\n`,
);

rmSync(tarballPath, { force: true });
run('tar', ['-czf', tarballPath, '-C', artifactsDir, packageName], repoRoot);
run('node', ['scripts/package-installer.mjs'], cliRoot);

await smokeTestTarball();

console.log(JSON.stringify({ ok: true, platform, tarballPath, installerPath }, null, 2));

function run(command, args, cwd, env = process.env) {
  execFileSync(command, args, { cwd, env, stdio: 'inherit' });
}

async function releasePackageVersion() {
  const packageJson = JSON.parse(await readFile(resolve(cliRoot, 'package.json'), 'utf8'));
  const sdkPackageJson = JSON.parse(
    await readFile(resolve(repoRoot, 'runtime', 'sdk', 'package.json'), 'utf8'),
  );
  if (packageJson.version !== sdkPackageJson.version) {
    throw new Error(
      `@mog/cli version ${packageJson.version} must match @mog-sdk/node version ${sdkPackageJson.version}`,
    );
  }
  return packageJson.version;
}

async function smokeTestTarball() {
  const root = await mkdtemp(join(tmpdir(), 'mog-cli-standalone-smoke-'));
  const installRoot = resolve(root, 'install');
  const workbookDir = resolve(root, 'workbooks');
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(workbookDir, { recursive: true });

  try {
    run('tar', ['-xzf', tarballPath, '-C', installRoot, '--strip-components=1'], repoRoot);
    const mog = resolve(installRoot, 'bin', 'mog.cjs');
    const created = JSON.parse(
      execFileSync(process.execPath, [mog, 'create', '--name', 'smoke', '--path', workbookDir], {
        cwd: root,
        encoding: 'utf8',
      }),
    );
    if (!created.id)
      throw new Error(`Standalone create did not return an id: ${JSON.stringify(created)}`);

    const executed = JSON.parse(
      execFileSync(
        process.execPath,
        [
          mog,
          'execute',
          '--id',
          created.id,
          '--code',
          'await ws.setCell("A1", "standalone"); return await ws.getValue("A1");',
        ],
        { cwd: root, encoding: 'utf8' },
      ),
    );
    if (executed.result !== 'standalone') {
      throw new Error(`Standalone execute returned ${JSON.stringify(executed)}`);
    }

    execFileSync(process.execPath, [mog, 'commit', '--id', created.id], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync(process.execPath, [mog, 'unload', '--id', created.id], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync(process.execPath, [mog, 'shutdown'], { cwd: root, stdio: 'ignore' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function currentPlatform() {
  if (process.platform === 'darwin') return `darwin-${process.arch}`;
  if (process.platform === 'win32' && process.arch === 'x64') return 'win32-x64-msvc';
  if (process.platform === 'linux') {
    const glibc = process.report?.getReport?.().header?.glibcVersionRuntime;
    return `linux-${process.arch}-${glibc ? 'gnu' : 'musl'}`;
  }
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
}

function platformPackageName(platformName) {
  return `@mog-sdk/${platformName}`;
}
