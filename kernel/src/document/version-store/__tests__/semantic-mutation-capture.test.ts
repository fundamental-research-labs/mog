import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { MutationResult, RangeChange } from '../../../bridges/compute/compute-types.gen';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';
import type { VersionGraphNamespace } from '../object-store';
import type { WorkbookCommitId } from '../object-digest';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

describe('semantic mutation capture', () => {
  it('captures only direct cell edits and drains after successful commit finalization', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldFormula: '=1',
              newFormula: '=1+1',
              oldValue: 1,
              value: 2,
              extraFlags: 0,
            },
            {
              cellId: 'cell-b1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 1 },
              oldValue: 10,
              value: 20,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });

    const first = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(first.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: { kind: 'formula', formula: '=1', result: 1 } },
          after: { kind: 'value', value: { kind: 'formula', formula: '=1+1', result: 2 } },
          display: { address: { kind: 'value', value: 'A1' } },
        },
      ],
    });
    expect(first.input.mutationSegmentRecords).toHaveLength(1);
    expect(first.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      schemaVersion: 1,
      segmentId: 'mutation-1',
      operation: 'compute_batch_set_cells_by_position',
      changeIds: ['mutation-1:cell:0'],
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' }],
    });

    const retryBeforeFinalize = expectCaptureSuccess(
      await capture.captureNormalCommit(captureInput()),
    );
    expect(retryBeforeFinalize.input.mutationSegmentRecords).toHaveLength(1);

    first.finalize?.({ status: 'failed' });
    const retryAfterFailure = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(retryAfterFailure.input.mutationSegmentRecords).toHaveLength(1);

    first.finalize?.({ status: 'success', commitId: COMMIT_ID });
    const afterSuccess = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(afterSuccess.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [],
    });
    expect(afterSuccess.input.mutationSegmentRecords).toEqual([]);
  });

  it('captures local sheet renames and skips observer renames without old names', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'name',
            oldName: 'Sheet1',
            name: 'Forecast',
          },
          {
            sheetId: 'sheet-2',
            kind: 'Set',
            field: 'name',
            name: 'RemoteOnly',
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['name'],
          },
          before: { kind: 'value', value: 'Sheet1' },
          after: { kind: 'value', value: 'Forecast' },
          display: { entityLabel: { kind: 'value', value: 'Forecast' } },
        },
      ],
    });
  });

  it('captures direct sheet tab color changes and skips empty tab color records', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_tab_color',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'tabColor',
            oldColor: '#FF0000',
            color: '#00FF00',
          },
          {
            sheetId: 'sheet-2',
            kind: 'Set',
            field: 'tabColor',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_tab_color',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'tabColor',
            oldColor: '#00FF00',
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['tabColor'],
          },
          before: { kind: 'value', value: '#FF0000' },
          after: { kind: 'value', value: '#00FF00' },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['tabColor'],
          },
          before: { kind: 'value', value: '#00FF00' },
          after: { kind: 'value', value: null },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
      expect.objectContaining({
        segmentId: 'mutation-1',
        operation: 'compute_set_tab_color',
        changeIds: ['mutation-1:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-2',
        operation: 'compute_set_tab_color',
        changeIds: ['mutation-2:sheet:0'],
      }),
    ]);
  });

  it('captures sheet create, remove, copy, and move structural changes', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_create_sheet_with_default_col_width',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'sheet',
            name: 'Forecast',
            index: 1,
          },
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'name',
            name: 'Forecast',
          },
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'order',
            index: 1,
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_delete_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-deleted',
            kind: 'Removed',
            field: 'sheet',
            name: 'Scratch',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_copy_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-copy',
            kind: 'Set',
            field: 'sheet',
            name: 'Forecast Copy',
            index: 2,
            sourceSheetId: 'sheet-created',
          },
          {
            sheetId: 'sheet-copy',
            kind: 'Set',
            field: 'order',
            index: 2,
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_move_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'order',
            oldIndex: 1,
            index: 0,
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-created',
            propertyPath: ['sheet'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'name', value: 'Forecast' },
                { key: 'index', value: 1 },
              ],
            },
          },
          display: { entityLabel: { kind: 'value', value: 'Forecast' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-deleted',
            propertyPath: ['sheet'],
          },
          before: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [{ key: 'name', value: 'Scratch' }],
            },
          },
          after: { kind: 'value', value: null },
          display: { entityLabel: { kind: 'value', value: 'Scratch' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-3:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-copy',
            propertyPath: ['sheet'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'name', value: 'Forecast Copy' },
                { key: 'index', value: 2 },
                { key: 'sourceSheetId', value: 'sheet-created' },
              ],
            },
          },
          display: { entityLabel: { kind: 'value', value: 'Forecast Copy' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-4:sheet:0',
            domain: 'sheet',
            entityId: 'sheet-created',
            propertyPath: ['order'],
          },
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: 0 },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
      expect.objectContaining({
        segmentId: 'mutation-1',
        operation: 'compute_create_sheet_with_default_col_width',
        changeIds: ['mutation-1:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-2',
        operation: 'compute_delete_sheet',
        changeIds: ['mutation-2:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-3',
        operation: 'compute_copy_sheet',
        changeIds: ['mutation-3:sheet:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-4',
        operation: 'compute_move_sheet',
        changeIds: ['mutation-4:sheet:0'],
      }),
    ]);
  });

  it('skips sheet structural records without stable identity or before/after evidence', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_create_sheet_with_default_col_width',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-index',
            kind: 'Set',
            field: 'sheet',
            name: 'No Index',
          },
          {
            sheetId: 'sheet-ambiguous-copy',
            kind: 'Set',
            field: 'sheet',
            name: 'Ambiguous',
            index: 1,
            sourceSheetId: 'source-sheet',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_delete_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-name',
            kind: 'Removed',
            field: 'sheet',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_copy_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-source',
            kind: 'Set',
            field: 'sheet',
            name: 'Missing Source',
            index: 2,
          },
          {
            sheetId: 'sheet-empty-source',
            kind: 'Set',
            field: 'sheet',
            name: 'Empty Source',
            index: 3,
            sourceSheetId: '',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_move_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-missing-old-index',
            kind: 'Set',
            field: 'order',
            index: 0,
          },
          {
            sheetId: 'sheet-not-found-before',
            kind: 'Set',
            field: 'order',
            oldIndex: -1,
            index: 0,
          },
          {
            sheetId: '',
            kind: 'Set',
            field: 'order',
            oldIndex: 0,
            index: 1,
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [],
    });
    expect(captured.input.mutationSegmentRecords).toEqual([]);
  });

  it('captures direct date and time value writes', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_date_value',
      directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-c2',
              sheetId: 'sheet-1',
              position: { row: 1, col: 2 },
              oldValue: null,
              value: 45291,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_time_value',
      directEdits: [{ sheetId: 'sheet-1', row: 2, col: 3 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-d3',
              sheetId: 'sheet-1',
              position: { row: 2, col: 3 },
              oldValue: null,
              value: 0.5,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!C2',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 45291 },
          display: { address: { kind: 'value', value: 'C2' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!D3',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 0.5 },
          display: { address: { kind: 'value', value: 'D3' } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
      expect.objectContaining({
        segmentId: 'mutation-1',
        operation: 'compute_set_date_value',
        directEdits: [{ sheetId: 'sheet-1', row: 1, col: 2, address: 'C2' }],
      }),
      expect.objectContaining({
        segmentId: 'mutation-2',
        operation: 'compute_set_time_value',
        directEdits: [{ sheetId: 'sheet-1', row: 2, col: 3, address: 'D3' }],
      }),
    ]);
  });

  it('captures filter and sort mutation receipts as semantic records', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_auto_filter_column',
      result: mutationResult({
        filterChanges: [
          {
            sheetId: 'sheet-1',
            filterId: 'auto-filter-1',
            filterKind: 'autoFilter',
            capability: 'supported',
            hasActiveFilter: true,
            clearable: true,
            action: 'setColumn',
            hiddenRowCount: 3,
            visibleRowCount: 7,
            kind: 'Set',
          },
        ],
      }),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_sort_range',
      result: mutationResult({
        sortingChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            startRow: 0,
            startCol: 0,
            endRow: 9,
            endCol: 2,
            rowsMoved: 6,
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:filter:0',
            domain: 'filters',
            entityId: 'sheet-1!filter:auto-filter-1',
            propertyPath: ['state'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'kind', value: 'Set' },
                { key: 'filterId', value: 'auto-filter-1' },
                { key: 'filterKind', value: 'autoFilter' },
                { key: 'capability', value: 'supported' },
                { key: 'hasActiveFilter', value: true },
                { key: 'clearable', value: true },
                { key: 'action', value: 'setColumn' },
                { key: 'hiddenRowCount', value: 3 },
                { key: 'visibleRowCount', value: 7 },
              ],
            },
          },
          display: { entityLabel: { kind: 'value', value: 'sheet-1!filter:auto-filter-1' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-2:sort:0',
            domain: 'sorts',
            entityId: 'sheet-1!A1:C10',
            propertyPath: ['order'],
          },
          before: { kind: 'value', value: null },
          after: {
            kind: 'value',
            value: {
              kind: 'object',
              fields: [
                { key: 'kind', value: 'Set' },
                { key: 'range', value: 'A1:C10' },
                { key: 'rowsMoved', value: 6 },
              ],
            },
          },
          display: { address: { kind: 'value', value: 'A1:C10' } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.map((record) => record.preimage.payload)).toEqual([
      expect.objectContaining({
        segmentId: 'mutation-1',
        operation: 'compute_set_auto_filter_column',
        changeIds: ['mutation-1:filter:0'],
      }),
      expect.objectContaining({
        segmentId: 'mutation-2',
        operation: 'compute_sort_range',
        changeIds: ['mutation-2:sort:0'],
      }),
    ]);
  });

  it('skips filter and sort receipts without stable identity evidence', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_auto_filter_column',
      result: mutationResult({
        filterChanges: [
          {
            sheetId: '',
            filterId: 'missing-sheet',
            kind: 'Set',
          },
        ],
        sortingChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            startRow: 5,
            startCol: 0,
            endRow: 4,
            endCol: 2,
            rowsMoved: 1,
          },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [],
    });
    expect(captured.input.mutationSegmentRecords).toEqual([]);
  });

  it('captures named range, table, and comment receipts with stable identities', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_vc06_domain_receipts',
      result: mutationResult({
        namedRangeChanges: [
          { name: 'RevenueTotal', kind: 'Set' },
          { name: 'OldName', kind: 'Removed' },
          { name: '3 names imported', kind: 'Set' },
        ],
        tableChanges: [
          { sheetId: 'sheet-1', tableId: 'table-1', name: 'SalesTable', kind: 'Set' },
          { sheetId: 'sheet-1', tableId: 'table-old', name: 'OldTable', kind: 'Removed' },
          { sheetId: '', name: 'StyleOnly', kind: 'Set' },
        ],
        commentChanges: [
          { sheetId: 'sheet-1', cellId: 'cell-a1', position: { row: 0, col: 0 }, kind: 'Set' },
          { sheetId: 'sheet-1', cellId: 'cell-b2', position: { row: 1, col: 1 }, kind: 'Removed' },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(6);
    expect(changes.map((change) => change.structural)).toEqual([
      { kind: 'metadata', changeId: 'mutation-1:named-range:0', domain: 'named-ranges', entityId: 'name:RevenueTotal', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:named-range:1', domain: 'named-ranges', entityId: 'name:OldName', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:table:0', domain: 'tables', entityId: 'sheet-1!table:table-1', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:table:1', domain: 'tables', entityId: 'sheet-1!table:table-old', propertyPath: ['definition'] },
      { kind: 'metadata', changeId: 'mutation-1:comment:0', domain: 'comments-notes', entityId: 'sheet-1!comment:cell-a1', propertyPath: ['cell'] },
      { kind: 'metadata', changeId: 'mutation-1:comment:1', domain: 'comments-notes', entityId: 'sheet-1!comment:cell-b2', propertyPath: ['cell'] },
    ]);
    expect(changes[0].after).toEqual(semanticAfterObject([{ key: 'kind', value: 'Set' }, { key: 'name', value: 'RevenueTotal' }]));
    expect(changes[2].after).toEqual(semanticAfterObject([{ key: 'kind', value: 'Set' }, { key: 'tableId', value: 'table-1' }, { key: 'name', value: 'SalesTable' }, { key: 'sheetId', value: 'sheet-1' }]));
    expect(changes[4]).toMatchObject({ display: { address: { kind: 'value', value: 'A1' } } });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      segmentId: 'mutation-1',
      changeIds: ['mutation-1:named-range:0', 'mutation-1:named-range:1', 'mutation-1:table:0', 'mutation-1:table:1', 'mutation-1:comment:0', 'mutation-1:comment:1'],
    });
  });

  it('captures conditional-format and range metadata receipts conservatively', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_cf_and_range_receipts',
      result: mutationResult({
        cfChanges: [
          { sheetId: 'sheet-1', ruleId: 'cf-rule-1', kind: 'Set' },
          { sheetId: 'sheet-1', ruleId: 'cf-rule-old', kind: 'Removed' },
          { sheetId: 'sheet-1', kind: 'Set' },
        ],
        rangeChanges: [
          encodedRangeChange('sheet-1', 'validation-range', 'Created', 'Validation'),
          encodedRangeChange('sheet-1', 'cf-range', 'Removed', 'CondFormat'),
          encodedRangeChange('sheet-1', 'data-range', 'Created', 'Data'),
          { sheetId: 'sheet-1', rangeId: 'bad-range', kind: 'Created', data: new Uint8Array([1]) },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(4);
    expect(changes.map((change) => change.structural.domain)).toEqual([
      'conditional-formatting',
      'conditional-formatting',
      'data-validation',
      'conditional-formatting',
    ]);
    expect(changes[2]).toMatchObject({
      structural: {
        kind: 'metadata',
        changeId: 'mutation-1:range:0',
        domain: 'data-validation',
        entityId: 'sheet-1!range:validation-range',
        propertyPath: ['range'],
      },
      before: { kind: 'value', value: null },
      after: semanticAfterObject([
        { key: 'kind', value: 'Created' },
        { key: 'rangeKind', value: 'Validation' },
        { key: 'rangeId', value: 'validation-range' },
        { key: 'encoding', value: 'None' },
        { key: 'rowCount', value: 2 },
        { key: 'colCount', value: 2 },
        {
          key: 'anchor',
          value: {
            kind: 'object',
            fields: [
              { key: 'kind', value: 'Elastic' },
              { key: 'startRow', value: 'row-1' },
              { key: 'endRow', value: 'row-2' },
              { key: 'startCol', value: 'col-1' },
              { key: 'endCol', value: 'col-2' },
            ],
          },
        },
      ]),
    });
    expect(changes[3]).toMatchObject({
      structural: expect.objectContaining({
        changeId: 'mutation-1:range:1',
        domain: 'conditional-formatting',
        entityId: 'sheet-1!range:cf-range',
      }),
      after: { kind: 'value', value: null },
    });
  });

  it('captures floating object anchors and chart source range receipts', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_floating_and_chart_receipts',
      result: mutationResult({
        floatingObjectChanges: [
          {
            sheetId: 'sheet-1',
            objectId: 'picture-1',
            objectType: 'picture',
            kind: { type: 'updated', changedFields: ['anchor', 'width'] },
            data: floatingObjectData('picture-1', 'picture', { src: 'image.png' }),
            bounds: { x: 10, y: 20, width: 320, height: 180, rotation: 0 },
          },
          {
            sheetId: 'sheet-1',
            objectId: 'chart-1',
            objectType: 'chart',
            kind: { type: 'created' },
            data: floatingObjectData('chart-1', 'chart', {
              chartType: 'bar',
              dataRange: 'A1:B10',
              seriesRange: 'A1:A10',
              categoryRange: 'B1:B10',
            }),
          },
          { sheetId: '', objectId: 'missing-sheet', kind: { type: 'removed' } },
        ],
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    const changes = capturedChanges(captured);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      structural: expect.objectContaining({
        changeId: 'mutation-1:floating-object:0',
        domain: 'floating-objects.anchors',
        entityId: 'sheet-1!object:picture-1',
      }),
      after: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'objectType', value: 'picture' },
            { key: 'changedFields', value: { kind: 'array', values: ['anchor', 'width'] } },
            { key: 'width', value: 320 },
          ]),
        }),
      },
    });
    expect(changes[1]).toMatchObject({
      structural: expect.objectContaining({
        changeId: 'mutation-1:chart:1',
        domain: 'charts.source-range',
        entityId: 'sheet-1!chart:chart-1',
      }),
      after: {
        kind: 'value',
        value: expect.objectContaining({
          fields: expect.arrayContaining([
            { key: 'objectType', value: 'chart' },
            { key: 'chartType', value: 'bar' },
            { key: 'dataRange', value: 'A1:B10' },
            { key: 'seriesRange', value: 'A1:A10' },
            { key: 'categoryRange', value: 'B1:B10' },
          ]),
        }),
      },
    });
  });
});

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    ...overrides,
  } as MutationResult;
}

function capturedChanges(captured: Extract<VersionNormalCommitCaptureResult, { status: 'success' }>): any[] {
  return (captured.input.semanticChangeSetRecord.preimage.payload as any).changes;
}

function semanticAfterObject(fields: { key: string; value: unknown }[]) { return { kind: 'value', value: { kind: 'object', fields } }; }

function encodedRangeChange(
  sheetId: string,
  rangeId: string,
  changeKind: RangeChange['kind'],
  rangeKind: string,
): RangeChange {
  const meta = {
    rangeId,
    kind: rangeKind,
    anchor: { Elastic: { startRow: 'row-1', endRow: 'row-2', startCol: 'col-1', endCol: 'col-2' } },
    encoding: 'None',
    rowIds: ['row-1', 'row-2'],
    colIds: ['col-1', 'col-2'],
  };
  return { sheetId, rangeId, kind: changeKind, data: new TextEncoder().encode(JSON.stringify(meta)) };
}

function floatingObjectData(id: string, type: string, data: Record<string, unknown>) {
  return {
    id,
    sheetId: 'sheet-1',
    type,
    anchor: { anchorRow: 1, anchorCol: 2, anchorRowOffsetEmu: 0, anchorColOffsetEmu: 0, anchorMode: 'twoCell', endRow: 4, endCol: 5, endRowOffsetEmu: 0, endColOffsetEmu: 0 },
    width: 320,
    height: 180,
    zIndex: 3,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: id,
    createdAt: 1,
    updatedAt: 2,
    ...data,
  } as any;
}

function captureInput(): VersionNormalCommitCaptureInput { return { namespace: NAMESPACE } as VersionNormalCommitCaptureInput; }

function expectCaptureSuccess(
  result: VersionNormalCommitCaptureResult,
): Extract<VersionNormalCommitCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected capture success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}
