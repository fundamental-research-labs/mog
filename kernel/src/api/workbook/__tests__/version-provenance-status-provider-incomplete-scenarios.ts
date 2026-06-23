import { expect, it, jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import { createMockCtx, DOCUMENT_SCOPE } from './version-provenance-status-test-utils';

export function registerProvenanceStatusProviderIncompleteScenarios(): void {
  it('does not attach complete provider-backed truth with only a snapshot encoder', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const encodeDiff = jest.fn(async () => new Uint8Array([0x01]));

    attachWorkbookVersioning(ctx, {
      provider,
      snapshotRootByteSyncPort: { encodeDiff },
    });

    const versioning = ctx.versioning as {
      readonly provenanceTruthService?: unknown;
      readonly pendingRemotePromotionService?: unknown;
    };
    expect(versioning.pendingRemotePromotionService).toBeDefined();
    expect(versioning.provenanceTruthService).toBeUndefined();

    const status = await new WorkbookVersionImpl(ctx).getStatus();

    expect(status.rolloutStage).toBe('disabled');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'unavailable',
      available: false,
    });
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            pendingRemotePromotionServiceAttached: true,
          }),
        }),
      ]),
    );
    expect(encodeDiff).not.toHaveBeenCalled();
  });

  it('does not attach complete provider-backed truth without snapshot-root capture', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });

    attachWorkbookVersioning(ctx, { provider });

    const versioning = ctx.versioning as {
      readonly provenanceTruthService?: unknown;
      readonly pendingRemotePromotionService?: unknown;
    };
    expect(versioning.pendingRemotePromotionService).toBeDefined();
    expect(versioning.provenanceTruthService).toBeUndefined();

    const status = await new WorkbookVersionImpl(ctx).getStatus();

    expect(status.rolloutStage).toBe('disabled');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'unavailable',
      available: false,
    });
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            pendingRemotePromotionServiceAttached: true,
          }),
        }),
      ]),
    );
  });
}
