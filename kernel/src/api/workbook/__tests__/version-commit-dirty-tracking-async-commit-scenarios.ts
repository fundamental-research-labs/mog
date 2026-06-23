import { expect, it, jest } from '@jest/globals';

import {
  commitSummary,
  createMockEventBus,
  createWorkbook,
} from './version-commit-dirty-tracking-test-utils';

export function registerAsyncCommitDirtyTrackingScenarios(): void {
  it('keeps workbook dirty when another dirty event lands during the async commit', async () => {
    const eventBus = createMockEventBus();
    let resolveCommit!: (value: unknown) => void;
    let notifyCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => {
      notifyCommitStarted = resolve;
    });
    const commit = jest.fn(() => {
      notifyCommitStarted();
      return new Promise((resolve) => {
        resolveCommit = resolve;
      });
    });
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit } as any,
      },
    });
    eventBus.emit({ type: 'test:dirty-before-commit' });

    const commitResult = wb.version.commit();
    await commitStarted;
    eventBus.emit({ type: 'test:dirty-during-commit' });
    resolveCommit(commitSummary('child'));

    await expect(commitResult).resolves.toMatchObject({ ok: true });
    expect(wb.isDirty).toBe(true);
  });
}
