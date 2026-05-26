import type { CellError } from '@mog-sdk/contracts/core';

import {
  clipboardCellValueToText,
  fromClipboardCellValue,
  toClipboardCellValue,
} from '../cell-value-contract';
import { ClipboardService } from '../clipboard-service';
import { cellsToHTML, cellsToTSV, htmlToCells, tsvToCells } from '../serializers';
import type { ClipboardPayload } from '../types';
import {
  convertValueForType,
  extractColumn,
  extractRegion,
  extractRow,
  transposePayload,
} from '../utils';

const REF_ERROR: CellError = { type: 'error', value: 'Ref' };
const DIV0_ERROR: CellError = { type: 'error', value: 'Div0' };

describe('clipboard cell value contract', () => {
  it('uses core CellValue cells, including CellError, and rejects raw Date at type level', () => {
    const payload: ClipboardPayload = {
      cells: {
        values: [[REF_ERROR, 'ok']],
        rowCount: 1,
        colCount: 2,
      },
      source: {
        viewType: 'grid',
        viewId: null,
        sheetId: null,
      },
      text: '#REF!\tok',
    };

    const rawDate = new Date('2026-05-14T00:00:00.000Z');
    const invalidPayload: ClipboardPayload = {
      cells: {
        // @ts-expect-error Raw Date is a workflow/view boundary value, not a clipboard cell value.
        values: [[rawDate]],
        rowCount: 1,
        colCount: 1,
      },
      source: {
        viewType: 'grid',
        viewId: null,
        sheetId: null,
      },
      text: '2026-05-14',
    };

    expect(payload.cells.values[0][0]).toBe(REF_ERROR);
    expect(invalidPayload.cells.values[0][0]).toBe(rawDate);
  });

  it('normalizes Date only through explicit clipboard boundary helpers', () => {
    const rawDate = new Date('2026-05-14T12:34:56.000Z');

    expect(toClipboardCellValue(rawDate)).toBe('2026-05-14T12:34:56.000Z');
    expect(fromClipboardCellValue(rawDate, 'date')).toBe('2026-05-14T12:34:56.000Z');
    expect(fromClipboardCellValue(45600, 'date')).toBe(45600);
  });

  it('preserves CellError through payload creation and utility transforms', () => {
    const payload = ClipboardService.createPayload([
      [REF_ERROR, 'A'],
      [42, DIV0_ERROR],
    ]);

    expect(payload.cells.values[0][0]).toBe(REF_ERROR);
    expect(payload.cells.values[1][1]).toBe(DIV0_ERROR);
    expect(transposePayload(payload).cells.values[0][0]).toBe(REF_ERROR);
    expect(transposePayload(payload).cells.values[1][1]).toBe(DIV0_ERROR);
    expect(extractRow(payload, 0)[0]).toBe(REF_ERROR);
    expect(extractColumn(payload, 1)[1]).toBe(DIV0_ERROR);
    expect(extractRegion(payload, 0, 0, 1, 1)[1][1]).toBe(DIV0_ERROR);
    expect(convertValueForType(REF_ERROR, 'text')).toBe(REF_ERROR);
  });

  it('serializes CellError to canonical display text for system clipboard formats', () => {
    expect(clipboardCellValueToText(REF_ERROR)).toBe('#REF!');
    expect(cellsToTSV([[REF_ERROR, true, null]])).toBe('#REF!\tTRUE\t');

    const html = cellsToHTML([[DIV0_ERROR]]);
    expect(html).toContain('#DIV/0!');
    expect(html).not.toContain('[object Object]');
  });

  it('serializes center-across alignment as valid external clipboard CSS', () => {
    const html = cellsToHTML([['Centered']], [[{ horizontalAlign: 'centerContinuous' }]]);

    expect(html).toContain('text-align: center');
    expect(html).not.toContain('centerContinuous');
  });

  it('keeps external date-looking TSV and HTML values as strings', () => {
    const tsv = tsvToCells('2026-05-14\t05/14/2026');
    expect(tsv.values[0][0]).toBe('2026-05-14');
    expect(tsv.values[0][0]).not.toBeInstanceOf(Date);
    expect(tsv.values[0][1]).toBe('05/14/2026');
    expect(tsv.values[0][1]).not.toBeInstanceOf(Date);

    const html = htmlToCells('<table><tr><td>2026-05-14</td></tr></table>');
    expect(html?.values[0][0]).toBe('2026-05-14');
    expect(html?.values[0][0]).not.toBeInstanceOf(Date);
  });
});
