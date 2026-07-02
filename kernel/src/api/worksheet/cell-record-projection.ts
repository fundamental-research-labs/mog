import type { CellRecord } from '@mog-sdk/contracts/api';
import { RangeValueType } from '@mog-sdk/contracts/api';
import type { CellValuePrimitive } from '@mog-sdk/contracts/core';
import type { RegionMeta, StoreCellData } from '@mog-sdk/contracts/store';
import { ERROR_DISPLAY_MAP, isCellError } from '@mog/spreadsheet-utils/errors';

import * as CellReads from '../../domain/cells/cell-reads';
import { classifyRangeValueType } from '../internal/value-conversions';

/**
 * Project a domain-layer {@link StoreCellData} (or `undefined`) to the
 * public {@link CellRecord} shape returned by `Worksheet.cells.get(addr)`.
 *
 * Empty in-bounds cells (`data === undefined`) deliberately return a
 * record with `value: null` + `valueType: Empty` rather than `undefined`
 * — see the public-API contract on {@link WorksheetCellsAccessor.get}.
 *
 * `isArrayMember` is derived here as `region != null && !region.isAnchor`
 * so the public surface has one canonical representation; the bridge's
 * back-compat `metadata.isArrayMember` field is intentionally ignored on
 * this read path so the accessor exposes one canonical surface.
 */
export function projectCellRecord(
  addr: string,
  row: number,
  col: number,
  data: StoreCellData | undefined,
): CellRecord {
  const normalizedAddr = addr.toUpperCase();
  if (data === undefined) {
    return {
      row,
      col,
      addr: normalizedAddr,
      value: null,
      valueType: RangeValueType.Empty,
      formula: null,
      region: null,
      isArrayMember: false,
    };
  }

  const effective = CellReads.getEffectiveValue(data);
  const valueType = classifyRangeValueType(effective);
  const value: CellValuePrimitive | null =
    effective !== null && isCellError(effective)
      ? ERROR_DISPLAY_MAP[effective.value]
      : (effective as CellValuePrimitive | null);
  const region: RegionMeta | null = data.region ?? null;
  const isArrayMember = region != null && !region.isAnchor;

  return {
    row,
    col,
    addr: normalizedAddr,
    value,
    valueType,
    formula: data.formula ?? null,
    region,
    isArrayMember,
  };
}
