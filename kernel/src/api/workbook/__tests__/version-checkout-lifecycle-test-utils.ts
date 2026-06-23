import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionObjectType } from '../../../document/version-store/object-digest';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
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
  documentId: 'checkout-lifecycle-doc',
  principalScope: 'principal-1',
};

export const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

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

export async function authorVc06State(wb: Workbook): Promise<void> {
  const sheet = wb.activeSheet;
  await sheet.setCell('A1', 'Region');
  await sheet.setCell('B1', 'Revenue');
  await sheet.setCell('C1', 'Commentary');
  await sheet.setCell('A2', 'West');
  await sheet.setCell('B2', 12);
  await sheet.setCell('C2', 'Needs review');
  await sheet.setCell('A3', 'East');
  await sheet.setCell('B3', 30);
  await sheet.setCell('C3', 'Accepted');
  await sheet.setCell('D1', 7);
  await sheet.setCell('D2', '=D1*6');
  await sheet.setCell('E1', 'Status');
  await sheet.setCell('E2', 'Open');
  await wb.names.add('RevenueCells', 'Sheet1!B2:B3', 'VC-06 named range');
  await sheet.tables.add('A1:B3', {
    name: 'SalesTable',
    hasHeaders: true,
  });
  await sheet.comments.addNote('C2', { text: 'Revenue note', author: 'Analyst' });
  await sheet.comments.add('C3', { text: 'Investigate east result', author: 'Reviewer' });
  await sheet.validations.setList('E2:E3', ['Open', 'Closed'], {
    allowBlank: false,
    showDropdown: true,
    showErrorAlert: true,
    errorStyle: 'stop',
    errorTitle: 'Invalid status',
    errorMessage: 'Pick a status from the list.',
  });
  await sheet.conditionalFormats.addFormula('B2:B3', '=B2>20', {
    backgroundColor: '#fff2cc',
    fontColor: '#9c6500',
    bold: true,
  });
  await sheet.filters.add('A1:B3');
  const filter = (await sheet.filters.list()).find((entry) => entry.filterKind === 'autoFilter');
  const revenueHeader = (await sheet.filters.listHeaderInfo()).find(
    (entry) =>
      entry.filterId === filter?.id && entry.sourceType === 'sheetAutoFilter' && entry.col === 1,
  );
  if (!filter || !revenueHeader) {
    throw new Error('expected auto-filter metadata to be readable before commit');
  }
  await sheet.filters.setSortState(filter.id, {
    column: revenueHeader.headerCellId,
    direction: 'desc',
  });
  await sheet.charts.add({
    type: 'column',
    name: 'RevenueChart',
    title: 'Revenue by Region',
    dataRange: 'A1:B3',
    anchorRow: 4,
    anchorCol: 0,
    width: 360,
    height: 240,
  });
  await sheet.shapes.add({
    type: 'rect',
    name: 'RevenueCallout',
    anchorRow: 4,
    anchorCol: 3,
    width: 160,
    height: 60,
    fill: { type: 'solid', color: '#d9ead3' },
    text: {
      runs: [{ text: 'Tracked in VC-06' }],
    },
  });
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

export function createCellEditNormalCommitCapture(input: {
  readonly address: 'A1' | 'B1';
  readonly value: string;
  readonly label: string;
  readonly onCapture?: () => void;
}): VersionNormalCommitCapture {
  return async ({ namespace, currentRef }) => {
    input.onCapture?.();
    const semanticChange = {
      structural: {
        kind: 'metadata',
        changeId: `${input.address.toLowerCase()}-${input.value}`,
        domain: 'cell',
        entityId: `Sheet1!${input.address}`,
        propertyPath: ['value'],
      },
      before: { kind: 'value', value: null },
      after: { kind: 'value', value: input.value },
      display: { address: { kind: 'value', value: input.address } },
    };
    return {
      status: 'success',
      input: {
        semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
          schemaVersion: 1,
          label: input.label,
          changes: [semanticChange],
          reviewChanges: [semanticChange],
        }),
        mutationSegmentRecords: [
          await objectRecord(namespace, 'workbook.mutationSegment.v1', {
            segmentId: `${input.address.toLowerCase()}-${input.value}`,
            baseCommitId: currentRef.commitId,
            operations: [
              {
                operation: 'worksheet.setCell',
                sheet: 'Sheet1',
                address: input.address,
                value: input.value,
              },
            ],
          }),
        ],
        author: VERSION_AUTHOR,
        createdAt: CREATED_AT,
        completenessDiagnostics: [],
      },
    };
  };
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
