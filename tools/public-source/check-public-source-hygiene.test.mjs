import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  formatTextReport,
  parseJsonc,
  scanPublicSourceHygiene,
} from './check-public-source-hygiene.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scannerPath = join(__dirname, 'check-public-source-hygiene.mjs');

const privateRepoName = ['mog', 'internal'].join('-');
const privateOwner = 'fundamental-research-labs';
const privateRepoSlug = [privateOwner, privateRepoName].join('/');
const privatePackage = `@${privateOwner}/sdk-internal`;
const privateGhcr = [['ghcr', 'io'].join('.'), privateOwner, 'source-image'].join('/');

function pathRef(name) {
  return `${name}/`;
}

function agentsSkillsRef() {
  return `${pathRef('agents').slice(0, -1)}/${pathRef('skills')}`;
}

function localHomePath() {
  return ['', 'Users', 'alice', 'work', 'mog'].join('/');
}

function withTempRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'mog-public-hygiene-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function write(root, relPath, content) {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function writeWasm(root, relPath) {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
}

test('parseJsonc strips comments and trailing commas without damaging URLs', () => {
  assert.deepEqual(
    parseJsonc(`{
    // comment
    "url": "https://example.com/path//still-string",
    "items": [
      "one",
    ],
  }`),
    {
      url: 'https://example.com/path//still-string',
      items: ['one'],
    },
  );
});

test('scanner passes a clean projected tree without a manifest', () => {
  withTempRoot((root) => {
    write(root, 'README.md', '# Public source\n');
    write(root, 'src/index.ts', 'export const ok = true;\n');

    const result = scanPublicSourceHygiene({ root });

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.blockingFindings, []);
    assert.equal(formatTextReport(result).includes('blocking findings: 0'), true);
  });
});

test('scanner reports required blocking categories deterministically', () => {
  withTempRoot((root) => {
    const outside = mkdtempSync(join(tmpdir(), 'mog-public-outside-'));
    try {
      write(root, join('dev', 'README.md'), 'internal\n');
      write(root, join('packages', 'grid', 'dist', 'bundle.js'), 'compiled\n');
      write(root, '.env.local', 'TOKEN=value\n');
      write(
        root,
        join('docs', 'blocked.md'),
        [
          `repo ${privateRepoSlug}`,
          `package ${privatePackage}`,
          `image ${privateGhcr}:latest`,
          `see ../${pathRef('plans')}projection and ../${pathRef('dev')}tooling`,
          `agent docs ../${agentsSkillsRef()}index.md`,
          `local ${localHomePath()}`,
        ].join('\n'),
      );
      writeWasm(root, join('compute', 'leaked.wasm'));
      symlinkSync(outside, join(root, 'outside-link'));

      const first = scanPublicSourceHygiene({ root });
      const second = scanPublicSourceHygiene({ root });
      const categories = new Set(first.blockingFindings.map((finding) => finding.category));

      assert.deepEqual(first.blockingFindings, second.blockingFindings);
      assert.equal(first.status, 'failed');
      assert.deepEqual([...categories].sort(), [
        'absolute-local-path',
        'excluded-path',
        'forbidden-path-reference',
        'nested-build-output',
        'private-term',
        'source-binary',
        'symlink-escape',
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('manifest allowances can unblock intentional source exceptions', () => {
  withTempRoot((root) => {
    write(
      root,
      'tools/public-source/public-source-manifest.jsonc',
      `{
      // Allowances can live under hygiene.
      "hygiene": {
        "allowedSourceBinaryPaths": ["compute/fixture.wasm"],
        "allowedPrivateTerms": ["${privateRepoName}"],
        "allowedForbiddenPathReferences": ["${pathRef('plans')}"],
        "allowedAbsoluteLocalPaths": ["/Users/<user>/..."],
      },
    }`,
    );
    write(
      root,
      'docs/allowed.md',
      [
        `name ${privateRepoName}`,
        `plan ../${pathRef('plans')}public.md`,
        `local ${localHomePath()}`,
      ].join('\n'),
    );
    writeWasm(root, 'compute/fixture.wasm');

    const result = scanPublicSourceHygiene({ root });

    assert.equal(result.status, 'passed');
    assert.equal(result.manifest.loaded, true);
    assert.deepEqual(result.blockingFindings, []);
  });
});

test('scanner honors legacy manifest hygiene aliases', () => {
  withTempRoot((root) => {
    write(
      root,
      'tools/public-source/public-source-manifest.jsonc',
      `{
      "privateTerms": ["${privatePackage}"],
      "forbiddenPathReferences": ["${agentsSkillsRef()}"],
      "allowedPrivateTermGlobs": [
        "docs/**",
        "tools/public-source/public-source-manifest.jsonc"
      ],
      "allowedBinaryArtifacts": [
        { "path": "native/addon.node" },
      ],
    }`,
    );
    write(
      root,
      'docs/legacy.md',
      [`package ${privatePackage}`, `workflow ../${agentsSkillsRef()}index.md`].join('\n'),
    );
    write(root, 'native/addon.node', Buffer.from([0x4d, 0x5a, 0x90, 0x00]));

    const result = scanPublicSourceHygiene({ root });

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.blockingFindings, []);
  });
});

test('CLI exits nonzero on blocking findings', () => {
  withTempRoot((root) => {
    write(root, join('plans', 'private.md'), 'private\n');

    const result = spawnSync(process.execPath, [scannerPath, '--root', root], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /public-source hygiene: failed/);
    assert.match(result.stdout, /blocking findings: 1/);
  });
});
