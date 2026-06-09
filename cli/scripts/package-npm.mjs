import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCliPublicPackageDirectory } from '../../tools/public-package-manifest.mjs';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const artifactsDir = resolve(repoRoot, 'artifacts', 'npm');
const packageDir = resolve(artifactsDir, 'mog-cli');
const version = releasePackageVersion();

rmSync(artifactsDir, { recursive: true, force: true });
mkdirSync(artifactsDir, { recursive: true });
createCliPublicPackageDirectory(cliRoot, { root: repoRoot, outDir: packageDir });

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
