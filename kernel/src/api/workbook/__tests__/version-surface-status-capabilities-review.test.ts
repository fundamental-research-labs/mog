import { jest } from '@jest/globals';

import { createSurfaceReadyVersionWithContext } from './version-surface-status-test-utils';

describe('WorkbookVersion surface status review capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enables review read and write when matching review service methods are attached', async () => {
    const surfaceReady = createSurfaceReadyVersionWithContext(
      {},
      {
        reviewService: {
          listReviews: jest.fn(),
          getReview: jest.fn(),
          getReviewDiff: jest.fn(),
          createReview: jest.fn(),
          appendReviewDecision: jest.fn(),
          updateReviewStatus: jest.fn(),
        },
      },
    );

    const surface = await surfaceReady.version.getSurfaceStatus();

    expect(surface.capabilities['version:reviewRead']).toEqual({ enabled: true });
    expect(surface.capabilities['version:reviewWrite']).toEqual({ enabled: true });
  });

  it('projects review read and write capabilities independently', async () => {
    const readOnly = createSurfaceReadyVersionWithContext(
      {},
      {
        reviewService: {
          listReviews: jest.fn(),
          getReview: jest.fn(),
          getReviewDiff: jest.fn(),
        },
      },
    );
    const writeOnly = createSurfaceReadyVersionWithContext(
      {},
      {
        reviewService: {
          createReview: jest.fn(),
          appendReviewDecision: jest.fn(),
          updateReviewStatus: jest.fn(),
        },
      },
    );

    const readSurface = await readOnly.version.getSurfaceStatus();
    const writeSurface = await writeOnly.version.getSurfaceStatus();

    expect(readSurface.capabilities['version:reviewRead']).toEqual({ enabled: true });
    expect(readSurface.capabilities['version:reviewWrite']).toMatchObject({
      enabled: false,
      dependency: 'storage',
      retryable: true,
    });
    expect(writeSurface.capabilities['version:reviewRead']).toMatchObject({
      enabled: false,
      dependency: 'storage',
      retryable: true,
    });
    expect(writeSurface.capabilities['version:reviewWrite']).toEqual({ enabled: true });
  });
});
