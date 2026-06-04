import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts');
const tag = process.env.MOG_CLI_RELEASE_TAG || 'mog-cli-v0.1.0';
const title = process.env.MOG_CLI_RELEASE_TITLE || `Mog CLI ${tag.replace(/^mog-cli-/, '')}`;

const assets = [
  asset('install-mog-cli.sh'),
  asset('mog-cli-kernel.skill.zip'),
  ...readdirSync(artifactsDir)
    .filter((name) => /^mog-cli-.+\.tar\.gz$/.test(name))
    .sort()
    .map(asset),
];

writeChecksums(assets);
assets.push(asset('SHA256SUMS'));

if (!releaseExists(tag)) {
  run('gh', [
    'release',
    'create',
    tag,
    '--title',
    title,
    '--notes',
    'Standalone Mog CLI bundles for Claude Co-work and local agent workflows.',
    '--latest=false',
  ]);
}

run('gh', ['release', 'upload', tag, '--clobber', ...assets.map((entry) => entry.path)]);

const releaseBaseUrl = `https://github.com/fundamental-research-labs/mog/releases/download/${tag}`;
console.log(
  JSON.stringify(
    {
      ok: true,
      tag,
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

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
