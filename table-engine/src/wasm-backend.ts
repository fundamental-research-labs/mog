/**
 * WASM backend for table-engine computation.
 *
 * The kernel loads @mog-sdk/wasm and passes it to table-engine via initTableWasm().
 * After initialization, heavy computation functions delegate to Rust/WASM.
 */

/** Typed interface for table-engine WASM exports. */
export interface TableWasmExports {
  /** Index signature for compatibility with generic WASM module loaders. */
  [fn_name: string]: (...args: unknown[]) => unknown;
  table_evaluate_column_filter: (criteria: unknown, column_data: unknown) => unknown;
  table_compute_sort_order: (specs: unknown, data: unknown, total_rows: unknown) => unknown;
  table_build_slicer_cache: (
    slicer: unknown,
    column_data: unknown,
    other_bitmap: unknown,
  ) => unknown;
  table_build_filter_dropdown: (
    column_data: unknown,
    current_filter: unknown,
    row_visibility: unknown,
  ) => unknown;
  table_resolve_dynamic_filter: (rule: unknown, column_data: unknown) => unknown;
  table_evaluate_top_bottom: (filter: unknown, column_data: unknown) => unknown;
  table_resolve_cell_format: (table: unknown, row: unknown, col: unknown) => unknown;
  table_get_built_in_styles: () => unknown;
  table_parse_structured_ref: (input: unknown) => unknown;
  table_resolve_structured_ref: (ref: unknown, table: unknown, current_row: unknown) => unknown;
  table_adjust_structured_ref: (ref: unknown, change: unknown) => unknown;
  table_format_structured_ref: (ref: unknown) => unknown;
  // Visibility
  table_compose_bitmaps: (bitmaps: unknown) => unknown;
  table_create_row_visibility: (bitmap: unknown) => unknown;
  table_all_visible: (count: unknown) => unknown;
  // Slicer
  table_toggle_slicer_value: (slicer: unknown, value: unknown) => unknown;
  table_select_slicer_values: (slicer: unknown, values: unknown) => unknown;
  table_clear_slicer_selection: (slicer: unknown) => unknown;
  table_select_all_slicer_values: (slicer: unknown, cache: unknown) => unknown;
  table_set_slicer_sort_order: (slicer: unknown, order: unknown) => unknown;
  table_slicer_to_filter_criteria: (slicer: unknown) => unknown;
  // Table model operations
  table_create_table: (
    name: unknown,
    sheet_id: unknown,
    range: unknown,
    header_values: unknown,
    id: unknown,
    style: unknown,
  ) => unknown;
  table_resize_table: (table: unknown, new_range: unknown) => unknown;
  table_add_column: (table: unknown, name: unknown, position: unknown) => unknown;
  table_remove_column: (table: unknown, column_id: unknown) => unknown;
  table_rename_column: (table: unknown, column_id: unknown, new_name: unknown) => unknown;
  table_set_totals_function: (table: unknown, column_id: unknown, func: unknown) => unknown;
  table_set_table_option: (table: unknown, option: unknown, value: unknown) => unknown;
  table_toggle_totals_row: (table: unknown) => unknown;
  table_get_data_range: (table: unknown) => unknown;
  table_get_header_range: (table: unknown) => unknown;
  table_get_totals_range: (table: unknown) => unknown;
  table_get_column_data_range: (table: unknown, column_id: unknown) => unknown;
  table_get_column_by_name: (table: unknown, name: unknown) => unknown;
  table_get_column_by_id: (table: unknown, id: unknown) => unknown;
  table_get_column_at_grid_col: (table: unknown, grid_col: unknown) => unknown;
  table_is_in_table: (table: unknown, row: unknown, col: unknown) => unknown;
  table_is_in_header_row: (table: unknown, row: unknown) => unknown;
  table_is_in_totals_row: (table: unknown, row: unknown) => unknown;
  table_is_in_data_range: (table: unknown, row: unknown, col: unknown) => unknown;
  table_validate_table_name: (name: unknown, existing_names: unknown) => unknown;
  table_generate_table_name: (existing_names: unknown) => unknown;
  table_ranges_overlap: (a: unknown, b: unknown) => unknown;
  table_get_totals_formula: (func: unknown, column_name: unknown) => unknown;
  // Compare / value identity
  table_compare_values: (a: unknown, b: unknown) => unknown;
  table_cell_value_key: (value: unknown) => unknown;
  table_cell_values_equal: (a: unknown, b: unknown) => unknown;
  table_value_in_list: (value: unknown, list: unknown) => unknown;
  table_format_cell_display: (value: unknown) => unknown;
}

let wasmExports: TableWasmExports | null = null;

/**
 * Initialize the WASM backend for table-engine.
 * Must be called after the WASM module is loaded (typically by the kernel).
 */
export function initTableWasm(exports: TableWasmExports): void {
  wasmExports = exports;
}

/**
 * Get the WASM exports. Throws if not initialized.
 * @internal
 */
export function getWasm(): TableWasmExports {
  if (!wasmExports) {
    throw new Error(
      '[table-engine] WASM not initialized. Call initTableWasm() after loading @mog-sdk/wasm.',
    );
  }
  return wasmExports;
}

/**
 * Check if WASM backend is available.
 */
export function hasWasm(): boolean {
  return wasmExports !== null;
}
