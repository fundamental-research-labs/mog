import { expect, it } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  createDocumentByteSyncPortStub,
  createMockCtx,
  DOCUMENT_SCOPE,
  PROVENANCE_STATUS_CODES,
} from './version-provenance-status-test-utils';

export function registerProvenanceStatusProviderAttachmentScenarios(): void {
  it('advertises provenance from the real provider-backed VC09 truth attachment', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const syncPort = createDocumentByteSyncPortStub({ providerCycleEvidence: true });

    attachWorkbookVersioning(ctx, {
      provider,
      snapshotRootByteSyncPort: syncPort,
    });

    const versioning = ctx.versioning as {
      readonly provenanceTruthService?: {
        readonly vc09ProvenanceTruthComplete?: boolean;
        readonly vc09ProvenanceTruth?: {
          readonly source?: string;
          readonly vc09ProvenanceTruthComplete?: boolean;
          readonly requirements?: readonly { readonly attached: boolean }[];
        };
        readonly vc09ProvenanceStatusProjection?: {
          readonly redaction?: string;
        };
      };
    };
    expect(versioning.provenanceTruthService).toMatchObject({
      vc09ProvenanceTruthComplete: true,
      vc09ProvenanceStatusProjection: {
        redaction: 'classification-only',
      },
      vc09ProvenanceTruth: {
        source: 'provider-backed-sync-provenance',
        vc09ProvenanceTruthComplete: true,
      },
    });
    expect(
      versioning.provenanceTruthService?.vc09ProvenanceTruth?.requirements?.every(
        (requirement) => requirement.attached,
      ),
    ).toBe(true);

    const status = await new WorkbookVersionImpl(ctx).getStatus();

    expect(status.rolloutStage).toBe('shadow-only');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'present',
      available: true,
    });
    expect(status.provenanceAdmission.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['version.provenanceAdmission.present', ...PROVENANCE_STATUS_CODES]),
    );
    for (const code of PROVENANCE_STATUS_CODES) {
      expect(status.provenanceAdmission.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code,
            data: expect.objectContaining({
              redaction: 'classification-only',
              rawProviderMaterialIncluded: false,
              rawClientMaterialIncluded: false,
              safe: false,
              complete: false,
              projectedSafety: 'unsafe',
              projectedCompleteness: 'blocked',
            }),
          }),
        ]),
      );
    }
    expect(syncPort.encodeDiff).not.toHaveBeenCalled();
    expect(syncPort.applyProviderEnvelope).not.toHaveBeenCalled();
  });

  it('does not attach complete provider-backed truth without provider-cycle evidence', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const syncPort = createDocumentByteSyncPortStub();

    attachWorkbookVersioning(ctx, {
      provider,
      snapshotRootByteSyncPort: syncPort,
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
    expect(syncPort.encodeDiff).not.toHaveBeenCalled();
  });
}
