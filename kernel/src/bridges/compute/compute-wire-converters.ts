/**
 * Compute Wire Converters — Pure transformation functions between wire types
 * and domain types.
 *
 * Converts between Rust serde JSON wire format (snake_case, externally-tagged
 * enums) and the camelCase TS contracts layer.
 *
 * Extracted from compute-bridge.ts.
 */

import {
  toColId,
  toCellId,
  toRowId,
  type IdentityFormula,
  type IdentityFormulaRef,
} from '@mog-sdk/contracts/cell-identity';
import { type CellRange, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { TableConfig, TableColumn as ContractTableColumn } from '@mog-sdk/contracts/tables';
import type { Table } from '@mog/table-engine';

import type {
  ColumnFilterCriteria,
  DynamicFilterRule,
  FilterOperator,
} from '@mog-sdk/contracts/filter';

import type { IdentityFormulaRefWire, IdentityFormulaWire } from './compute-wire-types';

import type { ColumnFilter } from './compute-types.gen';

import { BridgeError } from '../../errors/bridge';
import { tableStylePresetFromStyleId } from '../../domain/tables/style-normalization';

// =============================================================================
// Identity Formula Converters
// =============================================================================

/**
 * Convert an IdentityFormulaRefWire (Rust externally-tagged enum) to
 * the camelCase IdentityFormulaRef used by the TS contracts layer.
 *
 * The TS contract mirrors all six Rust identity ref variants so row and
 * column identities never get mislabeled as cell identities.
 */
function wireRefToContractRef(wire: IdentityFormulaRefWire): IdentityFormulaRef {
  if ('Cell' in wire) {
    return {
      type: 'cell',
      id: toCellId(wire.Cell.id),
      rowAbsolute: wire.Cell.row_absolute,
      colAbsolute: wire.Cell.col_absolute,
    };
  }
  if ('Range' in wire) {
    return {
      type: 'range',
      startId: toCellId(wire.Range.start_id),
      endId: toCellId(wire.Range.end_id),
      startRowAbsolute: wire.Range.start_row_absolute,
      startColAbsolute: wire.Range.start_col_absolute,
      endRowAbsolute: wire.Range.end_row_absolute,
      endColAbsolute: wire.Range.end_col_absolute,
    };
  }
  if ('RectRange' in wire) {
    return {
      type: 'rectRange',
      sheetId: toSheetId(wire.RectRange.sheet_id),
      startRowId: toRowId(wire.RectRange.start_row_id),
      startColId: toColId(wire.RectRange.start_col_id),
      endRowId: toRowId(wire.RectRange.end_row_id),
      endColId: toColId(wire.RectRange.end_col_id),
      startRowAbsolute: wire.RectRange.start_row_absolute,
      startColAbsolute: wire.RectRange.start_col_absolute,
      endRowAbsolute: wire.RectRange.end_row_absolute,
      endColAbsolute: wire.RectRange.end_col_absolute,
    };
  }
  if ('FullRow' in wire) {
    return {
      type: 'fullRow',
      rowId: toRowId(wire.FullRow.row_id),
      absolute: wire.FullRow.absolute,
    };
  }
  if ('RowRange' in wire) {
    return {
      type: 'rowRange',
      startRowId: toRowId(wire.RowRange.start_row_id),
      endRowId: toRowId(wire.RowRange.end_row_id),
      startAbsolute: wire.RowRange.start_absolute,
      endAbsolute: wire.RowRange.end_absolute,
    };
  }
  if ('FullCol' in wire) {
    return {
      type: 'fullCol',
      colId: toColId(wire.FullCol.col_id),
      absolute: wire.FullCol.absolute,
    };
  }
  if ('ColRange' in wire) {
    return {
      type: 'colRange',
      startColId: toColId(wire.ColRange.start_col_id),
      endColId: toColId(wire.ColRange.end_col_id),
      startAbsolute: wire.ColRange.start_absolute,
      endAbsolute: wire.ColRange.end_absolute,
    };
  }
  // Exhaustive — should never reach here
  throw new BridgeError(
    'BRIDGE_COMMAND_FAILED',
    'wireRefToContractRef',
    'Unknown IdentityFormulaRefWire variant',
  );
}

/**
 * Convert a Rust IdentityFormulaWire to the camelCase IdentityFormula
 * contract type used throughout the TS codebase.
 */
export function wireToIdentityFormula(wire: IdentityFormulaWire): IdentityFormula {
  return {
    template: wire.template,
    refs: wire.refs.map(wireRefToContractRef),
  };
}

/**
 * Convert a camelCase IdentityFormulaRef (TS contracts layer)
 * to the snake_case IdentityFormulaRefWire for Rust.
 */
function contractRefToWireRef(ref: IdentityFormulaRef): IdentityFormulaRefWire {
  if (ref.type === 'cell') {
    return {
      Cell: {
        id: ref.id,
        row_absolute: ref.rowAbsolute,
        col_absolute: ref.colAbsolute,
      },
    };
  }
  if (ref.type === 'range') {
    return {
      Range: {
        start_id: ref.startId,
        end_id: ref.endId,
        start_row_absolute: ref.startRowAbsolute,
        start_col_absolute: ref.startColAbsolute,
        end_row_absolute: ref.endRowAbsolute,
        end_col_absolute: ref.endColAbsolute,
      },
    };
  }
  if (ref.type === 'rectRange') {
    return {
      RectRange: {
        sheet_id: ref.sheetId,
        start_row_id: ref.startRowId,
        start_col_id: ref.startColId,
        end_row_id: ref.endRowId,
        end_col_id: ref.endColId,
        start_row_absolute: ref.startRowAbsolute,
        start_col_absolute: ref.startColAbsolute,
        end_row_absolute: ref.endRowAbsolute,
        end_col_absolute: ref.endColAbsolute,
      },
    };
  }
  if (ref.type === 'fullRow') {
    return {
      FullRow: {
        row_id: ref.rowId,
        absolute: ref.absolute,
      },
    };
  }
  if (ref.type === 'rowRange') {
    return {
      RowRange: {
        start_row_id: ref.startRowId,
        end_row_id: ref.endRowId,
        start_absolute: ref.startAbsolute,
        end_absolute: ref.endAbsolute,
      },
    };
  }
  if (ref.type === 'fullCol') {
    return {
      FullCol: {
        col_id: ref.colId,
        absolute: ref.absolute,
      },
    };
  }
  if (ref.type === 'colRange') {
    return {
      ColRange: {
        start_col_id: ref.startColId,
        end_col_id: ref.endColId,
        start_absolute: ref.startAbsolute,
        end_absolute: ref.endAbsolute,
      },
    };
  }
  throw new BridgeError(
    'BRIDGE_COMMAND_FAILED',
    'identityFormulaToWire',
    `Unknown IdentityFormulaRef variant: ${JSON.stringify(ref)}`,
  );
}

/**
 * Convert a camelCase IdentityFormula (TS contracts) to the
 * snake_case IdentityFormulaWire for passing to Rust.
 */
export function identityFormulaToWire(formula: IdentityFormula): IdentityFormulaWire {
  return {
    template: formula.template,
    refs: formula.refs.map(contractRefToWireRef),
    // Hardcoded false: these flags are Rust-side concerns determined during recalc.
    // is_dynamic_array is detected by the formula engine when a formula spills into
    // adjacent cells (e.g., SORT, FILTER, UNIQUE). is_volatile is set when the
    // formula contains volatile functions (NOW, RAND, etc.). Both are computed by
    // Rust and flow back via RecalcResult — TS never needs to set them to true.
    is_dynamic_array: false,
    is_volatile: false,
  };
}

// =============================================================================
// Table Wire → TableConfig Converter
// =============================================================================

/**
 * Convert a bridge Table (from Rust compute-core) to a TableConfig (contracts domain type).
 *
 * The bridge Table type is the rich representation that Rust returns, including
 * structural data (range, columns, headers) plus style metadata.
 * TableConfig is the kernel domain type used throughout the TS layer.
 */
// =============================================================================
// Filter Criteria → ColumnFilter Converter
// =============================================================================

/**
 * Convert a contracts ColumnFilterCriteria (flat interface) to the Rust compute
 * ColumnFilter discriminated union expected by the bridge.
 *
 * Mapping:
 *   contracts 'value'     → compute 'values'
 *   contracts 'condition' → compute 'condition'
 *   contracts 'color'     → compute 'color'
 *   contracts 'top10'     → compute 'topBottom'
 */
export function columnFilterCriteriaToCompute(criteria: ColumnFilterCriteria): ColumnFilter {
  switch (criteria.type) {
    case 'value':
      return {
        type: 'values',
        values: (criteria.values ?? []).filter(
          (value) => !(value === null || (typeof value === 'string' && value.trim() === '')),
        ),
        includeBlanks:
          criteria.includeBlanks ??
          criteria.values?.some((v) => v === null || (typeof v === 'string' && v.trim() === '')) ??
          false,
      };
    case 'condition':
      return {
        type: 'condition',
        conditions: (criteria.conditions ?? []).map((c) => ({
          operator: c.operator as import('./compute-types.gen').FilterOperator,
          value: c.value,
          value2: c.value2,
        })),
        logic: criteria.conditionLogic ?? 'and',
      };
    case 'color':
      return {
        type: 'color',
        color: criteria.colorFilter?.color ?? '',
        byFont: criteria.colorFilter?.type === 'font',
      };
    case 'top10':
      return {
        type: 'topBottom',
        direction: criteria.topBottom?.type ?? 'top',
        count: criteria.topBottom?.count ?? 10,
        by: criteria.topBottom?.by ?? 'items',
      };
    case 'dynamic': {
      if (!criteria.dynamicFilter?.rule) {
        throw new BridgeError(
          'BRIDGE_COMMAND_FAILED',
          'columnFilterCriteriaToCompute',
          'Dynamic filter criteria requires dynamicFilter.rule',
        );
      }
      return { type: 'dynamic', rule: criteria.dynamicFilter.rule };
    }
    case 'icon': {
      if (!criteria.iconFilter) {
        throw new BridgeError(
          'BRIDGE_COMMAND_FAILED',
          'columnFilterCriteriaToCompute',
          'Icon filter criteria requires iconFilter',
        );
      }
      return {
        type: 'icon',
        iconSetName: criteria.iconFilter.iconSet,
        iconIndex: criteria.iconFilter.iconIndex,
      };
    }
    default: {
      // Exhaustive check — if contracts adds new types this will fail at compile time
      const _exhaustive: never = criteria.type;
      throw new BridgeError(
        'BRIDGE_COMMAND_FAILED',
        'columnFilterCriteriaToCompute',
        `Unknown filter criteria type: ${_exhaustive}`,
      );
    }
  }
}

/**
 * Convert a Rust compute ColumnFilter (discriminated union) back to the
 * contracts ColumnFilterCriteria (flat interface).
 *
 * This is the inverse of columnFilterCriteriaToCompute().
 *
 * Mapping:
 *   compute 'values'    → contracts 'value'
 *   compute 'condition' → contracts 'condition'
 *   compute 'color'     → contracts 'color'
 *   compute 'topBottom' → contracts 'top10'
 *   compute 'dynamic'   → contracts 'dynamic'
 *   compute 'icon'      → contracts 'icon'
 */
export function computeColumnFilterToCriteria(filter: ColumnFilter): ColumnFilterCriteria {
  switch (filter.type) {
    case 'values':
      return {
        type: 'value',
        values: filter.values as import('@mog-sdk/contracts/core').CellValue[],
        includeBlanks: filter.includeBlanks,
      };
    case 'condition':
      return {
        type: 'condition',
        conditions: filter.conditions.map((c) => ({
          operator: c.operator as FilterOperator,
          value: c.value as import('@mog-sdk/contracts/core').CellValue | undefined,
          value2: c.value2 as import('@mog-sdk/contracts/core').CellValue | undefined,
        })),
        conditionLogic: filter.logic,
      };
    case 'color': {
      return {
        type: 'color',
        colorFilter: {
          // 'fill' / 'font' matches Excel/ECMA-376 vocabulary and the contract
          // discriminator (renamed from 'background' to 'fill').
          type: filter.byFont ? 'font' : 'fill',
          color: filter.color,
        },
      };
    }
    case 'topBottom':
      return {
        type: 'top10',
        topBottom: {
          type: filter.direction,
          count: filter.count,
          by: filter.by,
        },
      };
    case 'dynamic':
      return {
        type: 'dynamic',
        dynamicFilter: { rule: filter.rule as DynamicFilterRule },
      };
    case 'icon':
      return {
        type: 'icon',
        iconFilter: {
          iconSet: filter.iconSetName,
          iconIndex: filter.iconIndex,
        },
      };
    default: {
      const _exhaustive: never = filter;
      throw new BridgeError(
        'BRIDGE_COMMAND_FAILED',
        'computeColumnFilterToCriteria',
        `Unknown compute filter type: ${(_exhaustive as ColumnFilter).type}`,
      );
    }
  }
}

export function wireTableToTableConfig(table: Table): TableConfig {
  const range: CellRange = {
    startRow: table.range.startRow,
    startCol: table.range.startCol,
    endRow: table.range.endRow,
    endCol: table.range.endCol,
  };

  const columns: ContractTableColumn[] = table.columns.map((col) => ({
    id: col.id,
    name: col.name,
    index: col.index,
    totalFunction: col.totalsFunction ?? undefined,
    totalFormula: col.totalsLabel ?? undefined,
    // calculatedFormula exists on the generated wire type but not on @mog/table-engine's TableColumn
    calculatedFormula: (col as ContractTableColumn).calculatedFormula,
  }));

  return {
    id: table.id,
    name: table.name,
    sheetId: toSheetId(table.sheetId),
    range,
    hasHeaderRow: table.hasHeaderRow,
    hasTotalRow: table.hasTotalsRow,
    columns,
    style: {
      preset: tableStylePresetFromStyleId(table.style),
      showBandedRows: table.bandedRows,
      showBandedColumns: table.bandedColumns,
      showFirstColumnHighlight: table.emphasizeFirstColumn,
      showLastColumnHighlight: table.emphasizeLastColumn,
    },
    autoExpand: table.autoExpand,
    autoCalculatedColumns: table.autoCalculatedColumns,
    showFilterButtons: table.showFilterButtons,
  };
}
