import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import type {
  VersionDocumentScope,
  VersionGraphInitializeInput,
  VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

export async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = {
    workspaceId: DOCUMENT_SCOPE.workspaceId,
    documentId: DOCUMENT_SCOPE.documentId,
    graphId,
    principalScope: DOCUMENT_SCOPE.principalScope,
  };
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

export function createSemanticDiffCommitCapture(
  label: string,
  changes: readonly unknown[] = defaultSemanticChanges(label),
  completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[] = [],
  options: {
    readonly reviewChanges?: readonly unknown[];
  } = {},
): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        label,
        changes,
        ...(options.reviewChanges === undefined ? {} : { reviewChanges: options.reviewChanges }),
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentMain.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics,
    },
  });
}

export function defaultSemanticChanges(label: string) {
  return [
    {
      changeId: `${label}-change-1`,
      domain: 'cell',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
      before: { kind: 'value', value: 1 },
      after: { kind: 'value', value: 2 },
      display: {
        sheetName: { kind: 'value', value: 'Sheet1' },
        address: { kind: 'value', value: 'A1' },
      },
    },
  ];
}

export function tableFilterReviewSafeChanges() {
  return [
    semanticRecord({
      changeId: 'review-safe-table-definition',
      domain: 'tables',
      entityId: 'sheet-1!table:table-review-safe-sales',
      propertyPath: ['definition'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-review-safe-sales' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
    semanticRecord({
      changeId: 'review-safe-filter-state',
      domain: 'filters',
      entityId: 'sheet-1!filter:filter-review-safe-sales',
      propertyPath: ['state'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'filter-review-safe-sales' },
        { key: 'hasActiveFilter', value: false },
        { key: 'visibleRowCount', value: 20 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'filter-review-safe-sales' },
        { key: 'filterKind', value: 'autoFilter' },
        { key: 'hasActiveFilter', value: true },
        { key: 'hiddenRowCount', value: 7 },
        { key: 'visibleRowCount', value: 13 },
        {
          key: 'unsupportedReasons',
          value: { kind: 'array', values: ['criteria-values-redacted'] },
        },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
  ];
}

export function omittedMacroChange() {
  return semanticRecord({
    changeId: 'omitted-unsupported-macro',
    domain: 'macros.vba',
    entityId: 'module:principal-secret',
    propertyPath: ['source'],
    before: null,
    after: 'macro-source-secret',
    display: entityLabelDisplay('principal-secret Macro'),
  });
}

export function unsupportedNamedRangeRawFieldChange(rawSecret: string) {
  return semanticRecord({
    changeId: 'vc06-unsupported-named-range-raw-field',
    domain: 'named-ranges',
    entityId: 'name:RevenueTotal',
    propertyPath: ['definition'],
    before: null,
    after: semanticObject([
      { key: 'kind', value: 'Set' },
      { key: 'name', value: 'RevenueTotal' },
      { key: 'secretFormula', value: rawSecret },
    ]),
    display: entityLabelDisplay('RevenueTotal'),
  });
}

export function semanticRecord(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  readonly display: unknown;
}) {
  return {
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: [...input.propertyPath],
    },
    before: { kind: 'value', value: input.before },
    after: { kind: 'value', value: input.after },
    display: input.display,
  };
}

export function semanticObject(fields: readonly { readonly key: string; readonly value: unknown }[]) {
  return {
    kind: 'object',
    fields: fields.map((field) => ({ key: field.key, value: field.value })),
  };
}

export function entityLabelDisplay(value: string) {
  return {
    entityLabel: { kind: 'value', value },
  };
}

export function redactedEntityLabelDisplay() {
  return {
    entityLabel: { kind: 'redacted', reason: 'redaction-policy' },
  };
}

export function addressDisplay(value: string) {
  return {
    address: { kind: 'value', value },
  };
}

export function sheetAddressDisplay(sheetName: string, address: string) {
  return {
    sheetName: { kind: 'value', value: sheetName },
    address: { kind: 'value', value: address },
  };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
