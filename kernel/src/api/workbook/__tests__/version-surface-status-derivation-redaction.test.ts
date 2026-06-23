import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import {
  REDACTED_BATCH_STATUS_ID,
  REDACTED_CURSOR,
  createLowerGateRedactionSurfaceVersion,
  createMalformedManifestAndDirtyStatusSurfaceVersion,
} from './version-surface-status-derivation-test-utils';

describe('WorkbookVersion surface status derivation redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redacts lower-gate diagnostic projection payloads', async () => {
    const rawGateId = 'gate-secret-token';
    const rawRepoId = 'repo-secret-token';
    const surfaceReady = createLowerGateRedactionSurfaceVersion(rawGateId, rawRepoId);

    const surface = await surfaceReady.version.getSurfaceStatus();
    const serialized = JSON.stringify(surface);

    expect(surface.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
          data: expect.objectContaining({ gateId: 'redacted', status: 'blocked' }),
        }),
        expect.objectContaining({
          code: 'version.surfaceStatus.lowerGateEvidenceBlocked',
          data: expect.objectContaining({ repoId: 'redacted', status: 'dirtyBlocked' }),
        }),
      ]),
    );
    expect(serialized).not.toContain(rawGateId);
    expect(serialized).not.toContain(rawRepoId);
  });

  it('redacts malformed manifest and attached dirty-status diagnostic payloads', async () => {
    const surfaceReady = createMalformedManifestAndDirtyStatusSurfaceVersion();

    const surface = await surfaceReady.version.getSurfaceStatus();
    const serialized = JSON.stringify(surface);

    expect(surface.dirty.unsafeReasons[0]?.data).toMatchObject({
      cursor: 'redacted',
      batchStatusId: 'redacted',
      hiddenSheetId: 'redacted',
      safeCount: 2,
    });
    expect(surface.dirty.diagnostics[0]?.data).toMatchObject({
      cursor: 'redacted',
      batchStatusId: 'redacted',
      secretToken: 'redacted',
      safeCount: 2,
    });
    expect(serialized).not.toContain(REDACTED_CURSOR);
    expect(serialized).not.toContain(REDACTED_BATCH_STATUS_ID);
    expect(serialized).not.toContain('sheet-secret');
    expect(serialized).not.toContain('token-secret');
    expect(serialized).not.toContain('not-public-secret-schema');
    expect(serialized).not.toContain('not-public-secret-date');
    expect(surfaceReady.readDirtyStatus).toHaveBeenCalledTimes(1);
  });
});
