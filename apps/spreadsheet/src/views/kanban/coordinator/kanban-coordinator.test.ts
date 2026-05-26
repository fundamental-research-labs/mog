import type { IRecordsAPI, Workbook } from '@mog-sdk/contracts/api';
import { toColId, toRowId } from '@mog-sdk/contracts/cell-identity';
import { sheetId } from '@mog-sdk/contracts/core';
import { KanbanCoordinator } from './kanban-coordinator';
import type { KanbanViewConfig, TableId, ViewId } from '../../types';

function createRecordsAPI(removeCalls: Array<readonly [string, string]>): IRecordsAPI {
  return {
    get: async () => null,
    query: async () => [],
    getFieldValue: async () => null,
    getFieldByName: async () => null,
    create: async () => '',
    update: async () => undefined,
    remove: async (tableId, rowId) => {
      removeCalls.push([tableId, rowId]);
    },
  };
}

function createKanbanConfig(tableId: TableId): KanbanViewConfig {
  return {
    viewId: 'kanban-view' as ViewId,
    sheetId: sheetId('sheet-1'),
    tableId,
    groupByColumn: toColId('Status'),
    cardTitleColumn: toColId('Title'),
    cardFields: [],
    showEmptyGroups: true,
    wipLimits: {},
    collapsedColumns: [],
  };
}

describe('KanbanCoordinator', () => {
  it('deletes cards through the public records.remove contract', () => {
    const removeCalls: Array<readonly [string, string]> = [];
    const records = createRecordsAPI(removeCalls);
    const tableId = 'tasks' as TableId;
    const coordinator = new KanbanCoordinator({
      workbook: { records } as unknown as Workbook,
      tableId,
      config: createKanbanConfig(tableId),
    });

    try {
      coordinator.handleCardsDelete([toRowId('5'), toRowId('9')]);

      expect(removeCalls).toEqual([
        [tableId, toRowId('5')],
        [tableId, toRowId('9')],
      ]);
    } finally {
      coordinator.dispose();
    }
  });
});
