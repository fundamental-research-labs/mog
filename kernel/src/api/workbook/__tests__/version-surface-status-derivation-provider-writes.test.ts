import 'fake-indexeddb/auto';

import { jest } from '@jest/globals';

import {
  createMalformedProviderWriteActivityStatusService,
  createProviderFailureClaimedSafeSurfaceVersion,
} from './version-surface-status-derivation-test-utils';

describe('WorkbookVersion surface status provider-write derivation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats malformed provider write activity status as unknown and unsafe', async () => {
    const service = createMalformedProviderWriteActivityStatusService();

    const dirty = await service.readDirtyStatus();

    expect(dirty.pendingProviderWrites).toBe(true);
    expect(dirty.checkoutSafe).toBe(false);
    expect(dirty.statusRevision).toContain('providerWrites:providerActivity:unknown');
    expect(dirty.unsafeReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
          dependency: 'VC-09',
          data: expect.objectContaining({
            redacted: true,
            providerPayload: 'providerWriteStatus',
          }),
        }),
      ]),
    );
  });

  it('does not trust attached dirty status that reports provider failure as checkout-safe', async () => {
    const surfaceReady = createProviderFailureClaimedSafeSurfaceVersion();

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.dirty.pendingProviderWrites).toBe(true);
    expect(surface.dirty.checkoutSafe).toBe(false);
    expect(surface.dirty.unsafeReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
          data: { safeCount: 1 },
        }),
      ]),
    );
    expect(surface.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.surfaceStatus.pendingProviderWritesReadFailed',
          data: { safeCount: 1 },
        }),
      ]),
    );
    expect(surfaceReady.readDirtyStatus).toHaveBeenCalledTimes(1);
  });
});
