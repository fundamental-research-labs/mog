import { toCellId, toColId, toRowId } from '@mog-sdk/contracts/cell-identity';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { DefinedName } from '@mog-sdk/contracts/named-ranges';

export function mapRustNamedRange(rust: any): DefinedName {
  const scope =
    rust.scope && typeof rust.scope === 'object' && 'Sheet' in rust.scope
      ? toSheetId(rust.scope.Sheet as string)
      : undefined;

  const rawRefs: any[] = rust.refersTo?.refs ?? [];
  const refs = rawRefs.map((ref: any) => {
    if (ref.Cell) {
      return {
        type: 'cell' as const,
        id: toCellId(ref.Cell.id),
        rowAbsolute: ref.Cell.rowAbsolute ?? false,
        colAbsolute: ref.Cell.colAbsolute ?? false,
      };
    }
    if (ref.Range) {
      return {
        type: 'range' as const,
        startId: toCellId(ref.Range.startId),
        endId: toCellId(ref.Range.endId),
        startRowAbsolute: ref.Range.startRowAbsolute ?? false,
        startColAbsolute: ref.Range.startColAbsolute ?? false,
        endRowAbsolute: ref.Range.endRowAbsolute ?? false,
        endColAbsolute: ref.Range.endColAbsolute ?? false,
      };
    }
    if (ref.RectRange) {
      return {
        type: 'rectRange' as const,
        sheetId: toSheetId(ref.RectRange.sheetId),
        startRowId: toRowId(ref.RectRange.startRowId),
        startColId: toColId(ref.RectRange.startColId),
        endRowId: toRowId(ref.RectRange.endRowId),
        endColId: toColId(ref.RectRange.endColId),
        startRowAbsolute: ref.RectRange.startRowAbsolute ?? false,
        startColAbsolute: ref.RectRange.startColAbsolute ?? false,
        endRowAbsolute: ref.RectRange.endRowAbsolute ?? false,
        endColAbsolute: ref.RectRange.endColAbsolute ?? false,
      };
    }
    if (ref.FullRow) {
      return {
        type: 'fullRow' as const,
        rowId: toRowId(ref.FullRow.rowId),
        absolute: ref.FullRow.absolute ?? false,
      };
    }
    if (ref.RowRange) {
      return {
        type: 'rowRange' as const,
        startRowId: toRowId(ref.RowRange.startRowId),
        endRowId: toRowId(ref.RowRange.endRowId),
        startAbsolute: ref.RowRange.startAbsolute ?? false,
        endAbsolute: ref.RowRange.endAbsolute ?? false,
      };
    }
    if (ref.FullCol) {
      return {
        type: 'fullCol' as const,
        colId: toColId(ref.FullCol.colId),
        absolute: ref.FullCol.absolute ?? false,
      };
    }
    if (ref.ColRange) {
      return {
        type: 'colRange' as const,
        startColId: toColId(ref.ColRange.startColId),
        endColId: toColId(ref.ColRange.endColId),
        startAbsolute: ref.ColRange.startAbsolute ?? false,
        endAbsolute: ref.ColRange.endAbsolute ?? false,
      };
    }
    return ref;
  });

  return {
    id: rust.id ?? rust.name,
    name: rust.name,
    refersTo: { template: rust.refersTo?.template ?? '', refs },
    scope,
    comment: rust.comment,
    visible: rust.visible ?? true,
  };
}
