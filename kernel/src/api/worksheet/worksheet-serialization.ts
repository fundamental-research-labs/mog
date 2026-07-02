import type { CellValue } from '@mog-sdk/contracts/core';
import type { SheetId } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { parseCellRange } from '../internal/utils';
import { normalizeCellValue } from '../internal/value-conversions';
import * as QueryOps from './operations/query-operations';
import * as RangeOps from './operations/range-operations';

type RangeBounds = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export async function worksheetToCSV(
  ctx: DocumentContext,
  sheetId: SheetId,
  options?: { separator?: string; range?: string },
): Promise<string> {
  const sep = options?.separator ?? ',';
  const range = await resolveExportRange(ctx, sheetId, options?.range);
  if (!range) return '';

  const cellData = await RangeOps.getRange(ctx, sheetId, { sheetId, ...range });

  const lines: string[] = [];
  for (const row of cellData) {
    const fields: string[] = [];
    for (const cell of row) {
      const val = cell.value;
      if (val == null) {
        fields.push('');
        continue;
      }
      // Use pre-formatted display string from Rust when available
      // (respects number formats, date formats, locale, etc.)
      let str =
        cell.formatted != null && cell.formatted !== ''
          ? cell.formatted
          : String(normalizeCellValue(val));

      // Formula injection protection: prefix dangerous leading chars with tab
      if (str.length > 0 && '=+-@'.includes(str[0])) {
        str = '\t' + str;
      }

      // RFC 4180: quote fields containing separator, double-quote, or newline
      if (str.includes(sep) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        str = '"' + str.replace(/"/g, '""') + '"';
      }
      fields.push(str);
    }
    lines.push(fields.join(sep));
  }
  return lines.join('\r\n');
}

export async function worksheetToJSON(
  ctx: DocumentContext,
  sheetId: SheetId,
  options?: { headerRow?: number | 'none'; range?: string },
): Promise<Record<string, CellValue>[]> {
  const range = await resolveExportRange(ctx, sheetId, options?.range);
  if (!range) return [];

  const cellData = await RangeOps.getRange(ctx, sheetId, { sheetId, ...range });
  if (cellData.length === 0) return [];

  const headerOpt = options?.headerRow;
  let headers: string[];
  let dataStartIdx: number;

  if (headerOpt === 'none') {
    // Use column letters as keys
    headers = cellData[0].map((_, i) => {
      let col = range.startCol + i;
      let letter = '';
      while (col >= 0) {
        letter = String.fromCharCode(65 + (col % 26)) + letter;
        col = Math.floor(col / 26) - 1;
      }
      return letter;
    });
    dataStartIdx = 0;
  } else {
    const headerRowIdx = typeof headerOpt === 'number' ? headerOpt - range.startRow : 0;
    if (headerRowIdx < 0 || headerRowIdx >= cellData.length) {
      throw new KernelError('COMPUTE_ERROR', `Header row index out of range`);
    }
    headers = cellData[headerRowIdx].map((cell) => (cell.value != null ? String(cell.value) : ''));
    dataStartIdx = headerRowIdx + 1;
  }

  const result: Record<string, CellValue>[] = [];
  for (let i = dataStartIdx; i < cellData.length; i++) {
    const row = cellData[i];
    const obj: Record<string, CellValue> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = normalizeCellValue(row[j]?.value ?? null);
    }
    result.push(obj);
  }
  return result;
}

async function resolveExportRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  rangeAddress: string | undefined,
): Promise<RangeBounds | null> {
  if (!rangeAddress) {
    return QueryOps.getUsedRange(ctx, sheetId);
  }
  const parsed = parseCellRange(rangeAddress);
  if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${rangeAddress}"`);
  return parsed;
}
