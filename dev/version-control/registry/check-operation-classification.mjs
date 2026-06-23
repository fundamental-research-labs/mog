#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');

const REGISTRY_PATH = 'dev/version-control/registry/operation-classification.json';
const SCHEMA_PATH = 'dev/version-control/registry/operation-classification.schema.json';
const CHECK_SCRIPT_PATH = 'dev/version-control/registry/check-operation-classification.mjs';
const MANIFEST_PATH = 'dev/version-control/generated-output-manifest.json';
const CONTRACTS_VERSIONING_PATH = 'contracts/src/versioning/index.ts';
const RUNTIME_CLASSIFIER_PATH = 'kernel/src/bridges/compute/operation-classification.ts';

const args = new Set(process.argv.slice(2));
const updateManifest = args.has('--update-manifest');

function repoPath(path) {
  return resolve(repoRoot, path);
}

function readText(path) {
  return readFileSync(repoPath(path), 'utf8');
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    throw new Error(`${path}: invalid JSON: ${error.message}`);
  }
}

function digest(path) {
  return `sha256:${createHash('sha256')
    .update(readFileSync(repoPath(path)))
    .digest('hex')}`;
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueSorted(values, label) {
  const seen = new Set();
  for (const value of values) {
    assert(!seen.has(value), `${label}: duplicate value ${value}`);
    seen.add(value);
  }
  const sorted = [...values].sort();
  assert(
    JSON.stringify(values) === JSON.stringify(sorted),
    `${label}: expected lexicographic order`,
  );
}

function extractConstArray(source, name) {
  const match = source.match(
    new RegExp(`export const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\] as const\\);`),
  );
  assert(match, `${CONTRACTS_VERSIONING_PATH}: missing ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function extractRuntimeSet(source, name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  assert(match, `${RUNTIME_CLASSIFIER_PATH}: missing ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]).sort();
}

function extractRuntimeArray(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert(match, `${RUNTIME_CLASSIFIER_PATH}: missing ${name}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]).sort();
}

function expectExactArray(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

function invocationHintForWrapper(registry, wrapper) {
  return registry.wrapperInvocationHints[wrapper];
}

function resolveInvocation(invocation, hint) {
  if (invocation.mode === 'fixed') return invocation.value;
  if (invocation.mode === 'hint-with-default') return hint ?? invocation.default;
  throw new Error(
    `unknown invocation resolution mode ${(invocation && invocation.mode) || '<missing>'}`,
  );
}

function matchesRule(match, command) {
  if (match.type === 'exact') return match.commands.includes(command);
  if (match.type === 'prefix' || match.type === 'default-prefix') {
    return match.prefixes.some((prefix) => command.startsWith(prefix));
  }
  return false;
}

function classify(registry, command, wrapper) {
  const hint = wrapper ? invocationHintForWrapper(registry, wrapper) : undefined;
  for (const rule of registry.rules) {
    if (!matchesRule(rule.match, command)) continue;
    return {
      command,
      ruleId: rule.ruleId,
      invocation: resolveInvocation(rule.classification.invocation, hint),
      operationKind: rule.classification.operationKind,
      domainClass: rule.classification.domainClass,
      capturePolicy: rule.classification.capturePolicy,
      writeAdmissionMode: rule.classification.writeAdmissionMode,
    };
  }
  return null;
}

function validateSchemaPresence(schema) {
  assert(
    schema.$id === 'https://mog.dev/schemas/version-control/operation-classification.schema.json',
    `${SCHEMA_PATH}: unexpected $id`,
  );
  assert(
    schema.properties?.schemaVersion?.const === 'vc02.operation-classification.v1',
    `${SCHEMA_PATH}: unexpected schemaVersion const`,
  );
  assert(
    schema.properties?.registryId?.const === 'vc02.write-admission.operation-classification',
    `${SCHEMA_PATH}: unexpected registryId const`,
  );
}

function validateRegistryShape(registry, inventory) {
  assert(
    registry.schemaVersion === 'vc02.operation-classification.v1',
    `${REGISTRY_PATH}: unexpected schemaVersion`,
  );
  assert(
    registry.registryId === 'vc02.write-admission.operation-classification',
    `${REGISTRY_PATH}: unexpected registryId`,
  );
  assert(
    registry.generated?.deterministic === true,
    `${REGISTRY_PATH}: generated.deterministic must be true`,
  );
  assert(
    registry.generated?.ruleOrder === 'first-match-wins',
    `${REGISTRY_PATH}: rule order must be first-match-wins`,
  );

  assert(registry.inventory.path, `${REGISTRY_PATH}: missing inventory.path`);
  assert(
    registry.inventory.path === 'dev/version-control/inventory/compute-bridge-write-inventory.json',
    `${REGISTRY_PATH}: unexpected inventory.path`,
  );
  assert(
    registry.inventory.schemaVersion === inventory.schemaVersion,
    `${REGISTRY_PATH}: inventory schemaVersion mismatch`,
  );
  assert(
    registry.inventory.baseCommit === inventory.baseCommit,
    `${REGISTRY_PATH}: inventory baseCommit mismatch`,
  );
  assert(
    registry.inventory.sourceDigest === inventory.sourceDigest,
    `${REGISTRY_PATH}: inventory sourceDigest mismatch`,
  );

  const duplicateCommands = Object.entries(
    inventory.entries.reduce((counts, entry) => {
      counts[entry.command] = (counts[entry.command] ?? 0) + 1;
      return counts;
    }, {}),
  )
    .filter(([, count]) => count > 1)
    .map(([command]) => command)
    .sort();

  assert(
    registry.inventory.coverageExpectation.entryCount === inventory.entries.length,
    `${REGISTRY_PATH}: inventory entry count is stale`,
  );
  assert(
    registry.inventory.coverageExpectation.uniqueCommandCount ===
      new Set(inventory.entries.map((entry) => entry.command)).size,
    `${REGISTRY_PATH}: inventory unique command count is stale`,
  );
  expectExactArray(
    registry.inventory.coverageExpectation.duplicateCommands,
    duplicateCommands,
    `${REGISTRY_PATH}: duplicate command expectation is stale`,
  );

  const contractsSource = readText(CONTRACTS_VERSIONING_PATH);
  expectExactArray(
    registry.contractEnums.operationKinds,
    extractConstArray(contractsSource, 'VERSION_OPERATION_KINDS'),
    `${REGISTRY_PATH}: operationKinds`,
  );
  expectExactArray(
    registry.contractEnums.capturePolicies,
    extractConstArray(contractsSource, 'CAPTURE_POLICIES'),
    `${REGISTRY_PATH}: capturePolicies`,
  );
  expectExactArray(
    registry.contractEnums.writeAdmissionModes,
    extractConstArray(contractsSource, 'VERSION_WRITE_ADMISSION_MODES'),
    `${REGISTRY_PATH}: writeAdmissionModes`,
  );
  expectExactArray(
    registry.contractEnums.domainClasses,
    extractConstArray(contractsSource, 'VERSION_DOMAIN_CLASSES'),
    `${REGISTRY_PATH}: domainClasses`,
  );

  const capturePolicyKeys = Object.keys(registry.capturePolicies);
  expectExactArray(
    capturePolicyKeys,
    registry.contractEnums.capturePolicies,
    `${REGISTRY_PATH}: capture policy definitions`,
  );
  const modeKeys = Object.keys(registry.writeAdmissionModes);
  expectExactArray(
    modeKeys,
    registry.contractEnums.writeAdmissionModes,
    `${REGISTRY_PATH}: write admission mode definitions`,
  );

  for (const [policy, definition] of Object.entries(registry.capturePolicies)) {
    assert(
      registry.writeAdmissionModes[definition.writeAdmissionMode],
      `${REGISTRY_PATH}: ${policy} references unknown admission mode`,
    );
    assert(
      definition.operationContextPolicy === 'warning-if-missing-before-transport',
      `${REGISTRY_PATH}: ${policy} must define missing-context diagnostic policy`,
    );
  }

  for (const [mode, definition] of Object.entries(registry.writeAdmissionModes)) {
    if (mode === 'block') {
      assert(definition.transport === 'block', `${REGISTRY_PATH}: block mode must block transport`);
    } else {
      assert(
        definition.transport === 'allow',
        `${REGISTRY_PATH}: ${mode} mode must allow transport`,
      );
    }
  }
}

function validateRules(registry) {
  const ruleIds = new Set();
  const exactCommands = new Map();
  for (const rule of registry.rules) {
    assert(!ruleIds.has(rule.ruleId), `${REGISTRY_PATH}: duplicate ruleId ${rule.ruleId}`);
    ruleIds.add(rule.ruleId);

    const match = rule.match;
    if (match.type === 'exact') {
      uniqueSorted(match.commands, `${REGISTRY_PATH}: ${rule.ruleId}.commands`);
      for (const command of match.commands) {
        assert(
          !exactCommands.has(command),
          `${REGISTRY_PATH}: command ${command} appears in both ${exactCommands.get(command)} and ${rule.ruleId}`,
        );
        exactCommands.set(command, rule.ruleId);
      }
    } else {
      uniqueSorted(match.prefixes, `${REGISTRY_PATH}: ${rule.ruleId}.prefixes`);
    }

    const classification = rule.classification;
    assert(
      registry.capturePolicies[classification.capturePolicy],
      `${REGISTRY_PATH}: ${rule.ruleId} references unknown capture policy`,
    );
    assert(
      registry.writeAdmissionModes[classification.writeAdmissionMode],
      `${REGISTRY_PATH}: ${rule.ruleId} references unknown admission mode`,
    );
    assert(
      registry.contractEnums.operationKinds.includes(classification.operationKind),
      `${REGISTRY_PATH}: ${rule.ruleId} references unknown operation kind`,
    );
    assert(
      registry.contractEnums.domainClasses.includes(classification.domainClass),
      `${REGISTRY_PATH}: ${rule.ruleId} references unknown domain class`,
    );

    const policyMode = registry.capturePolicies[classification.capturePolicy].writeAdmissionMode;
    if (classification.writeAdmissionMode !== policyMode) {
      assert(
        rule.modeOverrideRationale,
        `${REGISTRY_PATH}: ${rule.ruleId} overrides ${classification.capturePolicy} admission mode without rationale`,
      );
    }
  }

  assert(
    registry.rules.at(-1)?.match?.type === 'default-prefix',
    `${REGISTRY_PATH}: final rule must be the default-prefix fallback`,
  );
}

function ruleCommands(registry, ruleId) {
  const rule = registry.rules.find((candidate) => candidate.ruleId === ruleId);
  assert(rule, `${REGISTRY_PATH}: missing rule ${ruleId}`);
  assert(rule.match.type === 'exact', `${REGISTRY_PATH}: ${ruleId} must use exact matching`);
  return [...rule.match.commands].sort();
}

function rulePrefixes(registry, ruleId) {
  const rule = registry.rules.find((candidate) => candidate.ruleId === ruleId);
  assert(rule, `${REGISTRY_PATH}: missing rule ${ruleId}`);
  assert(
    rule.match.type === 'prefix' || rule.match.type === 'default-prefix',
    `${REGISTRY_PATH}: ${ruleId} must use prefix matching`,
  );
  return [...rule.match.prefixes].sort();
}

function validateRuntimeClassifierParity(registry) {
  const runtimeSource = readText(RUNTIME_CLASSIFIER_PATH);
  expectExactArray(
    ruleCommands(registry, 'root-creation-exact'),
    extractRuntimeSet(runtimeSource, 'ROOT_CREATION_COMMANDS'),
    `${REGISTRY_PATH}: root creation commands are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
  expectExactArray(
    ruleCommands(registry, 'lifecycle-excluded-exact'),
    extractRuntimeSet(runtimeSource, 'LIFECYCLE_EXCLUDED_COMMANDS'),
    `${REGISTRY_PATH}: lifecycle excluded commands are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
  expectExactArray(
    [
      ...ruleCommands(registry, 'sync-apply-excluded-exact'),
      ...ruleCommands(registry, 'system-import-excluded-exact'),
    ].sort(),
    extractRuntimeSet(runtimeSource, 'SYNC_EXCLUDED_COMMANDS'),
    `${REGISTRY_PATH}: sync/import excluded commands are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
  expectExactArray(
    [
      ...ruleCommands(registry, 'undo-redo-group-exact'),
      ...ruleCommands(registry, 'undo-redo-revert-exact'),
    ].sort(),
    extractRuntimeSet(runtimeSource, 'UNDO_REDO_COMMANDS'),
    `${REGISTRY_PATH}: undo/redo commands are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
  expectExactArray(
    ruleCommands(registry, 'derived-only-exact'),
    extractRuntimeSet(runtimeSource, 'DERIVED_ONLY_COMMANDS'),
    `${REGISTRY_PATH}: derived-only commands are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
  expectExactArray(
    ruleCommands(registry, 'shadow-only-exact'),
    extractRuntimeSet(runtimeSource, 'SHADOW_ONLY_EXACT_COMMANDS'),
    `${REGISTRY_PATH}: shadow-only exact commands are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
  expectExactArray(
    rulePrefixes(registry, 'secret-direct-compute-prefix'),
    extractRuntimeArray(runtimeSource, 'BLOCKED_SECRET_PREFIXES'),
    `${REGISTRY_PATH}: blocked secret prefixes are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
  expectExactArray(
    rulePrefixes(registry, 'shadow-only-prefix'),
    extractRuntimeArray(runtimeSource, 'SHADOW_ONLY_PREFIXES'),
    `${REGISTRY_PATH}: shadow-only prefixes are stale against ${RUNTIME_CLASSIFIER_PATH}`,
  );
}

function validateInventoryCoverage(registry, inventory) {
  const unclassified = [];
  for (const entry of inventory.entries) {
    if (!classify(registry, entry.command, entry.wrapper)) {
      unclassified.push(`${entry.command} (${entry.wrapper})`);
    }
  }
  assert(
    unclassified.length === 0,
    `${REGISTRY_PATH}: ${unclassified.length} inventory entries are unclassified:\n  ${unclassified.join('\n  ')}`,
  );
}

function validateRepresentatives(registry, inventory) {
  const inventoryKeys = new Set(
    inventory.entries.map((entry) => `${entry.command}\0${entry.wrapper}`),
  );
  const classIds = new Set();
  for (const representative of registry.requiredRepresentativeClasses) {
    assert(
      !classIds.has(representative.classId),
      `${REGISTRY_PATH}: duplicate representative ${representative.classId}`,
    );
    classIds.add(representative.classId);
    assert(
      inventoryKeys.has(`${representative.command}\0${representative.inventoryWrapper}`),
      `${REGISTRY_PATH}: representative ${representative.classId} is absent from inventory`,
    );
    const actual = classify(registry, representative.command, representative.inventoryWrapper);
    assert(actual, `${REGISTRY_PATH}: representative ${representative.classId} did not classify`);
    for (const [field, expectedValue] of Object.entries(representative.expected)) {
      assert(
        actual[field] === expectedValue,
        `${REGISTRY_PATH}: representative ${representative.classId}.${field} expected ${expectedValue}, got ${actual[field]}`,
      );
    }
  }

  const representedPolicies = new Set(
    registry.requiredRepresentativeClasses.map((item) => item.expected.capturePolicy),
  );
  for (const policy of registry.contractEnums.capturePolicies) {
    assert(
      representedPolicies.has(policy),
      `${REGISTRY_PATH}: capture policy ${policy} lacks a representative class`,
    );
  }

  const representedModes = new Set(
    registry.requiredRepresentativeClasses.map((item) => item.expected.writeAdmissionMode),
  );
  for (const mode of registry.contractEnums.writeAdmissionModes) {
    assert(
      representedModes.has(mode),
      `${REGISTRY_PATH}: admission mode ${mode} lacks a representative class`,
    );
  }
}

function validateManifest(manifest) {
  assert(
    manifest.schemaVersion === 'vc02.generated-output-manifest.v1',
    `${MANIFEST_PATH}: unexpected schemaVersion`,
  );
  assert(
    manifest.manifestId === 'vc02.generated-output-manifest',
    `${MANIFEST_PATH}: unexpected manifestId`,
  );
  const outputPaths = manifest.generatedOutputs.map((output) => output.path);
  uniqueSorted(outputPaths, `${MANIFEST_PATH}: generatedOutputs.path`);

  for (const output of manifest.generatedOutputs) {
    assert(existsSync(repoPath(output.path)), `${MANIFEST_PATH}: output missing ${output.path}`);
    const actualOutputDigest = digest(output.path);
    assert(
      output.sha256 === actualOutputDigest,
      `${MANIFEST_PATH}: ${output.path} digest mismatch, expected ${output.sha256}, got ${actualOutputDigest}`,
    );
    for (const input of output.inputs ?? []) {
      assert(
        existsSync(repoPath(input.path)),
        `${MANIFEST_PATH}: input missing ${input.path} for ${output.path}`,
      );
      if (input.sha256) {
        const actualInputDigest = digest(input.path);
        assert(
          input.sha256 === actualInputDigest,
          `${MANIFEST_PATH}: ${output.path} input ${input.path} is stale, expected ${input.sha256}, got ${actualInputDigest}`,
        );
      }
    }
  }
}

function pathOnlyInput(path) {
  return { path, tracking: 'path-only' };
}

function digestInput(path) {
  return { path, sha256: digest(path) };
}

function buildManifest() {
  const generatedOutputs = [
    {
      path: 'dev/version-control/inventory/compute-bridge-write-inventory.json',
      kind: 'compute-bridge-write-inventory',
      generator: 'vc02-inventory-baseline',
      sha256: digest('dev/version-control/inventory/compute-bridge-write-inventory.json'),
      inputs: [
        pathOnlyInput('infra/rust-bridge/bridge-ts/src/emit/bridge.rs'),
        pathOnlyInput('kernel/src/bridges/compute/compute-bridge.gen.ts'),
        pathOnlyInput('kernel/src/bridges/compute/compute-bridge.ts'),
        pathOnlyInput('kernel/src/bridges/compute/compute-core.ts'),
        pathOnlyInput('kernel/src/bridges/compute/manifest.gen.ts'),
      ],
      staleDiagnostic: 'versioning.generated-output.stale',
    },
    {
      path: SCHEMA_PATH,
      kind: 'operation-classification-schema',
      generator: 'dev/version-control/registry/check-operation-classification.mjs',
      sha256: digest(SCHEMA_PATH),
      inputs: [digestInput(CHECK_SCRIPT_PATH), pathOnlyInput(CONTRACTS_VERSIONING_PATH)],
      staleDiagnostic: 'versioning.generated-output.stale',
    },
    {
      path: REGISTRY_PATH,
      kind: 'operation-classification-registry',
      generator: 'dev/version-control/registry/check-operation-classification.mjs',
      sha256: digest(REGISTRY_PATH),
      inputs: [
        digestInput(CHECK_SCRIPT_PATH),
        pathOnlyInput(CONTRACTS_VERSIONING_PATH),
        digestInput('dev/version-control/inventory/compute-bridge-write-inventory.json'),
        digestInput(SCHEMA_PATH),
        pathOnlyInput('kernel/src/bridges/compute/mutation-admission.ts'),
        pathOnlyInput(RUNTIME_CLASSIFIER_PATH),
      ],
      staleDiagnostic: 'versioning.generated-output.stale',
    },
  ].sort((left, right) => left.path.localeCompare(right.path));

  return {
    schemaVersion: 'vc02.generated-output-manifest.v1',
    manifestId: 'vc02.generated-output-manifest',
    generatedOutputs,
    diagnostics: {
      staleGeneratedOutput: {
        code: 'versioning.generated-output.stale',
        severity: 'error',
        description:
          'A generated VC artifact or one of its declared inputs no longer matches the digest recorded in this manifest.',
      },
    },
  };
}

function main() {
  const schema = readJson(SCHEMA_PATH);
  const registry = readJson(REGISTRY_PATH);
  const inventory = readJson(registry.inventory.path);

  validateSchemaPresence(schema);
  validateRegistryShape(registry, inventory);
  validateRules(registry);
  validateRuntimeClassifierParity(registry);
  validateInventoryCoverage(registry, inventory);
  validateRepresentatives(registry, inventory);

  if (updateManifest) {
    writeFileSync(repoPath(MANIFEST_PATH), canonicalJson(buildManifest()));
  }

  const manifest = readJson(MANIFEST_PATH);
  validateManifest(manifest);

  const relativeManifest = relative(repoRoot, repoPath(MANIFEST_PATH));
  console.log(
    `operation-classification registry OK (${inventory.entries.length} inventory entries, manifest ${relativeManifest})`,
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
