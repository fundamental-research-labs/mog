import {
  createWorkbook,
  resetVersionStatusWorkbookMocks,
} from './version-status-workbook-test-utils';

describe('WorkbookVersion status slice', () => {
  beforeEach(() => {
    resetVersionStatusWorkbookMocks();
  });

  it('exposes read-only version status on a created workbook', async () => {
    const wb = createWorkbook();

    const status = await wb.version.getStatus();

    expect(status.schemaVersion).toBe(1);
    expect(status.rolloutStage).toBe('disabled');
    expect(status.objectStoreFoundation.stage).toBe('present');
    expect(status.refLifecycleFoundation.stage).toBe('present');
    expect(status.commitApi.stage).toBe('pending');
    expect(status.checkout.stage).toBe('pending');
    expect(status.merge.stage).toBe('pending');
    expect(status.provenanceAdmission.stage).toBe('unavailable');
    expect(status.provenanceAdmission.available).toBe(false);
    expect(new Set(status.diagnostics.map((diagnostic) => diagnostic.code)).size).toBe(
      status.diagnostics.length,
    );
    expect(status.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.objectStore.serviceUnavailable',
        'version.refLifecycle.serviceUnavailable',
        'version.commitApi.pending',
        'version.checkout.pending',
        'version.merge.pending',
        'version.provenanceAdmission.vc09TruthUnavailable',
        'version.provenanceAdmission.mutationAdmissionFoundationPresent',
      ]),
    );
    expect(status.provenanceAdmission.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'version.provenanceAdmission.vc09TruthUnavailable',
          data: expect.objectContaining({
            requiredSlice: 'VC-09',
            pendingRemotePromotionServiceAttached: false,
          }),
        }),
      ]),
    );

    expect('listCommits' in wb.version).toBe(true);
    expect('readRef' in wb.version).toBe(true);
    expect('commit' in wb.version).toBe(true);
    expect('merge' in wb.version).toBe(true);
    expect('diff' in wb.version).toBe(true);
  });

  it('exposes checkout, merge, and ref lifecycle methods', () => {
    const wb = createWorkbook();

    expect('checkout' in wb.version).toBe(true);
    expect('merge' in wb.version).toBe(true);
    expect('diff' in wb.version).toBe(true);
    expect('createBranch' in wb.version).toBe(true);
    expect('listRefs' in wb.version).toBe(true);
    expect('fastForwardBranch' in wb.version).toBe(true);
    expect('updateBranch' in wb.version).toBe(true);
    expect('deleteBranch' in wb.version).toBe(true);
  });
});
