/**
 * Conformance tests — manifest validation.
 */

import { validateManifest } from '../../manifest-validator';
import { TASK_TRACKER_MANIFEST } from '../fixtures/task-tracker-manifest';
import { SPREADSHEET_CANONICAL_MANIFEST } from '@mog/app-spreadsheet/src/canonical-manifest';
import type { AppManifest } from '../../types';

function makeValidManifest(): Record<string, unknown> {
  return {
    id: 'test-app',
    name: 'Test App',
    version: '1.0.0',
    description: 'A test app',
    author: 'Test',
    icon: 'test',
    entry: { module: '@test/app', export: 'default' },
    kind: 'utility-app',
    compatibility: [{ profile: 'mog.app-platform/v1', versionRange: '>=0.1.0' }],
    capabilities: ['services:basic'],
    routes: [{ path: '/test' }],
    contributions: [
      { contributionPointId: 'mog.commands', kind: 'command', id: 'test-cmd', label: 'Test' },
    ],
    lifecycle: { suspendable: false },
    runtimeHost: 'same-realm-first-party',
  };
}

describe('Manifest Validation', () => {
  it('valid app manifest passes validation', () => {
    const errors = validateManifest(makeValidManifest());
    expect(errors).toHaveLength(0);
  });

  it('missing required fields fail', () => {
    const manifest: Record<string, unknown> = {};
    const errors = validateManifest(manifest);
    expect(errors.length).toBeGreaterThan(0);

    const fields = errors.map((e) => e.field);
    expect(fields).toContain('id');
    expect(fields).toContain('name');
    expect(fields).toContain('version');
    expect(fields).toContain('description');
    expect(fields).toContain('author');
    expect(fields).toContain('icon');
    expect(fields).toContain('entry');
    expect(fields).toContain('kind');
    expect(fields).toContain('runtimeHost');
    expect(fields).toContain('compatibility');
    expect(fields).toContain('capabilities');
    expect(fields).toContain('routes');
    expect(fields).toContain('contributions');
    expect(fields).toContain('lifecycle');
  });

  it('invalid AppKind fails', () => {
    const manifest = makeValidManifest();
    manifest.kind = 'banana-app';
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'kind')).toBe(true);
  });

  it('invalid RuntimeHostMode fails', () => {
    const manifest = makeValidManifest();
    manifest.runtimeHost = 'teleport-sandboxed';
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'runtimeHost')).toBe(true);
  });

  it('duplicate contribution IDs fail', () => {
    const manifest = makeValidManifest();
    manifest.contributions = [
      { contributionPointId: 'mog.commands', kind: 'command', id: 'dup-id', label: 'A' },
      { contributionPointId: 'mog.commands', kind: 'command', id: 'dup-id', label: 'B' },
    ];
    const errors = validateManifest(manifest);
    expect(errors.some((e) => e.field === 'contributions' && e.message.includes('Duplicate'))).toBe(
      true,
    );
  });

  it('task tracker manifest validates', () => {
    const errors = validateManifest(TASK_TRACKER_MANIFEST as unknown as Record<string, unknown>);
    expect(errors).toHaveLength(0);
  });

  it('spreadsheet canonical manifest validates', () => {
    const errors = validateManifest(
      SPREADSHEET_CANONICAL_MANIFEST as unknown as Record<string, unknown>,
    );
    expect(errors).toHaveLength(0);
  });
});
