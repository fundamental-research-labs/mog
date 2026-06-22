import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

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

describe('WorkbookVersion provenance status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('advertises attached pending remote provenance service without invoking it', async () => {
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

    expect(status.rolloutStage).toBe('shadow-only');
    expect(status.provenanceAdmission).toMatchObject({
      stage: 'present',
      available: true,
    });
    expect(status.provenanceAdmission.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        'version.provenanceAdmission.present',
        'version.provenancePromotion.serviceAttached',
      ]),
    );
    expect(status.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(['version.provenancePromotion.serviceAttached']),
    );
    expect(promotePendingRemoteSegments).not.toHaveBeenCalled();
  });
});
