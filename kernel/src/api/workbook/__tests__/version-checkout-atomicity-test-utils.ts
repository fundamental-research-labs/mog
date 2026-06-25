import { expect } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { DocumentHandleInternal } from '../../document/document-handle-types';
import type { DocumentContext } from '../../../context';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-atomicity-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

type ActiveDocumentState = {
  readonly sheetNames: readonly string[];
  readonly activeSheetName: string;
  readonly sheet1A1: unknown;
  readonly sheet1B1: unknown;
  readonly hasLocalOnly: boolean;
  readonly localOnlyC1: unknown;
  readonly hasTargetOnly: boolean;
  readonly dirtyStatusRevision: string;
};

export async function readActiveDocumentState(wb: Workbook): Promise<ActiveDocumentState> {
  const sheetNames = [...wb.sheetNames];
  const sheet1 = await wb.getSheet('Sheet1');
  const [sheet1A1, sheet1B1] = await Promise.all([sheet1.getCell('A1'), sheet1.getCell('B1')]);
  const hasLocalOnly = sheetNames.includes('LocalOnly');
  const localOnlyC1 = hasLocalOnly
    ? (await (await wb.getSheet('LocalOnly')).getCell('C1')).value
    : null;
  const surface = await wb.version.getSurfaceStatus();

  return {
    sheetNames,
    activeSheetName: wb.activeSheet.name,
    sheet1A1: sheet1A1.value,
    sheet1B1: sheet1B1.value,
    hasLocalOnly,
    localOnlyC1,
    hasTargetOnly: sheetNames.includes('TargetOnly'),
    dirtyStatusRevision: surface.dirty.statusRevision,
  };
}

export async function expectActiveDocumentState(
  wb: Workbook,
  expected: ActiveDocumentState,
): Promise<void> {
  const actual = await readActiveDocumentState(wb);
  expect(documentContentState(actual)).toEqual(documentContentState(expected));
  expect(actual.dirtyStatusRevision).toEqual(expect.stringContaining('dirty:no'));
  expect(actual.dirtyStatusRevision).toEqual(expect.stringContaining('checkout:idle'));
}

function documentContentState(
  state: ActiveDocumentState,
): Omit<ActiveDocumentState, 'dirtyStatusRevision'> {
  const { dirtyStatusRevision: _dirtyStatusRevision, ...contentState } = state;
  return contentState;
}

export function versioningRuntimeForHandle(
  handle: Awaited<ReturnType<typeof DocumentFactory.create>>,
) {
  const context = (handle as DocumentHandleInternal).context as DocumentContext & {
    versioning?: unknown;
  };
  if (!isMutableRecord(context.versioning)) {
    throw new Error('expected attached versioning runtime');
  }
  return context.versioning;
}

function isMutableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export async function initializeVersionGraph(): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
