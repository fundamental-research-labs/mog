import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts');
const packageVersion = releasePackageVersion();
const releaseVersion = process.env.MOG_CLI_RELEASE_VERSION || packageVersion;
const expectedTag = `mog-cli-v${releaseVersion}`;
const tag = process.env.MOG_CLI_RELEASE_TAG || expectedTag;
const title = process.env.MOG_CLI_RELEASE_TITLE || `Mog CLI v${releaseVersion}`;
const releaseTarget = process.env.MOG_CLI_RELEASE_TARGET || currentGitHead();
const dryRun = ['1', 'true'].includes(
  String(process.env.MOG_CLI_RELEASE_DRY_RUN || '').toLowerCase(),
);

if (releaseVersion !== packageVersion) {
  throw new Error(
    `MOG_CLI_RELEASE_VERSION ${releaseVersion} must match @mog/cli ${packageVersion}`,
  );
}
if (tag !== expectedTag) {
  throw new Error(`MOG_CLI_RELEASE_TAG ${tag} must match ${expectedTag}`);
}

const assets = [
  asset('install-mog-cli.sh'),
  asset('mog-cli-kernel.skill.zip'),
  ...readdirSync(artifactsDir)
    .filter((name) => /^mog-cli-.+\.tar\.gz$/.test(name))
    .sort()
    .map(asset),
];

validateInstallerVersion(assets[0]);

writeChecksums(assets);
assets.push(asset('SHA256SUMS'));

if (!dryRun && !releaseExists(tag)) {
  run('gh', [
    'release',
    'create',
    tag,
    '--title',
    title,
    '--notes',
    'Standalone Mog CLI bundles for Claude Co-work and local agent workflows.',
    '--target',
    releaseTarget,
    '--latest=false',
  ]);
}

if (!dryRun) {
  run('gh', ['release', 'upload', tag, '--clobber', ...assets.map((entry) => entry.path)]);
}

const releaseBaseUrl = `https://github.com/fundamental-research-labs/mog/releases/download/${tag}`;
console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun,
      version: releaseVersion,
      tag,
      releaseTarget,
      releaseBaseUrl,
      installCommand: `curl -fsSL ${releaseBaseUrl}/install-mog-cli.sh | sh`,
      assets: assets.map((entry) => ({
        name: entry.name,
        url: `${releaseBaseUrl}/${entry.name}`,
        sha256: sha256(readFileSync(entry.path)),
      })),
    },
    null,
    2,
  ),
);

function asset(name) {
  const path = resolve(artifactsDir, name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing release artifact: ${path}. Run pnpm --filter @mog/cli package:release first.`,
    );
  }
  return { name, path };
}

function validateInstallerVersion(entry) {
  const text = readFileSync(entry.path, 'utf8');
  const expected = `MOG_CLI_VERSION="\${MOG_CLI_VERSION:-${packageVersion}}"`;
  if (!text.includes(expected)) {
    throw new Error(`${entry.name} must default to @mog/cli version ${packageVersion}`);
  }
}

function releasePackageVersion() {
  const packageJson = readJson(resolve(cliRoot, 'package.json'));
  const sdkPackageJson = readJson(resolve(repoRoot, 'runtime', 'sdk', 'package.json'));
  if (packageJson.version !== sdkPackageJson.version) {
    throw new Error(
      `@mog/cli version ${packageJson.version} must match @mog-sdk/node version ${sdkPackageJson.version}`,
    );
  }
  return packageJson.version;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeChecksums(entries) {
  const lines = entries
    .map((entry) => `${sha256(readFileSync(entry.path))}  ${entry.name}`)
    .sort()
    .join('\n');
  writeFileSync(resolve(artifactsDir, 'SHA256SUMS'), `${lines}\n`);
}

function releaseExists(releaseTag) {
  try {
    execFileSync('gh', ['release', 'view', releaseTag], { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function currentGitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
