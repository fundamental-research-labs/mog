import { jest } from '@jest/globals';

import { createDocumentLifecycleSnapshotRootHydrator } from '../../../api/document/snapshot-root-lifecycle-hydrator';
import { VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION } from '../object-header';

export const RELOADED_DOCUMENT_ID = 'persistence-reloaded-doc';

export function createReloadLifecycleHydratorMock() {
  const lifecycleHydrator = createDocumentLifecycleSnapshotRootHydrator({
    userTimezone: 'UTC',
    documentIdFactory: () => RELOADED_DOCUMENT_ID,
  });
  return jest.fn(lifecycleHydrator.hydrateYrsFullState.bind(lifecycleHydrator));
}

export function expectReloadedSemanticChangeSetPayload(
  actualPayload: unknown,
  expectedPayload: unknown,
): void {
  expect(actualPayload).toEqual(expectedPayload);
  expect(actualPayload).toMatchObject({
    changes: expect.arrayContaining([
      expect.objectContaining({
        structural: expect.objectContaining({ domain: 'named-ranges' }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({ domain: 'tables' }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({ domain: 'comments-notes' }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({
          domain: 'conditional-formatting',
          entityId: 'sheet-1!cf:cf-top-10',
          propertyPath: ['rule'],
        }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({
          domain: 'data-validation',
          entityId: 'sheet-1!range:dv-status',
          propertyPath: ['range'],
        }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({ domain: 'filters' }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({ domain: 'sorts' }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({ domain: 'charts.source-range' }),
      }),
      expect.objectContaining({
        structural: expect.objectContaining({ domain: 'floating-objects.anchors' }),
      }),
    ]),
  });
}

export function expectReloadCompatibilityDiagnostics(diagnostics: unknown): void {
  expect(JSON.stringify(diagnostics)).toContain('VERSION_UNSUPPORTED_SCHEMA');
  expect(JSON.stringify(diagnostics)).toContain('minReaderVersion');
  expect(JSON.stringify(diagnostics)).toContain(VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION);
}
