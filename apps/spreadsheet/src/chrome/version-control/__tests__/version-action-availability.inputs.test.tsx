import {
  getBranchAvailability,
  getCommitAvailability,
  getRollbackAvailability,
} from '../version-action-availability';

import {
  TARGET_COMMIT_ID,
  createSurfaceStatus,
  expectDisabled,
  ref,
} from './version-action-availability.test-utils';

describe('version action availability input validation', () => {
  it('requires messages, names, and targets after surface capabilities pass', () => {
    const surface = createSurfaceStatus();

    expectDisabled(
      getCommitAvailability({ surface }, false, false, '   '),
      'Enter a commit message.',
    );
    expectDisabled(
      getBranchAvailability({ surface }, false, false, 'scenario/review', undefined),
      'Select a commit target first.',
    );
    expectDisabled(
      getBranchAvailability({ surface }, false, false, '   ', TARGET_COMMIT_ID),
      'Enter a branch name.',
    );
    expectDisabled(
      getRollbackAvailability({ surface }, false, false, 'Rollback selected commit', undefined),
      'Select a commit target first.',
    );
    expectDisabled(
      getRollbackAvailability({ surface }, false, false, '   ', TARGET_COMMIT_ID),
      'Enter a rollback reason.',
    );
  });

  it('validates branch creation names against public refs, protected main, and loaded refs', () => {
    const surface = createSurfaceStatus();
    const refs = [
      ref('refs/heads/main'),
      ref('refs/heads/scenario/budget'),
      ref('refs/heads/review/model-a'),
    ];

    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'main', TARGET_COMMIT_ID),
      'main is protected and cannot be created from the version panel.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'refs/heads/main', TARGET_COMMIT_ID),
      'main is protected and cannot be created from the version panel.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'HEAD', TARGET_COMMIT_ID),
      'HEAD is symbolic and cannot be created as a branch.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'refs/tags/review', TARGET_COMMIT_ID),
      'Branch refs must use refs/heads/<branch>.',
    );
    expectDisabled(
      getBranchAvailability(
        { surface, refs },
        false,
        false,
        'refs/heads/scenario/budget',
        TARGET_COMMIT_ID,
      ),
      'Branch scenario/budget already exists.',
    );
    expectDisabled(
      getBranchAvailability({ surface, refs }, false, false, 'review', TARGET_COMMIT_ID),
      'Branch names must start with scenario/, agent/, import/, or review/.',
    );

    expect(
      getBranchAvailability(
        { surface, refs },
        false,
        false,
        'refs/heads/scenario/forecast-q1',
        TARGET_COMMIT_ID,
      ),
    ).toEqual({ enabled: true });
  });
});
