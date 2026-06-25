import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLIC_VERSION_DOMAIN_DEFAULT_MANIFEST_MATRIX_ROW_IDS } from '@mog-sdk/contracts/versioning';
import type { DocumentHandle, DocumentHandleWorkbookConfig } from '@mog-sdk/kernel';

import { mergeFeatureGates } from '../feature-gates';
import { createSpreadsheetRuntime } from '../runtime';
import { WORKBOOK_FACADE_CAPABILITY_MATRIX } from '../workbook-facade-capability-matrix';
import type {
  SpreadsheetCapability,
  SpreadsheetRuntime,
  SpreadsheetRuntimeOptions,
  SpreadsheetSaveRequest,
  SpreadsheetSaveResult,
} from '../public-types';
import { SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER } from '../attachment-runtime';
import {
  attachRuntimeDefaultVersioning,
  decorateRuntimeOwnedHandleWithDefaultVersioning,
  type RegisteredSpreadsheetAppBridge,
} from '../runtime-types';
import { loadDocumentForSource } from '../shell-documents';

type WorkbookConfig = DocumentHandleWorkbookConfig;

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

test('runtime attachment default versioning decorates document handle workbook creation', async () => {
  const capturedConfigs: WorkbookConfig[] = [];
  const handle = {
    documentId: 'runtime-default-versioning-doc',
    workbook: async (config?: WorkbookConfig) => {
      capturedConfigs.push(config ?? {});
      return {};
    },
  } as DocumentHandle;

  decorateRuntimeOwnedHandleWithDefaultVersioning(handle);
  await handle.workbook({ name: 'Runtime default versioning' });

  const config = capturedConfigs[0];
  assert.equal(config.versioning?.providerSelection?.kind, 'indexeddb');
  assert.equal(config.versioning?.providerSelection?.requireDurablePersistence, true);
  assert.equal(config.versioning?.domainSupportManifest?.workbookId, handle.documentId);
  assert.deepEqual(
    config.versioning?.domainSupportManifest?.domains.map((domain) => domain.matrixRowId),
    [...PUBLIC_VERSION_DOMAIN_DEFAULT_MANIFEST_MATRIX_ROW_IDS],
  );
});

test('runtime attachment default versioning opens provider read-only when document handle is read-only', async () => {
  const capturedConfigs: WorkbookConfig[] = [];
  let readOnly = false;
  const handle = {
    documentId: 'runtime-default-versioning-readonly-doc',
    get isReadOnly() {
      return readOnly;
    },
    workbook: async (config?: WorkbookConfig) => {
      capturedConfigs.push(config ?? {});
      return {};
    },
  } as DocumentHandle;

  decorateRuntimeOwnedHandleWithDefaultVersioning(handle);
  readOnly = true;
  await handle.workbook({ name: 'Runtime default versioning read-only' });

  assert.equal(capturedConfigs[0].versioning?.providerSelection?.kind, 'indexeddb');
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.requireDurablePersistence, true);
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.readOnly, true);
});

test('runtime attachment default versioning defers import root initialization while import durability is pending', async () => {
  const capturedConfigs: WorkbookConfig[] = [];
  const handle = {
    documentId: 'runtime-default-versioning-import-doc',
    isImportDurabilityPending: true,
    workbook: async (config?: WorkbookConfig) => {
      capturedConfigs.push(config ?? {});
      return {};
    },
  } as DocumentHandle;

  decorateRuntimeOwnedHandleWithDefaultVersioning(handle);
  await handle.workbook({ name: 'Runtime default versioning imported workbook' });

  assert.equal(capturedConfigs[0].versioning?.providerSelection?.kind, 'indexeddb');
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.requireDurablePersistence, true);
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.initializeTiming, 'deferred');
});

test('runtime attachment default versioning preserves caller versioning overrides', async () => {
  const capturedConfigs: WorkbookConfig[] = [];
  const handle = {
    documentId: 'runtime-default-versioning-overrides-doc',
    workbook: async (config?: WorkbookConfig) => {
      capturedConfigs.push(config ?? {});
      return {};
    },
  } as DocumentHandle;
  const providerSelection = {
    kind: 'memory',
    requireDurablePersistence: false,
  } as const satisfies NonNullable<NonNullable<WorkbookConfig['versioning']>['providerSelection']>;

  decorateRuntimeOwnedHandleWithDefaultVersioning(handle);
  decorateRuntimeOwnedHandleWithDefaultVersioning(handle);
  await handle.workbook({
    versioning: {
      providerSelection,
      requireDomainSupportManifest: true,
    },
  });

  assert.equal(capturedConfigs.length, 1);
  assert.equal(capturedConfigs[0].versioning?.providerSelection, providerSelection);
  assert.equal(capturedConfigs[0].versioning?.requireDomainSupportManifest, true);
  assert.equal(
    capturedConfigs[0].versioning?.domainSupportManifest?.workbookId,
    'runtime-default-versioning-overrides-doc',
  );
});

test('spreadsheet app shell document loading propagates read-only handles to default versioning', async () => {
  const capturedConfigs: WorkbookConfig[] = [];
  let readOnly = false;
  const handle = {
    documentId: 'runtime-shell-default-versioning-readonly-doc',
    eventBus: {
      onAll() {
        return undefined;
      },
    },
    registerChartImageExporter() {
      // Test handle only records that the runtime installs the exporter.
    },
    dispose() {
      return undefined;
    },
    get isReadOnly() {
      return readOnly;
    },
    workbook: async (config?: WorkbookConfig) => {
      capturedConfigs.push(config ?? {});
      return {};
    },
  };
  const shell = {
    documentManager: {
      async createDocument() {
        return handle;
      },
    },
  } as never;

  const loaded = await loadDocumentForSource(
    shell,
    'runtime-shell-default-versioning-readonly-doc',
    { kind: 'blank' },
  );

  readOnly = true;
  await loaded.handle.workbook();

  assert.equal(capturedConfigs[0].versioning?.providerSelection?.kind, 'indexeddb');
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.requireDurablePersistence, true);
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.readOnly, true);
});

test('spreadsheet app shell document loading defers default versioning for imported handles', async () => {
  const capturedConfigs: WorkbookConfig[] = [];
  const handle = {
    documentId: 'runtime-shell-default-versioning-import-doc',
    eventBus: {
      onAll() {
        return undefined;
      },
    },
    registerChartImageExporter() {
      // Test handle only records that the runtime installs the exporter.
    },
    dispose() {
      return undefined;
    },
    isImportDurabilityPending: true,
    workbook: async (config?: WorkbookConfig) => {
      capturedConfigs.push(config ?? {});
      return {};
    },
  };
  const shell = {
    documentManager: {
      async loadDocument() {
        return handle;
      },
    },
  } as never;

  const loaded = await loadDocumentForSource(shell, 'runtime-shell-default-versioning-import-doc', {
    kind: 'xlsx-bytes',
    bytes: new Uint8Array([1, 2, 3]),
  });

  await loaded.handle.workbook();

  assert.equal(capturedConfigs[0].versioning?.providerSelection?.kind, 'indexeddb');
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.requireDurablePersistence, true);
  assert.equal(capturedConfigs[0].versioning?.providerSelection?.initializeTiming, 'deferred');
});

test('runtime version feature gates fail closed until default versioning is attached', () => {
  const unavailable = mergeFeatureGates(undefined, undefined, undefined, undefined, {
    versionControl: false,
  });
  assert.equal(unavailable.capabilities?.versionControl, false);
  assert.equal(unavailable.capabilities?.versionControlMerge, false);
  assert.equal(unavailable.capabilities?.['versionControl.merge'], false);

  const available = mergeFeatureGates(undefined, undefined, undefined, undefined, {
    versionControl: true,
  });
  assert.equal(available.capabilities?.versionControl, undefined);

  const hostDisabled = mergeFeatureGates(
    { capabilities: { versionControl: false } },
    undefined,
    undefined,
    undefined,
    { versionControl: true },
  );
  assert.equal(hostDisabled.capabilities?.versionControl, false);
});

test('runtime default versioning attachment honors skipped document readiness', () => {
  const result = attachRuntimeDefaultVersioning({
    documentId: 'runtime-default-versioning-skipped-doc',
    shell: {
      documentManager: {
        getDocument() {
          throw new Error('skip must not read document handle');
        },
      },
    } as never,
    documentVersioning: { status: 'skipped' },
  });

  assert.deepEqual(result, {
    status: 'unavailable',
    documentId: 'runtime-default-versioning-skipped-doc',
    reason: 'document-versioning-skipped',
  });
});

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
    const versionMatrix = WORKBOOK_FACADE_CAPABILITY_MATRIX.WorkbookVersion;
    const assertVersionCapabilityEntry = (
      methodName: keyof typeof versionMatrix,
      expected: readonly SpreadsheetCapability[],
    ) => {
      const entry = versionMatrix[methodName] as {
        readonly capability?: SpreadsheetCapability;
        readonly capabilities?: readonly SpreadsheetCapability[];
      };
      assert.equal(entry.capability, undefined);
      assert.deepEqual(entry.capabilities, expected);
    };

    assert.deepEqual(versionMatrix.getSurfaceStatus.capabilities, []);
    assert.equal(versionMatrix.getSurfaceStatus.capability, undefined);
    assertVersionCapabilityEntry('getStatus', ['version:read']);
    assertVersionCapabilityEntry('getReview', ['version:reviewRead']);
    assertVersionCapabilityEntry('createReview', ['version:reviewWrite']);
    assertVersionCapabilityEntry('getReviewDiff', ['version:diff']);
    assert.deepEqual(versionMatrix.getReviewDiff.conditionalCapabilities, [
      {
        when: {
          argumentIndex: 0,
          path: ['reviewId'],
          presence: 'present',
        },
        capabilities: ['version:reviewRead'],
      },
    ]);
    assertVersionCapabilityEntry('createProposal', ['version:proposal']);
    assertVersionCapabilityEntry('acceptProposal', ['version:proposal', 'version:branch']);
    assertVersionCapabilityEntry('revert', ['version:revert']);
    assertVersionCapabilityEntry('promotePendingRemote', [
      'version:remotePromote',
      'version:provenance',
    ]);

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
      'version:remotePromote',
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
    const revertDenied = await facade.version.revert(
      {} as Parameters<typeof facade.version.revert>[0],
    );
    assert.deepEqual(revertDenied, {
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:revert',
        dependency: 'hostCapability',
        reason: 'Capability "version:revert" is denied for WorkbookVersion.revert',
        retryable: false,
      },
    });
    const promoteRemoteDenied = await facade.version.promotePendingRemote();
    assert.equal(promoteRemoteDenied.ok, false);
    if (!promoteRemoteDenied.ok) {
      assert.equal(promoteRemoteDenied.error.code, 'version_capability_unavailable');
      if (promoteRemoteDenied.error.code === 'version_capability_unavailable') {
        assert.equal(promoteRemoteDenied.error.capability, 'version:remotePromote');
        assert.deepEqual(promoteRemoteDenied.error.diagnostics?.[0]?.data?.deniedCapabilities, [
          'version:remotePromote',
          'version:provenance',
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
        assert.equal(reviewDiffDenied.error.capability, 'version:diff');
        assert.deepEqual(reviewDiffDenied.error.diagnostics?.[0]?.data?.deniedCapabilities, [
          'version:diff',
          'version:reviewRead',
        ]);
      }
    }
  } finally {
    await disposeRuntime(runtime);
  }
});

test('version review diff conditionally requires review read only for review-id targets', async () => {
  let runtime: SpreadsheetRuntime | undefined;
  try {
    runtime = await createSpreadsheetRuntime(
      runtimeOptionsWithDeniedCapabilities(
        'runtime-version-review-diff-conditional-capability',
        new Set<SpreadsheetCapability>(['version:reviewRead']),
      ),
    );
    await runtime.ready;

    const workbook = await runtime.openWorkbook({
      workbookId: 'runtime-version-review-diff-conditional-capability-workbook',
      source: { kind: 'blank' },
    });
    await workbook.ready;
    const actor = await workbook.resolveActor({ actorId: 'reader', kind: 'user' });
    const facade = actor.getWorkbook();

    const baseCommitId = `commit:sha256:${'a'.repeat(64)}` as const;
    const headCommitId = `commit:sha256:${'b'.repeat(64)}` as const;
    const commitRangeDiff = await facade.version.getReviewDiff({ baseCommitId, headCommitId });
    if (!commitRangeDiff.ok) {
      assert.notEqual(commitRangeDiff.error.code, 'version_capability_unavailable');
    }

    const reviewDiff = await facade.version.getReviewDiff({ reviewId: 'review-1' });
    assert.equal(reviewDiff.ok, false);
    if (!reviewDiff.ok) {
      assert.equal(reviewDiff.error.code, 'version_capability_unavailable');
      if (reviewDiff.error.code === 'version_capability_unavailable') {
        assert.equal(reviewDiff.error.capability, 'version:reviewRead');
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
