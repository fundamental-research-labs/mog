/**
 * Chart type conversion helpers between Rust OOXML types and TS ChartType.
 *
 * The Rust side has a single `Bar` ChartType with a `BarDirection` enum
 * (Bar vs Column), while the TS side has separate `bar` and `column` types.
 * This module bridges that impedance mismatch.
 *
 * Handles OOXML roundtrip chart type alignment.
 */
import type { ChartType } from '../types';

// =============================================================================
// Rust OOXML ChartType values (matches ooxml-types/src/charts.rs)
// =============================================================================

/**
 * Rust-side ChartType enum values as they appear in serialized OOXML data.
 * Matches the `ChartType` enum in `file-io/ooxml/types/src/charts.rs`.
 */
export type RustChartType =
  | 'Unknown'
  | 'Bar'
  | 'Bar3D'
  | 'Line'
  | 'Line3D'
  | 'Pie'
  | 'Pie3D'
  | 'Doughnut'
  | 'Area'
  | 'Area3D'
  | 'Scatter'
  | 'Bubble'
  | 'Radar'
  | 'Surface'
  | 'Surface3D'
  | 'Stock'
  | 'OfPie'
  | 'Combo';

/**
 * Rust-side BarDirection enum values.
 * Matches the `BarDirection` enum in `file-io/ooxml/types/src/charts.rs`.
 */
export type RustBarDirection = 'Bar' | 'Column';

// =============================================================================
// Rust -> TS conversion
// =============================================================================

/**
 * Convert a Rust OOXML ChartType (+ optional BarDirection) to a TS ChartType.
 *
 * Key mappings:
 * - `Bar` + `Column` direction -> `'column'` (vertical columns)
 * - `Bar` + `Bar` direction    -> `'bar'`    (horizontal bars)
 * - `Bar3D` + `Column`         -> `'column3d'`
 * - `Bar3D` + `Bar`            -> `'bar3d'`
 *
 * For non-bar types, `barDirection` is ignored.
 *
 * @param rustChartType - The Rust ChartType enum value
 * @param barDirection  - The BarDirection for Bar/Bar3D types (default: 'Column')
 * @returns The corresponding TS ChartType, or `'bar'` for unknown types
 */
export function rustToTsChartType(
  rustChartType: RustChartType,
  barDirection?: RustBarDirection,
): ChartType {
  switch (rustChartType) {
    case 'Bar':
      return barDirection === 'Bar' ? 'bar' : 'column';
    case 'Bar3D':
      return barDirection === 'Bar' ? 'bar3d' : 'column3d';
    case 'Line':
      return 'line';
    case 'Line3D':
      return 'line3d';
    case 'Pie':
      return 'pie';
    case 'Pie3D':
      return 'pie3d';
    case 'Doughnut':
      return 'doughnut';
    case 'Area':
      return 'area';
    case 'Area3D':
      return 'area3d';
    case 'Scatter':
      return 'scatter';
    case 'Bubble':
      return 'bubble';
    case 'Radar':
      return 'radar';
    case 'Surface':
      return 'surface';
    case 'Surface3D':
      return 'surface3d';
    case 'Stock':
      return 'stock';
    case 'OfPie':
      return 'ofPie';
    case 'Combo':
      return 'combo';
    case 'Unknown':
    default:
      return 'bar';
  }
}

// =============================================================================
// TS -> Rust conversion
// =============================================================================

/**
 * Result of converting a TS ChartType back to Rust OOXML types.
 * For bar/column types, includes the BarDirection.
 */
export interface RustChartTypeResult {
  chartType: RustChartType;
  barDirection?: RustBarDirection;
}

/**
 * Convert a TS ChartType to Rust OOXML ChartType + BarDirection.
 *
 * Key mappings:
 * - `'column'`   -> `Bar` + `Column` direction
 * - `'bar'`      -> `Bar` + `Bar` direction
 * - `'column3d'` -> `Bar3D` + `Column` direction
 * - `'bar3d'`    -> `Bar3D` + `Bar` direction
 *
 * @param tsChartType - The TS ChartType
 * @returns The Rust ChartType and optional BarDirection
 */
export function tsToRustChartType(tsChartType: ChartType): RustChartTypeResult {
  switch (tsChartType) {
    case 'bar':
      return { chartType: 'Bar', barDirection: 'Bar' };
    case 'column':
      return { chartType: 'Bar', barDirection: 'Column' };
    case 'bar3d':
      return { chartType: 'Bar3D', barDirection: 'Bar' };
    case 'column3d':
      return { chartType: 'Bar3D', barDirection: 'Column' };
    case 'line':
      return { chartType: 'Line' };
    case 'line3d':
      return { chartType: 'Line3D' };
    case 'pie':
      return { chartType: 'Pie' };
    case 'pie3d':
      return { chartType: 'Pie3D' };
    case 'doughnut':
      return { chartType: 'Doughnut' };
    case 'area':
      return { chartType: 'Area' };
    case 'area3d':
      return { chartType: 'Area3D' };
    case 'scatter':
      return { chartType: 'Scatter' };
    case 'bubble':
      return { chartType: 'Bubble' };
    case 'radar':
      return { chartType: 'Radar' };
    case 'surface':
      return { chartType: 'Surface' };
    case 'surface3d':
      return { chartType: 'Surface3D' };
    case 'stock':
      return { chartType: 'Stock' };
    case 'ofPie':
      return { chartType: 'OfPie' };
    case 'combo':
      return { chartType: 'Combo' };
    case 'funnel':
    case 'waterfall':
    case 'treemap':
    case 'sunburst':
    case 'regionMap':
      // Funnel, waterfall, treemap, sunburst, and regionMap are ChartEx types
      // with no standard OOXML chart equivalent.
      // Map to Bar as the closest approximation for the bridge.
      return { chartType: 'Bar', barDirection: 'Column' };
    default: {
      // Exhaustiveness check
      void (tsChartType as never);
      return { chartType: 'Unknown' };
    }
  }
}
