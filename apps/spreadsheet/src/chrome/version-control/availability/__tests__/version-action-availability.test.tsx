import {
  getBranchAvailability,
  getCapabilityAvailability,
  getCheckoutAvailability,
  getCommitAvailability,
  getDiffAvailability,
  getRemotePromoteAvailability,
  getRollbackAvailability,
} from '../version-action-availability';

import {
  ACTION_CASES,
  SPLIT_CAPABILITY_CASES,
  TARGET_COMMIT_ID,
  createSurfaceStatus,
  expectDisabled,
} from './version-action-availability.test-utils';

describe('version action availability status gates', () => {
  it('disables actions while status data is missing, loading, or another action is running', () => {
    expectDisabled(
      getCommitAvailability(undefined, false, false, 'Checkpoint'),
      'Version status is unavailable.',
    );
    expectDisabled(
      getBranchAvailability(undefined, false, false, 'scenario/review', TARGET_COMMIT_ID),
      'Version status is unavailable.',
    );
    expectDisabled(
      getCheckoutAvailability(undefined, false, false),
      'Version status is unavailable.',
    );
    expectDisabled(getDiffAvailability(undefined, false, false), 'Version status is unavailable.');
    expectDisabled(
      getRollbackAvailability(
        undefined,
        false,
        false,
        'Rollback selected commit',
        TARGET_COMMIT_ID,
      ),
      'Version status is unavailable.',
    );
    expectDisabled(
      getRemotePromoteAvailability(undefined, false, false),
      'Version status is unavailable.',
    );

    for (const action of ACTION_CASES) {
      const surface = createSurfaceStatus();
      expectDisabled(
        action.availability(surface, { actionBusy: true }),
        'Wait for the current version action to finish.',
      );
      expectDisabled(
        action.availability(surface, { loading: true }),
        'Version status is refreshing.',
      );
      expectDisabled(
        action.availability(surface, { actionBusy: true, loading: true }),
        'Wait for the current version action to finish.',
      );
    }

    for (const action of SPLIT_CAPABILITY_CASES) {
      const surface = createSurfaceStatus();
      expectDisabled(
        getCapabilityAvailability({ surface }, true, false, action.capability),
        'Wait for the current version action to finish.',
      );
      expectDisabled(
        getCapabilityAvailability({ surface }, false, true, action.capability),
        'Version status is refreshing.',
      );
      expectDisabled(
        getCapabilityAvailability({ surface }, true, true, action.capability),
        'Wait for the current version action to finish.',
      );
    }
  });

  it('fails closed when the surface status itself is unavailable', () => {
    expectDisabled(
      getCommitAvailability({}, false, false, 'Checkpoint'),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getBranchAvailability({}, false, false, 'scenario/review', TARGET_COMMIT_ID),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getCheckoutAvailability({}, false, false),
      'Version surface status is unavailable.',
    );
    expectDisabled(getDiffAvailability({}, false, false), 'Version surface status is unavailable.');
    expectDisabled(
      getRollbackAvailability({}, false, false, 'Rollback selected commit', TARGET_COMMIT_ID),
      'Version surface status is unavailable.',
    );
    expectDisabled(
      getRemotePromoteAvailability({}, false, false),
      'Version surface status is unavailable.',
    );
  });

  it('enables actions when surface capabilities and local prerequisites pass', () => {
    const surface = createSurfaceStatus();

    for (const action of ACTION_CASES) {
      expect(action.availability(surface)).toEqual({ enabled: true });
    }
  });
});
