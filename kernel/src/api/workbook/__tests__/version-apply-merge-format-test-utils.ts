import type {
  VersionHead,
  VersionMergeChange,
  VersionMergeResult,
  VersionSemanticValue,
  Workbook,
  WorkbookCommitId,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
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

export {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';

const DOCUMENT_ID = 'vc07-apply-merge-format';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function createFormatDocumentHandle() {
  return DocumentFactory.create({
    documentId: DOCUMENT_ID,
    environment: 'headless',
    userTimezone: 'UTC',
  });
}

export function createFormatVersionStoreProvider() {
  return createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
}

export async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) {
    throw new Error(
      `expected commit success: ${result.error.code} ${JSON.stringify(result.error.diagnostics)}`,
    );
  }
  return result.value;
}

export async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

export function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

export async function initializeInput(
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
      author: AUTHOR,
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

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}

export function cleanMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  changes: readonly VersionMergeChange[],
): VersionMergeResult {
  return {
    status: 'clean',
    base,
    ours,
    theirs,
    changes,
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

export function formulaChange(
  changeId: string,
  sheetId: string,
  address: string,
  formula: string,
): VersionMergeChange {
  const value: VersionSemanticValue = { kind: 'formula', formula };
  return {
    structural: metadata(changeId, `${sheetId}!${address}`, 'cells.formulas', ['formula']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
    display: { address: { kind: 'value', value: address } },
  };
}

export function rowColumnChange(
  changeId: string,
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
  action: 'insert' | 'delete',
): VersionMergeChange {
  const value = rowColumnValue(sheetId, axis, index);
  const present = { kind: 'value' as const, value };
  const absent = { kind: 'value' as const, value: null };
  return {
    structural: metadata(changeId, `${sheetId}!${axis}:${index}`, 'rows-columns', ['order']),
    base: action === 'insert' ? absent : present,
    theirs: action === 'insert' ? present : absent,
    merged: action === 'insert' ? present : absent,
    display: { address: { kind: 'value', value: displayRef(axis, index) } },
  };
}

function rowColumnValue(
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
): VersionSemanticValue {
  return {
    kind: 'object',
    fields: [
      { key: 'axis', value: axis },
      { key: 'sheetId', value: sheetId },
      { key: 'index', value: index },
      { key: 'displayRef', value: displayRef(axis, index) },
    ],
  };
}

function displayRef(axis: 'row' | 'column', index: number): string {
  if (axis === 'row') {
    const label = String(index + 1);
    return `${label}:${label}`;
  }
  const label = columnLabel(index);
  return `${label}:${label}`;
}

function columnLabel(index: number): string {
  let remaining = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
) {
  return {
    kind: 'metadata' as const,
    changeId,
    domain,
    entityId,
    propertyPath,
  };
}
