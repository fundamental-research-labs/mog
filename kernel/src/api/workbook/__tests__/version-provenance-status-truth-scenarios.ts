import { expect, it, jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';
import { createMockCtx } from './version-provenance-status-test-utils';

export function registerProvenanceStatusTruthScenarios(): void {
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
}
