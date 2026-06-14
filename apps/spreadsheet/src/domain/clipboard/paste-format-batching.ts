import type { CellFormat, CellRange } from '@mog-sdk/contracts/core';

export type CellFormatUpdate = {
  row: number;
  col: number;
  format: Partial<CellFormat>;
};

function stableFormatKey(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableFormatKey).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableFormatKey(record[key])}`)
    .join(',')}}`;
}

function compactRuns(updates: CellFormatUpdate[], axis: 'row' | 'col'): CellRange[] {
  const grouped = new Map<number, number[]>();
  for (const update of updates) {
    const fixed = axis === 'row' ? update.row : update.col;
    const moving = axis === 'row' ? update.col : update.row;
    const values = grouped.get(fixed);
    if (values) values.push(moving);
    else grouped.set(fixed, [moving]);
  }

  const ranges: CellRange[] = [];
  for (const [fixed, values] of grouped) {
    values.sort((a, b) => a - b);
    const first = values[0];
    if (first === undefined) continue;
    let runStart = first;
    let previous = first;
    for (let index = 1; index <= values.length; index++) {
      const next = values[index];
      if (next === previous + 1) {
        previous = next;
        continue;
      }

      ranges.push(
        axis === 'row'
          ? { startRow: fixed, endRow: fixed, startCol: runStart, endCol: previous }
          : { startRow: runStart, endRow: previous, startCol: fixed, endCol: fixed },
      );

      if (next === undefined) break;
      runStart = next;
      previous = next;
    }
  }
  return ranges;
}

export function compactCellFormatUpdates(
  updates: CellFormatUpdate[],
): Array<{ format: Partial<CellFormat>; ranges: CellRange[] }> {
  const byFormat = new Map<string, { format: Partial<CellFormat>; updates: CellFormatUpdate[] }>();
  for (const update of updates) {
    const key = stableFormatKey(update.format);
    const group = byFormat.get(key);
    if (group) group.updates.push(update);
    else byFormat.set(key, { format: update.format, updates: [update] });
  }

  return Array.from(byFormat.values()).map((group) => {
    const rows = new Set(group.updates.map((update) => update.row));
    const cols = new Set(group.updates.map((update) => update.col));
    return {
      format: group.format,
      ranges: compactRuns(group.updates, rows.size <= cols.size ? 'row' : 'col'),
    };
  });
}
