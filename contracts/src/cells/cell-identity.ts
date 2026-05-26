/**
 * Public cell identity contracts.
 *
 * Type authoring still lives in the private type shard, but the branded
 * constructors are public runtime contract values and must be emitted by
 * @mog-sdk/contracts without importing private packages.
 */
export type * from '@mog/types-core/cell-identity';
export type { CellId, ColId, RowId } from '@mog/types-core/cell-identity';
import type { CellId, ColId, RowId } from '@mog/types-core/cell-identity';

/** Construct a branded CellId from a raw string. */
export function cellId(id: string): CellId {
  return id as CellId;
}

/** Wire-seam alias for branding raw CellId values from storage/bridge payloads. */
export const toCellId = cellId;

/** Construct a branded RowId from a raw string. */
export function rowId(id: string): RowId {
  return id as RowId;
}

/** Wire-seam alias for branding raw RowId values from storage/bridge payloads. */
export const toRowId = rowId;

/** Construct a branded ColId from a raw string. */
export function colId(id: string): ColId {
  return id as ColId;
}

/** Wire-seam alias for branding raw ColId values from storage/bridge payloads. */
export const toColId = colId;
