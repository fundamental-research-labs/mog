import { expect, it, jest } from '@jest/globals';

import {
  commitSummary,
  createMockEventBus,
  createWorkbook,
} from './version-commit-dirty-tracking-test-utils';

export function registerAsyncCommitDirtyTrackingScenarios(): void {
  it('ignores non-mutating workbook events while clearing committed dirty state', async () => {
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
    for (const event of nonMutatingWorkbookEvents()) {
      eventBus.emit(event);
    }
    resolveCommit(commitSummary('child'));

    await expect(commitResult).resolves.toMatchObject({ ok: true });
    expect(wb.isDirty).toBe(false);
  });

  it('keeps workbook dirty when a real mutation event lands during the async commit', async () => {
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
    eventBus.emit({
      type: 'cell:changed',
      sheetId: 'sheet-1',
      row: 0,
      col: 0,
      oldValue: 'before',
      newValue: 'after',
      source: 'user',
      timestamp: Date.now(),
    });
    resolveCommit(commitSummary('child'));

    await expect(commitResult).resolves.toMatchObject({ ok: true });
    expect(wb.isDirty).toBe(true);
  });

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

function nonMutatingWorkbookEvents(): readonly unknown[] {
  const timestamp = Date.now();
  return [
    { type: 'chrome:theme-changed', chromeTheme: 'light', timestamp },
    { type: 'export:progress', phase: 'packaging', progress: 0.5, timestamp },
    {
      type: 'export:complete',
      success: true,
      sheetCount: 1,
      cellCount: 1,
      fileSizeBytes: 1024,
      durationMs: 3,
      timestamp,
    },
    {
      type: 'freeze:changed',
      sheetId: 'sheet-1',
      oldFrozenRows: 0,
      oldFrozenCols: 0,
      newFrozenRows: 1,
      newFrozenCols: 0,
      source: 'user',
      timestamp,
    },
    { type: 'import:progress', phase: 'finalizing', progress: 0.75, timestamp },
    {
      type: 'import:complete',
      success: true,
      sheetCount: 1,
      cellCount: 1,
      durationMs: 3,
      timestamp,
    },
    { type: 'recalc:started', sheetId: 'sheet-1', cellCount: 1, timestamp },
    {
      type: 'recalc:completed',
      sheetId: 'sheet-1',
      cellCount: 1,
      durationMs: 3,
      errors: 0,
      timestamp,
    },
    {
      type: 'selection:changed',
      sheetId: 'sheet-1',
      oldSelection: null,
      newSelection: null,
      timestamp,
    },
    {
      type: 'scroll:changed',
      sheetId: 'sheet-1',
      scrollX: 24,
      scrollY: 0,
      source: 'keyboard',
      timestamp,
    },
    {
      type: 'split:position-changed',
      sheetId: 'sheet-1',
      config: { direction: 'vertical', horizontalPosition: 0, verticalPosition: 1 },
      source: 'user',
      timestamp,
    },
    { type: 'split:removed', sheetId: 'sheet-1', source: 'user', timestamp },
    { type: 'store:ready', sheetId: 'sheet-1', hadExistingData: true, timestamp },
    { type: 'store:sync-error', error: 'transient', recoverable: true, timestamp },
    {
      type: 'view:options-changed',
      sheetId: 'sheet-1',
      showGridlines: true,
      showRowHeaders: true,
      showColumnHeaders: true,
      source: 'user',
      timestamp,
    },
    {
      type: 'view:selection-changed',
      sheetId: 'sheet-1',
      activeCell: { row: 1, col: 2 },
      ranges: [{ startRow: 1, startCol: 2, endRow: 1, endCol: 2 }],
      source: 'user',
      timestamp,
    },
    {
      type: 'viewport:resized',
      sheetId: 'sheet-1',
      visibleRange: { startRow: 0, endRow: 20, startCol: 0, endCol: 10 },
      viewportSize: { width: 800, height: 600 },
      timestamp,
    },
    {
      type: 'workbook:policy-preserved',
      outcomes: [],
      summary: { preserved: 0, dropped: 0, warningCount: 0 },
      source: 'user',
      timestamp,
    },
    {
      type: 'workbook:version-checkout-materialized',
      commitId: 'commit:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      targetKind: 'ref',
      refName: 'refs/heads/main',
      timestamp,
    },
    {
      type: 'workbook:version-dirty-status-changed',
      hasUncommittedLocalChanges: true,
      previousHasUncommittedLocalChanges: true,
      statusRevision: 2,
      timestamp,
    },
    {
      type: 'workbook:version-active-checkout-state-changed',
      activeCheckoutSession: null,
      previousActiveCheckoutSession: null,
      statusRevision: 1,
      reason: 'branch-ref-moved',
      timestamp,
    },
    { type: 'security:policies-reloaded', timestamp },
  ];
}
