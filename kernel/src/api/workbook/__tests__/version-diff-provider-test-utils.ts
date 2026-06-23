import { jest } from '@jest/globals';

import type { WorkbookConfig } from '../types';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import {
  createInMemoryVersionStoreProvider,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  createSemanticDiffCommitCapture,
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  initializeInput,
} from './version-diff-provider-fixtures';

const createCheckpointManagerMock = jest.fn();
const worksheetImplMock = jest.fn().mockImplementation((sheetId: string) => ({
  _sheetId: sheetId,
  _syncMetadata: jest.fn(),
  dispose: jest.fn(),
}));

jest.unstable_mockModule('../../worksheet/worksheet-impl', () => ({
  WorksheetImpl: worksheetImplMock,
}));

jest.unstable_mockModule('../../../services/checkpoint', () => ({
  createCheckpointManager: createCheckpointManagerMock,
}));

jest.unstable_mockModule('../../namespaces/records', () => ({
  get: jest.fn(),
  query: jest.fn(),
  getFieldValue: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  del: jest.fn(),
}));

jest.unstable_mockModule('../../../bridges/compute/compute-bridge', () => ({
  ComputeBridge: jest.fn(),
  createComputeBridge: jest.fn(),
  createComputeBridgeFromTransport: jest.fn(),
  extractMutationData: jest.fn(),
  identityFormulaToWire: jest.fn(),
  rustSchemaResolveEditor: jest.fn(),
  wireTableToTableConfig: jest.fn(),
  wireToIdentityFormula: jest.fn(),
  __esModule: true,
}));

const { WorkbookImpl } = await import('../workbook-impl');

type InitializedVersionGraph = Extract<VersionGraphInitializeResult, { status: 'success' }>;
type Workbook = ReturnType<typeof createWorkbook>;
type CommitResult = Awaited<ReturnType<Workbook['version']['commit']>>;
type SuccessfulCommit = Extract<CommitResult, { ok: true }>['value'];
type DiffOptions = Parameters<Workbook['version']['diff']>[2];

export interface CommittedDiffWorkbook {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly initialized: InitializedVersionGraph;
  readonly wb: Workbook;
  readonly committed: SuccessfulCommit;
}

export function createDiffProvider() {
  return createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
}

export function createWorkbook(overrides?: Partial<WorkbookConfig>) {
  createCheckpointManagerMock.mockReturnValue({
    create: jest.fn(),
    createSync: jest.fn(),
    restore: jest.fn(),
    list: jest.fn().mockReturnValue([]),
    get: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  });

  const versioning = overrides?.versioning as Record<string, unknown> | undefined;
  return new WorkbookImpl({
    ctx: createMockCtx(),
    eventBus: createMockEventBus(),
    ...overrides,
    ...(versioning ? { versioning: withVersionManifest(versioning) } : {}),
  });
}

export async function createCommittedDiffWorkbook(
  input: {
    readonly graphId?: string;
    readonly rootLabel?: string;
    readonly commitLabel?: string;
    readonly changes?: readonly unknown[];
    readonly completenessDiagnostics?: readonly WorkbookCommitCompletenessDiagnostic[];
    readonly reviewChanges?: readonly unknown[];
    readonly captureNormalCommit?: VersionNormalCommitCapture;
  } = {},
): Promise<CommittedDiffWorkbook> {
  const provider = createDiffProvider();
  const initialized = await provider.initializeGraph(
    await initializeInput(input.graphId ?? 'graph-1', input.rootLabel ?? 'root'),
  );
  expectInitializeSuccess(initialized);

  const commitLabel = input.commitLabel ?? 'child';
  const captureNormalCommit =
    input.captureNormalCommit ??
    jest.fn(
      createSemanticDiffCommitCapture(
        commitLabel,
        input.changes,
        input.completenessDiagnostics,
        input.reviewChanges === undefined ? {} : { reviewChanges: input.reviewChanges },
      ),
    );
  const wb = createWorkbook({
    versioning: {
      provider,
      captureNormalCommit,
    },
  });

  const commitResult = await wb.version.commit({
    expectedHead: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
      symbolicHeadRevision: initialized.symbolicHead.revision,
    },
  });
  if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);

  return {
    provider,
    initialized,
    wb,
    committed: commitResult.value,
  };
}

export function diffCommitted(context: CommittedDiffWorkbook, options?: DiffOptions) {
  return context.wb.version.diff(context.initialized.rootCommit.id, context.committed.id, options);
}

function createMockEventBus() {
  return {
    on: jest.fn().mockReturnValue(() => undefined),
    onAll: jest.fn().mockReturnValue(() => undefined),
    onMany: jest.fn(),
    emit: jest.fn(),
    emitBatch: jest.fn(),
    clear: jest.fn(),
  };
}

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {
      getAllSheetIds: jest.fn(async () => []),
      getAllTablesInSheet: jest.fn(async () => []),
      getFiltersInSheet: jest.fn(async () => []),
      namedRangeCount: jest.fn(async () => 0),
      getAllNamedRangesWire: jest.fn(async () => []),
      getHyperlinks: jest.fn(async () => []),
      getRangeSchemasForSheet: jest.fn(async () => []),
    },
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
