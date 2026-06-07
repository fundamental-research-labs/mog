import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts', 'npm');
const packageDir = resolve(artifactsDir, 'mog-cli');
const version = releasePackageVersion();

const distFile = resolve(cliRoot, 'dist', 'mog.cjs');
const distMapFile = resolve(cliRoot, 'dist', 'mog.cjs.map');
if (!existsSync(distFile)) {
  throw new Error(`Missing built CLI at ${distFile}. Run pnpm --filter @mog-sdk/cli build first.`);
}

rmSync(packageDir, { recursive: true, force: true });
mkdirSync(resolve(packageDir, 'dist'), { recursive: true });
cpSync(distFile, resolve(packageDir, 'dist', 'mog.cjs'));
if (existsSync(distMapFile)) cpSync(distMapFile, resolve(packageDir, 'dist', 'mog.cjs.map'));
chmodSync(resolve(packageDir, 'dist', 'mog.cjs'), 0o755);

writeFileSync(
  resolve(packageDir, 'package.json'),
  `${JSON.stringify(npmManifest(version), null, 2)}\n`,
);
writeFileSync(
  resolve(packageDir, 'README.md'),
  [
    '# Mog CLI',
    '',
    'Minimal command-line interface for operating Mog workbooks with the headless SDK.',
    '',
    '```bash',
    'npm install -g @mog-sdk/cli',
    'mog create --name model --path .',
    '```',
    '',
  ].join('\n'),
);

const output = execFileSync('npm', ['pack', '--pack-destination', artifactsDir, '--json'], {
  cwd: packageDir,
  encoding: 'utf8',
});
const packed = JSON.parse(output);
const filename = packed.at(0)?.filename;
if (!filename) throw new Error(`npm pack did not report a filename: ${output}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      version,
      packageDir,
      tarballPath: resolve(artifactsDir, filename),
    },
    null,
    2,
  ),
);

function npmManifest(packageVersion) {
  return {
    name: '@mog-sdk/cli',
    version: packageVersion,
    description: 'Minimal command-line interface for operating Mog workbooks with the headless SDK',
    license: 'MIT',
    type: 'commonjs',
    bin: {
      mog: './dist/mog.cjs',
    },
    files: ['dist', 'README.md'],
    engines: {
      node: '>=18',
    },
    repository: {
      type: 'git',
      url: 'https://github.com/fundamental-research-labs/mog',
      directory: 'cli',
    },
    publishConfig: {
      access: 'public',
    },
    dependencies: {
      '@mog-sdk/sdk': packageVersion,
    },
  };
}

function releasePackageVersion() {
  const packageJson = readJson(resolve(cliRoot, 'package.json'));
  const sdkPackageJson = readJson(resolve(repoRoot, 'runtime', 'sdk', 'package.json'));
  if (packageJson.version !== sdkPackageJson.version) {
    throw new Error(
      `@mog-sdk/cli version ${packageJson.version} must match @mog-sdk/sdk version ${sdkPackageJson.version}`,
    );
  }
  return packageJson.version;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
