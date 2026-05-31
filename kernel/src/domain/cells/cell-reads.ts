/**
 * Cell Read Domain Module
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Read operations: async via ctx.computeBridge
 * - No CRDT reads — all data comes from Rust
 * - StoreCellData returned for backward compat with callers
 *
 * @see compute-core/src/storage/cells.rs - Rust implementation
 */

import { toCellId, type CellId } from '@mog-sdk/contracts/cell-identity';
import { asFormulaA1 } from '@mog/spreadsheet-utils/cells/formula-string';
import type { CellRawValue, CellValue, SheetId } from '@mog-sdk/contracts/core';
import type { RegionMeta, StoreCellData } from '@mog-sdk/contracts/store';
import { rawToCellValue } from '@mog/spreadsheet-utils/rich-text';

import type { TypedActiveCellData } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context/types';
import { getTrackedExternalFormula } from '../../services/external-formulas';

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Convert an ActiveCellData (Rust wire format) to StoreCellData (domain format).
 *
 * `region` is read off `data.metadata.region` if present — the Rust
 * `get_active_cell` populates the same `RegionMeta` shape that
 * `get_cell_data` does, via the unified `cell_render_at` chokepoint.
 */
function activeCellToStoreCellData(
  data: TypedActiveCellData,
  row: number,
  col: number,
): StoreCellData {
  const rawValue = data.value as CellRawValue;

  const result: StoreCellData = {
    id: toCellId(data.cellId),
    row,
    col,
    raw: rawValue,
  };

  if (data.formula) {
    result.formula = asFormulaA1(data.formula);
    // For formula cells, computed is the evaluated value
    result.computed = rawValue as CellValue;
    // Raw for formula cells is the formula string (already includes '=' prefix from Rust)
    result.raw = data.formula;
  }

  // D4: surface region membership (CSE / dynamic-array spill / Data
  // Table) on the canonical read shape. The Rust `get_active_cell`
  // populates `metadata.region` via the unified `cell_render_at`
  // chokepoint.
  const region = readRegion(data.metadata);
  if (region !== undefined) {
    result.region = region;
  }

  return result;
}

/**
 * Read `region` off a wire-format metadata blob (or `cellData` JSON).
 *
 * Returns `null` for cells outside any region, `undefined` if the metadata
 * is missing entirely (so callers can choose between "explicit no region"
 * and "no information"). The shape is whatever Rust serialized — see
 * `compute/core/crates/types/snapshot-types/src/properties.rs::RegionMeta`
 * and the wire mirror in `kernel/src/bridges/compute/types.ts`.
 */
function readRegion(metadata: unknown): RegionMeta | null | undefined {
  if (metadata == null || typeof metadata !== 'object') return undefined;
  const obj = metadata as Record<string, unknown>;
  if (!('region' in obj)) return undefined;
  const region = obj.region;
  if (region == null) return null;
  if (typeof region !== 'object') return undefined;
  // Trust Rust's serialization — the camelCase shape matches `RegionMeta`.
  return region as RegionMeta;
}

// =============================================================================
// Cell Read Operations
// =============================================================================

/**
 * Get cell data at position.
 *
 * Delegates to ComputeBridge.getCellIdAt + getActiveCell.
 * Falls back to getEffectiveValue for materialized cells (pivot output,
 * spill arrays) that exist in col_data but have no CellId.
 *
 * **D4 (projection-family unification):** every successful read now
 * carries `region` — the unified region-membership shape (CSE /
 * dynamic-array spill / Data Table; future pivot / table column / etc.)
 * sourced from the Rust `cell_render_at` chokepoint. Plain cells get
 * `region: null`; agents and the formula bar can switch on
 * `region?.kind` to decide brace policy + region-aware affordances
 * without going through `_activeCellData`.
 */
export async function getData(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<StoreCellData | undefined> {
  // Primary path: CellId-based lookup (real cells with formulas/values).
  // The Rust `get_active_cell` populates `metadata.region` via the same
  // `cell_render_at` chokepoint that `get_cell_data` uses (D3+D4) — no
  // need for a follow-up `getCellData` call when this path hits.
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  if (cellId) {
    const data = await ctx.computeBridge.getActiveCell(sheetId, cellId);
    if (data) {
      const activeData = activeCellToStoreCellData(data, row, col);
      if (activeData.formula !== undefined || activeData.raw != null) {
        return withTrackedExternalFormula(ctx, sheetId, row, col, activeData);
      }

      const cellData = await ctx.computeBridge.getCellData(sheetId, row, col);
      const rangeBackedData = cellDataToStoreCellData(cellData, row, col, cellId);
      if (rangeBackedData) {
        return withTrackedExternalFormula(ctx, sheetId, row, col, rangeBackedData);
      }

      return activeData;
    }
  }

  // Spill-member resolution: a non-anchor cell of a dynamic-array spill has
  // no CellId of its own and getCellData may return only a metadata stub
  // (no value field). Resolve via the projection registry so the formula
  // bar reflects the anchor's formula (Excel parity).
  const anchorFormula = await resolveProjectionAnchorFormula(ctx, sheetId, row, col);
  if (anchorFormula !== null) {
    // Pull the member's own materialized display value from the mirror so
    // computed stays cell-local (don't show the anchor's value at this
    // member's position).
    const cellData = await ctx.computeBridge.getCellData(sheetId, row, col);
    let memberValue: CellValue | null = null;
    let region: RegionMeta | null | undefined = undefined;
    if (cellData != null) {
      const obj = cellData as Record<string, unknown>;
      const rawValue = obj.value ?? obj.raw;
      if (rawValue != null) {
        memberValue = parseMirrorValue(rawValue);
      }
      region = readRegionField(obj);
    }
    const result: StoreCellData = {
      id: toCellId(''),
      row,
      col,
      formula: asFormulaA1(anchorFormula),
      raw: anchorFormula as CellRawValue,
      computed: memberValue as CellValue,
    };
    if (region !== undefined) result.region = region;
    return result;
  }

  // Fallback: single bridge call that checks BOTH Yrs storage AND mirror col_data.
  // Handles materialized values (pivot output, etc.) that have no CellId and
  // are not part of a dynamic-array projection.
  const cellData = await ctx.computeBridge.getCellData(sheetId, row, col);
  const rangeBackedData = cellDataToStoreCellData(cellData, row, col);
  if (rangeBackedData) {
    return withTrackedExternalFormula(ctx, sheetId, row, col, rangeBackedData);
  }

  return undefined;
}

function withTrackedExternalFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
  data: StoreCellData,
): StoreCellData {
  const formula = getTrackedExternalFormula(ctx, sheetId, row, col);
  if (!formula) return data;

  return {
    ...data,
    formula,
    raw: formula as CellRawValue,
    computed: data.computed ?? rawToCellValue(data.raw) ?? null,
  };
}

function cellDataToStoreCellData(
  cellData: unknown,
  row: number,
  col: number,
  fallbackCellId?: string,
): StoreCellData | undefined {
  if (cellData == null || typeof cellData !== 'object') return undefined;

  const obj = cellData as Record<string, unknown>;
  // Materialized/range-backed cells have value: { type, value }, often with
  // no Yrs cell payload even when the grid index can resolve a CellId.
  const rawValue = obj.value ?? obj.raw;
  if (rawValue == null) return undefined;

  const value = parseMirrorValue(rawValue);
  if (value === null || value === undefined) return undefined;

  const rawCellId = obj.cell_id ?? obj.cellId ?? fallbackCellId;
  const result: StoreCellData = {
    id: typeof rawCellId === 'string' ? toCellId(rawCellId) : toCellId(''),
    row,
    col,
    raw: value as CellRawValue,
  };
  const region = readRegionField(obj);
  if (region !== undefined) result.region = region;
  return result;
}

/**
 * Read `region` off the JSON response from `getCellData`. The Rust bridge
 * fn emits `region: RegionMeta | null` directly on the response object
 * (see `compute/core/src/storage/engine/queries.rs::region_json`).
 */
function readRegionField(obj: Record<string, unknown>): RegionMeta | null | undefined {
  if (!('region' in obj)) return undefined;
  const region = obj.region;
  if (region == null) return null;
  if (typeof region !== 'object') return undefined;
  return region as RegionMeta;
}

/**
 * Resolve the formula of a spill anchor for a given position, or null if
 * the position is not inside a projection (dynamic-array spill).
 *
 * Used by the formula bar path so that clicking a non-anchor spill cell
 * still shows the spilling formula, matching Excel.
 *
 * Exposed (not local) because both `getData` here and
 * `kernel/src/api/worksheet/operations/cell-operations.ts::getRawCellData`
 * call it — the two ingress points that populate the formula bar.
 *
 * TODO(rust): Collapse these 3-4 extra roundtrips by extending
 * `compute_get_raw_cell_data` to return the anchor's formula directly
 * when the position is inside a projection. See
 * `formula-bar spill-cell semantics`.
 */
export async function resolveProjectionAnchorFormula(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string | null> {
  // getProjectionSource resolves any position inside a projection to the
  // source/anchor position. (getProjectionRange only works when called on
  // the anchor itself — its name is misleading; see queries.rs::source_at.)
  const source = await ctx.computeBridge.getProjectionSource(sheetId, row, col);
  if (!source) return null;
  // The anchor itself already carries its own formula via the primary path;
  // only resolve for non-anchor members.
  if (source.row === row && source.col === col) return null;
  const anchorCellId = await ctx.computeBridge.getCellIdAt(sheetId, source.row, source.col);
  if (!anchorCellId) return null;
  const anchor = await ctx.computeBridge.getActiveCell(sheetId, anchorCellId);
  return anchor?.formula ?? null;
}

/**
 * Parse a { type, value } JSON object from getEffectiveValue into a raw cell value.
 */
function parseMirrorValue(json: unknown): CellValue | null {
  if (typeof json !== 'object' || json === null) return null;
  const obj = json as Record<string, unknown>;
  switch (obj.type) {
    case 'number':
      return obj.value as number;
    case 'text':
      return obj.value as string;
    case 'boolean':
      return obj.value as boolean;
    case 'error':
      return obj.value as string;
    case 'null':
      return null;
    default:
      return null;
  }
}

/**
 * Get raw value for formula bar display.
 */
export async function getRawValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<string> {
  const data = await getData(ctx, sheetId, row, col);
  if (!data) return '';
  if (data.raw === null) return '';
  return String(data.raw);
}

/**
 * Get the effective value of a cell.
 * For formula cells, ALWAYS use computed (even if null).
 * For value cells, use rawToCellValue(data.raw).
 */
export function getEffectiveValue(data: StoreCellData): CellValue | null {
  if (data.formula !== undefined) {
    return data.computed ?? null;
  }
  return rawToCellValue(data.raw) ?? null;
}

/**
 * Get cell value (computed if formula, raw otherwise).
 * Formula cells that evaluate to null return 0 (Excel compatibility).
 */
export async function getValue(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellValue> {
  const data = await getData(ctx, sheetId, row, col);
  if (!data) return null;

  const value = getEffectiveValue(data);

  if (value === null && data.formula !== undefined) {
    return 0;
  }

  return value ?? null;
}

/**
 * Get CellId at position.
 *
 * Delegates to ComputeBridge.getCellIdAt.
 */
export async function getCellIdAt(
  ctx: DocumentContext,
  sheetId: SheetId,
  row: number,
  col: number,
): Promise<CellId | null> {
  const cellId = await ctx.computeBridge.getCellIdAt(sheetId, row, col);
  return cellId ? toCellId(cellId) : null;
}
