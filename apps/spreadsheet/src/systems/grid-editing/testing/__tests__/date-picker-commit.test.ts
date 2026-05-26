import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import { GridEditingSystem } from '../../grid-editing-system';

async function flushMicrotasks(count = 6): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
  }
}

describe('date picker commit pipeline', () => {
  it('routes semantic date commits through setDateValue without stringifying through setCellValue', async () => {
    const calls: Array<{
      sheetId: string;
      row: number;
      col: number;
      isoDate: string;
      kind: 'date' | 'datetime';
    }> = [];
    const setCellValueCalls: string[] = [];
    const sheetId = makeSheetId('test-sheet');
    const system = new GridEditingSystem({
      initialSheetId: 'test-sheet',
      editorDeps: {
        setCellValue: (_sheetId, _row, _col, value) => {
          setCellValueCalls.push(value);
        },
        setDateValue: (sheetId, row, col, isoDate, kind) => {
          calls.push({ sheetId, row, col, isoDate, kind });
        },
      },
    });
    system.start();

    try {
      system.access.commands.selection.setSelection(
        [{ startRow: 0, startCol: 0, endRow: 0, endCol: 0 }],
        { row: 0, col: 0 },
      );
      const cell = system.access.accessors.selection.getActiveCell();

      system.startEditing(cell, sheetId, '5/10/2026');
      system.access.commands.editor.datePickerCommit('2026-05-24', 'date', 'none');

      await flushMicrotasks();

      expect(calls).toEqual([
        { sheetId: 'test-sheet', row: 0, col: 0, isoDate: '2026-05-24', kind: 'date' },
      ]);
      expect(setCellValueCalls).toEqual([]);
      expect((system as any).editorActor.getSnapshot().matches('inactive')).toBe(true);
    } finally {
      system.dispose();
    }
  });
});
