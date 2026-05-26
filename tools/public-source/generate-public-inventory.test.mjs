import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  buildPublicInventory,
  parseJsonc,
  validatePublicInventory,
} from './generate-public-inventory.mjs';

test('parseJsonc preserves URL strings while stripping comments and trailing commas', () => {
  const parsed = parseJsonc(`{
    // A line comment.
    "docs": "https://example.com/path//still-string",
    "pattern": "not /* a comment */ either",
    "items": [
      "one",
    ],
  }`);

  assert.deepEqual(parsed, {
    docs: 'https://example.com/path//still-string',
    pattern: 'not /* a comment */ either',
    items: ['one'],
  });
});

test('buildPublicInventory projects included workspace packages and allowed package-less entries', () => {
  const root = createFixtureRoot({
    '@mog/spreadsheet': { disposition: 'monorepo-root' },
    '@mog-sdk/contracts': { disposition: 'ship-public' },
    '@mog-sdk/node': { disposition: 'ship-public' },
    '@mog/private': { disposition: 'private' },
  });
  writePackage(root, 'contracts', '@mog-sdk/contracts');
  writePackage(root, 'runtime/sdk', '@mog-sdk/node');

  const result = buildPublicInventory(root, {
    publicWorkspacePackages: ['contracts', 'runtime/sdk'],
    allowedPackageLessInventoryEntries: ['@mog/spreadsheet'],
  });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result.inventory), [
    '@mog/spreadsheet',
    '@mog-sdk/contracts',
    '@mog-sdk/node',
  ]);
});

test('validatePublicInventory rejects names outside the public workspace allowlist', () => {
  assert.deepEqual(
    validatePublicInventory(
      {
        '@mog/spreadsheet': { disposition: 'monorepo-root' },
        '@mog-sdk/contracts': { disposition: 'ship-public' },
        '@mog/private': { disposition: 'private' },
      },
      {
        workspaceNames: ['@mog-sdk/contracts'],
        requiredNames: ['@mog-sdk/contracts'],
        allowedPackageLessInventoryEntries: ['@mog/spreadsheet'],
      },
    ),
    [
      '@mog/private: public inventory contains a package that is not in the public workspace and not listed as an allowed package-less entry',
    ],
  );
});

test('buildPublicInventory fails when a required included package is absent from inventory', () => {
  const root = createFixtureRoot({
    '@mog-sdk/contracts': { disposition: 'ship-public' },
  });
  writePackage(root, 'contracts', '@mog-sdk/contracts');
  writePackage(root, 'runtime/sdk', '@mog-sdk/node');

  const result = buildPublicInventory(root, {
    publicWorkspacePackages: ['contracts', 'runtime/sdk'],
  });

  assert.match(
    result.errors.join('\n'),
    /@mog-sdk\/node: required included package is missing from tools\/package-inventory\.jsonc/,
  );
});

function createFixtureRoot(inventory) {
  const root = mkdtempSync(join(tmpdir(), 'mog-public-inventory-'));
  writeFile(join(root, 'tools/package-inventory.jsonc'), `${JSON.stringify(inventory, null, 2)}\n`);
  return root;
}

function writePackage(root, dir, name) {
  writeFile(
    join(root, dir, 'package.json'),
    `${JSON.stringify({ name, private: true }, null, 2)}\n`,
  );
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
