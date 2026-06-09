#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_VERSION = releaseVersion();

const JS_RELEASE_MANIFESTS = [
  'contracts/package.json',
  'views/sheet-view/package.json',
  'runtime/spreadsheet-app/package.json',
  'runtime/embed/package.json',
  'runtime/sdk/package.json',
  'cli/package.json',
  'compute/napi/npm/darwin-arm64/package.json',
  'compute/napi/npm/darwin-x64/package.json',
  'compute/napi/npm/linux-x64-gnu/package.json',
  'compute/napi/npm/linux-arm64-gnu/package.json',
  'compute/napi/npm/linux-x64-musl/package.json',
  'compute/napi/npm/linux-arm64-musl/package.json',
  'compute/napi/npm/win32-x64-msvc/package.json',
  'compute/wasm/npm/package.json',
  'compute/chart-render-wasm/npm/package.json',
  'integrations/vscode/mog-xlsx-editor/package.json',
];

const SDK_API_SPEC_PATH = 'runtime/sdk/src/generated/api-spec.json';
const CLI_SKILL_API_SPEC_PATH = 'cli/skill/references/api-spec.json';

const failures = [];

for (const manifest of JS_RELEASE_MANIFESTS) {
  const pkg = readJson(manifest);
  assert(
    pkg.version === EXPECTED_VERSION,
    `${manifest} version ${pkg.version} does not match release ${EXPECTED_VERSION}`,
  );
}

const sdkApiSpec = readJson(SDK_API_SPEC_PATH);
const cliSkillApiSpec = readJson(CLI_SKILL_API_SPEC_PATH);

assertApiSpecPackageMetadata(sdkApiSpec, SDK_API_SPEC_PATH);
assertApiSpecPackageMetadata(cliSkillApiSpec, CLI_SKILL_API_SPEC_PATH);

assert(
  JSON.stringify(cliSkillApiSpec) === JSON.stringify(sdkApiSpec),
  `${CLI_SKILL_API_SPEC_PATH} is not synchronized with ${SDK_API_SPEC_PATH}. Run pnpm --filter @mog-sdk/sdk generate:api-spec and copy the generated spec into the CLI skill reference.`,
);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL ${failure}`);
  }
  process.exit(1);
}

console.log(`PASS release metadata matches ${EXPECTED_VERSION}`);

function releaseVersion() {
  const versionArgIndex = process.argv.findIndex((arg) => arg === '--version');
  const versionFromArg =
    versionArgIndex === -1 ? undefined : process.argv[versionArgIndex + 1]?.trim();
  const versionFromEnv = process.env.RELEASE_VERSION?.trim();
  const versionFromPackage = readJson('runtime/sdk/package.json').version;
  const version = versionFromArg || versionFromEnv || versionFromPackage;

  if (!version) {
    throw new Error('Unable to determine release version');
  }

  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9_.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }

  return version;
}

function assertApiSpecPackageMetadata(spec, path) {
  const expectedPackage = { name: '@mog-sdk/sdk', version: EXPECTED_VERSION };
  assert(
    spec.package?.name === expectedPackage.name &&
      spec.package?.version === expectedPackage.version,
    `${path} must declare package metadata ${expectedPackage.name}@${expectedPackage.version}; found ${JSON.stringify(spec.package)}`,
  );
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}
