import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts');
const packageVersion = releasePackageVersion();
const releaseVersion = process.env.MOG_CLI_RELEASE_VERSION || packageVersion;
const releaseName = `mog-cli-v${releaseVersion}`;
const releaseBranch = process.env.MOG_CLI_RAW_RELEASE_BRANCH || 'cli-releases';
const dryRun = ['1', 'true'].includes(
  String(process.env.MOG_CLI_RELEASE_DRY_RUN || '').toLowerCase(),
);
const rawBaseUrl = `https://raw.githubusercontent.com/fundamental-research-labs/mog/${releaseBranch}/${releaseName}`;

if (releaseVersion !== packageVersion) {
  throw new Error(
    `MOG_CLI_RELEASE_VERSION ${releaseVersion} must match @mog/cli ${packageVersion}`,
  );
}

const assets = [
  asset('install-mog-cli.sh'),
  asset('mog-cli-kernel.skill.zip'),
  ...readdirSync(artifactsDir)
    .filter((name) => /^mog-cli-.+\.tar\.gz$/.test(name))
    .sort()
    .map(asset),
];

validateInstallerVersionAndBase(assets[0]);
writeChecksums(assets);
assets.push(asset('SHA256SUMS'));

if (!dryRun) {
  publishRawBranch();
}

console.log(
  JSON.stringify(
    {
      ok: true,
      dryRun,
      version: releaseVersion,
      releaseBranch,
      releaseName,
      rawBaseUrl,
      installCommand: `curl -fsSL ${rawBaseUrl}/install-mog-cli.sh | sh`,
      assets: assets.map((entry) => ({
        name: entry.name,
        url: `${rawBaseUrl}/${entry.name}`,
        sha256: sha256(readFileSync(entry.path)),
      })),
    },
    null,
    2,
  ),
);

function publishRawBranch() {
  const root = mkdtempSync(join(tmpdir(), 'mog-cli-raw-release-'));
  const worktree = resolve(root, 'worktree');
  try {
    fetchReleaseBranch();
    if (hasRef(`refs/remotes/origin/${releaseBranch}`)) {
      run('git', ['worktree', 'add', '--detach', worktree, `origin/${releaseBranch}`]);
      run('git', ['checkout', '-B', releaseBranch], worktree);
    } else {
      run('git', ['worktree', 'add', '--detach', worktree, 'HEAD']);
      run('git', ['checkout', '--orphan', releaseBranch], worktree);
      run('git', ['rm', '-rf', '--quiet', '.'], worktree, { allowFailure: true });
    }

    if (process.env.GITHUB_ACTIONS) {
      run('git', ['config', 'user.name', 'github-actions[bot]'], worktree);
      run(
        'git',
        ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'],
        worktree,
      );
    }

    const releaseDir = resolve(worktree, releaseName);
    rmSync(releaseDir, { recursive: true, force: true });
    mkdirSync(releaseDir, { recursive: true });
    for (const entry of assets) {
      cpSync(entry.path, resolve(releaseDir, entry.name));
    }
    writeFileSync(
      resolve(releaseDir, 'README.md'),
      `# Mog CLI ${releaseVersion}\n\nInstall:\n\n\`\`\`bash\ncurl -fsSL ${rawBaseUrl}/install-mog-cli.sh | sh\n\`\`\`\n`,
    );

    run('git', ['add', releaseName], worktree);
    if (isWorktreeClean(worktree)) return;
    run('git', ['commit', '-m', `Publish Mog CLI ${releaseVersion} raw artifacts`], worktree);
    run('git', ['push', 'origin', `HEAD:refs/heads/${releaseBranch}`], worktree);
  } finally {
    run('git', ['worktree', 'remove', '--force', worktree], repoRoot, { allowFailure: true });
    rmSync(root, { recursive: true, force: true });
  }
}

function fetchReleaseBranch() {
  run(
    'git',
    ['fetch', 'origin', `refs/heads/${releaseBranch}:refs/remotes/origin/${releaseBranch}`],
    repoRoot,
    { allowFailure: true },
  );
}

function isWorktreeClean(cwd) {
  return execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }).trim() === '';
}

function hasRef(ref) {
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

function asset(name) {
  const path = resolve(artifactsDir, name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing release artifact: ${path}. Run pnpm --filter @mog/cli package:release first.`,
    );
  }
  return { name, path };
}

function validateInstallerVersionAndBase(entry) {
  const text = readFileSync(entry.path, 'utf8');
  const expectedVersion = `MOG_CLI_VERSION="\${MOG_CLI_VERSION:-${packageVersion}}"`;
  if (!text.includes(expectedVersion)) {
    throw new Error(`${entry.name} must default to @mog/cli version ${packageVersion}`);
  }
  if (!text.includes('https://raw.githubusercontent.com/fundamental-research-labs/mog/')) {
    throw new Error(`${entry.name} must default to raw.githubusercontent.com`);
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

function run(command, args, cwd = repoRoot, options = {}) {
  try {
    execFileSync(command, args, { cwd, stdio: 'inherit' });
  } catch (error) {
    if (options.allowFailure) return;
    throw error;
  }
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}
