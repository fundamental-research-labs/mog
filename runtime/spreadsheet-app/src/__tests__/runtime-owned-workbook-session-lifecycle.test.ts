import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpreadsheetRuntime } from '../runtime';
import type {
  SpreadsheetCapability,
  SpreadsheetRuntime,
  SpreadsheetRuntimeOptions,
  SpreadsheetSaveRequest,
  SpreadsheetSaveResult,
} from '../public-types';
import { SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER } from '../attachment-runtime';
import type { RegisteredSpreadsheetAppBridge } from '../runtime-types';

function savedResult(request: SpreadsheetSaveRequest): SpreadsheetSaveResult {
  return {
    status: 'saved',
    workbookId: request.workbookId,
    epoch: request.epoch,
    dirtyEpoch: request.dirtyEpoch,
    changeSequence: request.changeSequence,
    saveRequestId: request.saveRequestId,
    bytesHash: request.bytesHash,
    baseVersionId: request.baseVersionId,
    versionId: `test-saved-${request.changeSequence}`,
  };
}

function runtimeOptions(runtimeId: string): SpreadsheetRuntimeOptions {
  return {
    runtimeId,
    host: {
      persistenceMode: 'host-owned-ephemeral',
      authority: {
        resolveActor(ref) {
          return {
            actorId: ref.actorId,
            kind: ref.kind ?? 'host',
            displayName: ref.displayName,
          };
        },
        authorize() {
          return { decision: 'allowed', policyVersion: 'runtime-test' };
        },
      },
    },
    onSaveRequest: savedResult,
  };
}

function runtimeOptionsWithDeniedCapabilities(
  runtimeId: string,
  deniedCapabilities: ReadonlySet<SpreadsheetCapability>,
): SpreadsheetRuntimeOptions {
  return {
    runtimeId,
    host: {
      persistenceMode: 'host-owned-ephemeral',
      authority: {
        resolveActor(ref) {
          return {
            actorId: ref.actorId,
            kind: ref.kind ?? 'host',
            displayName: ref.displayName,
          };
        },
        authorize(_actor, capability) {
          return deniedCapabilities.has(capability)
            ? {
                decision: 'denied',
                policyVersion: 'runtime-test',
                reason: `denied ${capability}`,
              }
            : { decision: 'allowed', policyVersion: 'runtime-test' };
        },
      },
    },
    onSaveRequest: savedResult,
  };
}

async function disposeRuntime(runtime: SpreadsheetRuntime | undefined): Promise<void> {
  if (!runtime) return;
  await runtime.dispose();
}

test('runtime-owned workbook session stays usable headlessly and is disposed explicitly', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(runtimeOptions('runtime-headless-contract'));
    await runtime.ready;

    const workbook = await runtime.openWorkbook({
      workbookId: 'runtime-headless-workbook',
      displayName: 'Headless Workbook',
      source: { kind: 'blank' },
    });
    await workbook.ready;

    assert.equal(workbook.getStatus(), 'ready');
    assert.deepEqual(workbook.getAttachmentState(), {
      status: 'headless',
      workbookId: workbook.workbookId,
      epoch: workbook.epoch,
    });
    assert.equal(runtime.getWorkbookSession(workbook.workbookId), workbook);
    assert.deepEqual(
      runtime.listWorkbookSessions().map((session) => session.workbookId),
      [workbook.workbookId],
    );

    const dirtyStates: string[] = [];
    const saveStates: string[] = [];
    const disposedEvents: string[] = [];
    workbook.onDirtyChange((state) => dirtyStates.push(state.status));
    workbook.onSaveStateChange((state) => saveStates.push(state.status));
    workbook.onDisposed(() => disposedEvents.push('disposed'));

    const facade = workbook.getWorkbook();
    await facade.activeSheet.setCell('A1', 'headless-before-attach');
    assert.equal((await facade.activeSheet.getCell('A1')).value, 'headless-before-attach');
    assert.ok(dirtyStates.includes('dirty'), 'programmatic headless write marks the session dirty');

    const saveResult = await workbook.requestSave({
      actorId: 'test-host',
      kind: 'host',
    });
    assert.equal(saveResult.status, 'saved');
    assert.ok(saveStates.includes('saving'), 'requestSave emits saving state');
    assert.ok(saveStates.includes('clean'), 'saved result returns the session to clean state');

    await workbook.dispose();
    assert.equal(workbook.getStatus(), 'disposed');
    assert.deepEqual(disposedEvents, ['disposed']);
    assert.equal(runtime.getWorkbookSession(workbook.workbookId), null);
    assert.throws(() => workbook.getWorkbook(), /disposed/i);
  } finally {
    await disposeRuntime(runtime);
  }
});

test('runtime.dispose disposes every open workbook session and stale facades reject', async () => {
  const runtime = await createSpreadsheetRuntime(
    runtimeOptions('runtime-runtime-dispose-contract'),
  );
  await runtime.ready;

  const first = await runtime.openWorkbook({
    workbookId: 'runtime-runtime-dispose-a',
    source: { kind: 'blank' },
  });
  const second = await runtime.openWorkbook({
    workbookId: 'runtime-runtime-dispose-b',
    source: { kind: 'blank' },
  });
  await Promise.all([first.ready, second.ready]);

  const firstFacade = first.getWorkbook();
  const secondFacade = second.getWorkbook();
  await firstFacade.activeSheet.setCell('A1', 1);
  await secondFacade.activeSheet.setCell('A1', 2);

  await runtime.dispose();

  assert.equal(first.getStatus(), 'disposed');
  assert.equal(second.getStatus(), 'disposed');
  assert.equal(runtime.getWorkbookSession(first.workbookId), null);
  assert.equal(runtime.getWorkbookSession(second.workbookId), null);
  await assert.rejects(() => firstFacade.activeSheet.setCell('B1', 3), /disposed/i);
  await assert.rejects(() => secondFacade.activeSheet.getCell('A1'), /disposed/i);
});

test('dispose/reopen with the same public workbookId creates a fresh session epoch', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(runtimeOptions('runtime-same-id-contract'));
    await runtime.ready;

    const workbookId = 'runtime-same-public-id';
    const first = await runtime.openWorkbook({ workbookId, source: { kind: 'blank' } });
    await first.ready;
    const firstFacade = first.getWorkbook();
    await firstFacade.activeSheet.setCell('A1', 'old-session');

    await first.dispose();
    assert.equal(first.getStatus(), 'disposed');

    const second = await runtime.openWorkbook({ workbookId, source: { kind: 'blank' } });
    await second.ready;
    assert.equal(second.workbookId, workbookId);
    assert.notEqual(second.epoch, first.epoch);
    assert.equal((await second.getWorkbook().activeSheet.getCell('A1')).value, null);
    await assert.rejects(
      () => firstFacade.activeSheet.setCell('A1', 'must-reject'),
      /disposed|stale/i,
    );
  } finally {
    await disposeRuntime(runtime);
  }
});

test('same semantic workbookId can be open in distinct workbook sessions', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(
      runtimeOptions('duplicate-semantic-duplicate-semantic-id'),
    );
    await runtime.ready;

    const semanticWorkbookId = 'duplicate-semantic-same-semantic-workbook';
    const first = await runtime.openWorkbook({
      workbookId: semanticWorkbookId,
      workbookSessionId: 'duplicate-semantic-open-copy-a',
      source: { kind: 'blank' },
    });
    const second = await runtime.openWorkbook({
      workbookId: semanticWorkbookId,
      workbookSessionId: 'duplicate-semantic-open-copy-b',
      source: { kind: 'blank' },
    });
    await Promise.all([first.ready, second.ready]);

    assert.equal(first.workbookId, semanticWorkbookId);
    assert.equal(second.workbookId, semanticWorkbookId);
    assert.equal(first.workbookSessionId, 'duplicate-semantic-open-copy-a');
    assert.equal(second.workbookSessionId, 'duplicate-semantic-open-copy-b');
    assert.notEqual(first.workbookSessionId, second.workbookSessionId);
    assert.equal(runtime.getWorkbookSession(first.workbookSessionId), first);
    assert.equal(runtime.getWorkbookSession(second.workbookSessionId), second);
    assert.equal(
      runtime.getWorkbookSessionByWorkbookId(semanticWorkbookId),
      null,
      'semantic workbookId lookup is ambiguous when raw copies are open',
    );

    await first.getWorkbook().activeSheet.setCell('A1', 'copy-a');
    await second.getWorkbook().activeSheet.setCell('A1', 'copy-b');
    assert.equal((await first.getWorkbook().activeSheet.getCell('A1')).value, 'copy-a');
    assert.equal((await second.getWorkbook().activeSheet.getCell('A1')).value, 'copy-b');
  } finally {
    await disposeRuntime(runtime);
  }
});

test('read-only inspection, screenshot, and dependency reads do not dirty a clean workbook', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(runtimeOptions('runtime-read-only-tools-clean'));
    await runtime.ready;

    const workbook = await runtime.openWorkbook({
      workbookId: 'runtime-read-only-tools-workbook',
      source: { kind: 'blank' },
    });
    await workbook.ready;

    const facade = workbook.getWorkbook();
    await facade.activeSheet.setCell('A1', 41);
    await facade.activeSheet.setCell('B1', '=A1+1');
    const saveResult = await workbook.requestSave({ actorId: 'test-host', kind: 'host' });
    assert.equal(saveResult.status, 'saved');

    const dirtyStates: string[] = [];
    const unsubscribeDirty = workbook.onDirtyChange((state) => dirtyStates.push(state.status));
    const actor = await workbook.resolveActor({ actorId: 'test-host', kind: 'host' });

    assert.equal((await facade.activeSheet.getCell('A1')).value, 41);
    assert.ok(await facade.activeSheet.getFormula('B1'));
    assert.deepEqual(await facade.activeSheet.getPrecedents('B1'), ['A1']);
    assert.deepEqual(await facade.activeSheet.getDependents('A1'), ['B1']);
    assert.ok((await workbook.captureScreenshot(actor, 'Sheet1', 'A1:B1')).byteLength > 0);

    assert.deepEqual(dirtyStates, []);
    unsubscribeDirty();
  } finally {
    await disposeRuntime(runtime);
  }
});

test('version surface status remains available without version read grant', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    const deniedVersionCapabilities = new Set<SpreadsheetCapability>([
      'version:read',
      'version:diff',
      'version:commit',
      'version:branch',
      'version:checkout',
      'version:reviewRead',
      'version:reviewWrite',
      'version:proposal',
      'version:mergePreview',
      'version:mergeApply',
      'version:revert',
      'version:provenance',
    ]);
    runtime = await createSpreadsheetRuntime(
      runtimeOptionsWithDeniedCapabilities(
        'runtime-version-surface-status-capability-free',
        deniedVersionCapabilities,
      ),
    );
    await runtime.ready;

    const workbook = await runtime.openWorkbook({
      workbookId: 'runtime-version-surface-status-capability-free-workbook',
      source: { kind: 'blank' },
    });
    await workbook.ready;
    const actor = await workbook.resolveActor({ actorId: 'reader', kind: 'user' });
    const facade = actor.getWorkbook();

    const surface = await facade.version.getSurfaceStatus();
    assert.equal(surface.schemaVersion, 1);
    assert.equal(surface.capabilities['version:read'].enabled, false);

    assert.throws(
      () => void facade.version.getStatus(),
      /Capability "version:read" is denied for WorkbookVersion\.getStatus/,
    );
    assert.deepEqual(await facade.version.getHead(), {
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:read',
        dependency: 'hostCapability',
        reason: 'Capability "version:read" is denied for WorkbookVersion.getHead',
        retryable: false,
      },
    });
    const applyMergeDenied = await facade.version.applyMerge(
      {} as Parameters<typeof facade.version.applyMerge>[0],
    );
    assert.equal(applyMergeDenied.ok, false);
    if (!applyMergeDenied.ok) {
      assert.equal(applyMergeDenied.error.code, 'version_capability_unavailable');
      if (applyMergeDenied.error.code === 'version_capability_unavailable') {
        assert.equal(applyMergeDenied.error.capability, 'version:mergePreview');
        assert.deepEqual(applyMergeDenied.error.diagnostics?.[0]?.data?.deniedCapabilities, [
          'version:mergePreview',
          'version:mergeApply',
          'version:branch',
        ]);
      }
    }
    const getReviewDenied = await facade.version.getReview({ reviewId: 'review-1' });
    assert.deepEqual(getReviewDenied, {
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:reviewRead',
        dependency: 'hostCapability',
        reason: 'Capability "version:reviewRead" is denied for WorkbookVersion.getReview',
        retryable: false,
      },
    });
    const createReviewDenied = await facade.version.createReview(
      {} as Parameters<typeof facade.version.createReview>[0],
    );
    assert.deepEqual(createReviewDenied, {
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:reviewWrite',
        dependency: 'hostCapability',
        reason: 'Capability "version:reviewWrite" is denied for WorkbookVersion.createReview',
        retryable: false,
      },
    });
    const reviewDiffDenied = await facade.version.getReviewDiff({ reviewId: 'review-1' });
    assert.equal(reviewDiffDenied.ok, false);
    if (!reviewDiffDenied.ok) {
      assert.equal(reviewDiffDenied.error.code, 'version_capability_unavailable');
      if (reviewDiffDenied.error.code === 'version_capability_unavailable') {
        assert.equal(reviewDiffDenied.error.capability, 'version:reviewRead');
        assert.deepEqual(reviewDiffDenied.error.diagnostics?.[0]?.data?.deniedCapabilities, [
          'version:reviewRead',
          'version:diff',
        ]);
      }
    }
  } finally {
    await disposeRuntime(runtime);
  }
});

test('runtime attachment detach returns workbook session to headless without disposal', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(runtimeOptions('runtime-attachment-detach-contract'));
    await runtime.ready;

    const workbook = await runtime.openWorkbook({
      workbookId: 'runtime-attachment-workbook',
      source: { kind: 'blank' },
    });
    await workbook.ready;

    const attachmentStates: string[] = [];
    workbook.onAttachmentChange((state) => attachmentStates.push(state.status));

    const controller = (runtime as any)[SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER];
    assert.ok(controller, 'runtime exposes the internal Watermark admission attachment controller');

    const attachment = await controller.attach({
      attachmentId: 'attachment-a',
      workbook,
      props: {},
    });
    assert.deepEqual(workbook.getAttachmentState(), {
      status: 'attached',
      workbookId: workbook.workbookId,
      epoch: workbook.epoch,
      attachmentId: 'attachment-a',
    });

    const runtimeEvents: string[] = [];
    const unsubscribeRuntime = runtime.onEvent((event) => runtimeEvents.push(event.type));
    const bridge = createFakeBridge(workbook.workbookId);
    const unregisterBridge = attachment.registerAppBridge(bridge);
    bridge.emitSelection();
    bridge.emitActiveSheet();
    assert.ok(runtimeEvents.includes('selection-change'));
    assert.ok(runtimeEvents.includes('active-sheet-change'));

    unregisterBridge();
    unsubscribeRuntime();
    await attachment.detach();

    assert.deepEqual(workbook.getAttachmentState(), {
      status: 'headless',
      workbookId: workbook.workbookId,
      epoch: workbook.epoch,
    });
    assert.equal(workbook.getStatus(), 'ready');
    await workbook.getWorkbook().activeSheet.setCell('A1', 'still-live-headless');
    assert.equal(
      (await workbook.getWorkbook().activeSheet.getCell('A1')).value,
      'still-live-headless',
    );
    assert.deepEqual(attachmentStates, ['attaching', 'attached', 'detaching', 'headless']);
  } finally {
    await disposeRuntime(runtime);
  }
});

test('runtime rejects concurrent full-app attachments for the same workbook session', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(runtimeOptions('runtime-double-attach-contract'));
    await runtime.ready;

    const workbook = await runtime.openWorkbook({
      workbookId: 'runtime-double-attach-workbook',
      source: { kind: 'blank' },
    });
    await workbook.ready;

    const controller = (runtime as any)[SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER];
    const first = await controller.attach({ attachmentId: 'attachment-a', workbook, props: {} });
    await assert.rejects(
      () => controller.attach({ attachmentId: 'attachment-b', workbook, props: {} }),
      /already has a full-app UI attachment/i,
    );
    await first.detach();
    const second = await controller.attach({ attachmentId: 'attachment-b', workbook, props: {} });
    await second.detach();
  } finally {
    await disposeRuntime(runtime);
  }
});

function createFakeBridge(documentId: string): RegisteredSpreadsheetAppBridge & {
  emitSelection(): void;
  emitActiveSheet(): void;
} {
  const selectionListeners = new Set<
    (snapshot: ReturnType<RegisteredSpreadsheetAppBridge['getSelection']>) => void
  >();
  const activeSheetListeners = new Set<
    (snapshot: ReturnType<RegisteredSpreadsheetAppBridge['getActiveSheet']>) => void
  >();
  const selection = {
    activeSheetId: 'sheet-1',
    selectedRanges: ['A1'],
    activeCell: { sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' },
  };
  const activeSheet = { sheetId: 'sheet-1', sheetName: 'Sheet1' };

  return {
    documentId,
    getSelection: () => selection,
    getActiveSheet: () => activeSheet,
    setActiveSheet: async () => {},
    select: async () => {},
    scrollTo: async () => {},
    startEdit: async () => {},
    commitEdit: async () => {},
    cancelEdit: async () => {},
    onSelectionChange: (handler) => {
      selectionListeners.add(handler);
      return () => selectionListeners.delete(handler);
    },
    onActiveSheetChange: (handler) => {
      activeSheetListeners.add(handler);
      return () => activeSheetListeners.delete(handler);
    },
    emitSelection: () => {
      for (const listener of selectionListeners) listener(selection);
    },
    emitActiveSheet: () => {
      for (const listener of activeSheetListeners) listener(activeSheet);
    },
  };
}
