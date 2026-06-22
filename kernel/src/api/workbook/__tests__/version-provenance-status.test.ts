import { jest } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { attachWorkbookVersioning } from '../version-wiring';
import { WorkbookVersionImpl } from '../version';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: {
      assertWritable: jest.fn(),
    },
    services: {
      undo: {},
    },
    floatingObjectManager: {
      dispose: jest.fn(),
    },
    ...overrides,
  } as any;
}

function createDocumentByteSyncPortStub() {
  return {
    docId: DOCUMENT_SCOPE.documentId,
    applyUpdate: jest.fn(async () => undefined),
    encodeDiff: jest.fn(async () => new Uint8Array([0x01])),
    currentStateVector: jest.fn(async () => new Uint8Array([0x02])),
    applyUpdateWithProvenance: jest.fn(async () => undefined),
    applyProviderEnvelope: jest.fn(async () => undefined),
    applyClassifiedRawUpdate: jest.fn(async () => undefined),
  };
}

describe('WorkbookVersion provenance status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not advertise provenance from pending remote promotion plumbing alone', async () => {
    const promotePendingRemoteSegments = jest.fn();
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          pendingRemotePromotionService: {
            promotePendingRemoteSegments,
          },
        },
      }),
    );

    const status = await version.getStatus();

    expect(status.rolloutStage).toBe('disabled');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'unavailable',
      available: false,
    });
    expect(status.provenanceAdmission.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.provenanceAdmission.vc09TruthUnavailable',
        'version.provenanceAdmission.mutationAdmissionFoundationPresent',
        'version.provenancePromotion.serviceAttached',
      ]),
    );
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            requiredSlice: 'VC-09',
            pendingRemotePromotionServiceAttached: true,
          }),
        }),
      ]),
    );
    expect(status.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['version.provenancePromotion.serviceAttached']),
    );
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
  });

  it('advertises provenance only from an explicit complete VC09 truth signal', async () => {
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          provenanceTruthService: {
            vc09ProvenanceTruthComplete: true,
          },
        },
      }),
    );

    const status = await version.getStatus();

    expect(status.rolloutStage).toBe('shadow-only');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'present',
      available: true,
    });
    expect(status.provenanceAdmission.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['version.provenanceAdmission.present']),
    );
  });

  it('advertises provenance from the real provider-backed VC09 truth attachment', async () => {
    const ctx = createMockCtx();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const syncPort = createDocumentByteSyncPortStub();

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
      };
    };
    expect(versioning.provenanceTruthService).toMatchObject({
      vc09ProvenanceTruthComplete: true,
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
      expect.arrayContaining(['version.provenanceAdmission.present']),
    );
    expect(syncPort.encodeDiff).not.toHaveBeenCalled();
    expect(syncPort.applyProviderEnvelope).not.toHaveBeenCalled();
  });

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
});
