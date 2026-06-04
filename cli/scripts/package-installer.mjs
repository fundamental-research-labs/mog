import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts');
const installerPath = resolve(artifactsDir, 'install-mog-cli.sh');
const packageVersion = releasePackageVersion();

mkdirSync(artifactsDir, { recursive: true });
writeFileSync(installerPath, installerSource(packageVersion));

console.log(JSON.stringify({ ok: true, version: packageVersion, installerPath }, null, 2));

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

function installerSource(version) {
  const sourcePath = resolve(cliRoot, 'scripts', 'install-standalone.sh');
  if (!existsSync(sourcePath)) throw new Error(`Installer source not found: ${sourcePath}`);
  const source = readFileSync(sourcePath, 'utf8');
  const updated = source.replace(
    /^MOG_CLI_VERSION="\$\{MOG_CLI_VERSION:-[^}]+}"$/m,
    `MOG_CLI_VERSION="\${MOG_CLI_VERSION:-${version}}"`,
  );
  if (!updated.includes(`MOG_CLI_VERSION="\${MOG_CLI_VERSION:-${version}}"`)) {
    throw new Error('Installer version line was not found');
  }
  return updated;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}
