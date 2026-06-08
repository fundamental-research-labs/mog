import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicPackageDirectory,
  discoverWorkspacePackages,
  loadJsonc,
} from '../../tools/public-package-manifest.mjs';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(cliRoot, '..');
const version = releasePackageVersion();
const publicPackagesDir = resolve(repoRoot, 'artifacts', 'public-packages');
const candidateDir = resolve(publicPackagesDir, 'mog-sdk__cli');
const tarballDir = resolve(repoRoot, 'artifacts', 'npm');

if (!existsSync(resolve(cliRoot, 'dist', 'mog.cjs'))) {
  throw new Error(
    `Missing built CLI at cli/dist/mog.cjs. Run pnpm --filter @mog-sdk/cli build first.`,
  );
}

mkdirSync(publicPackagesDir, { recursive: true });
rmSync(tarballDir, { recursive: true, force: true });
mkdirSync(tarballDir, { recursive: true });

createPublicPackageDirectory(cliRoot, {
  root: repoRoot,
  inventory: loadJsonc(resolve(repoRoot, 'tools', 'package-inventory.jsonc')),
  workspacePackages: discoverWorkspacePackages(repoRoot),
  outDir: candidateDir,
});

const candidateManifest = readJson(resolve(candidateDir, 'package.json'));
assertCandidateManifest(candidateManifest);

const output = execFileSync(
  'npm',
  ['pack', candidateDir, '--pack-destination', tarballDir, '--json'],
  {
    cwd: repoRoot,
    encoding: 'utf8',
  },
);
const packed = JSON.parse(output);
const filename = packed.at(0)?.filename;
if (!filename) throw new Error(`npm pack did not report a filename: ${output}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      version,
      candidateDir,
      tarballPath: resolve(tarballDir, filename),
    },
    null,
    2,
  ),
);

function assertCandidateManifest(manifest) {
  if (manifest.name !== '@mog-sdk/cli') {
    throw new Error(`candidate name ${manifest.name} is not @mog-sdk/cli`);
  }
  if (manifest.version !== version) {
    throw new Error(`candidate version ${manifest.version} is not ${version}`);
  }
  if (manifest.private === true) {
    throw new Error('candidate manifest must not contain private: true');
  }
  if (manifest.dependencies?.['@mog-sdk/sdk'] !== version) {
    throw new Error(
      `candidate @mog-sdk/sdk dependency ${manifest.dependencies?.['@mog-sdk/sdk']} is not ${version}`,
    );
  }
  if (manifest.devDependencies) {
    throw new Error('candidate manifest must not include devDependencies');
  }
  if (manifest.bin?.mog !== './dist/mog.cjs') {
    throw new Error(`candidate bin.mog is ${manifest.bin?.mog}, expected ./dist/mog.cjs`);
  }
  assertNoForbiddenSpecs(manifest);
}

function assertNoForbiddenSpecs(manifest) {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (/^(workspace|file|link):/.test(String(spec))) {
        throw new Error(`candidate ${field}.${name} uses forbidden spec ${spec}`);
      }
    }
  }
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
