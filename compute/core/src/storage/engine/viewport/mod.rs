//! Viewport module — consolidated viewport rendering, registration, patches,
//! and service logic for `YrsComputeEngine`.

mod functions;
mod patches;
mod registry;
mod render;
pub(crate) mod service;

// Re-export render helper used by other engine modules
// Re-export CF merge helpers used by formatting endpoints and the viewport pipeline.
pub(crate) use functions::{apply_cf_to_format, apply_number_format_color, merge_cf_into_format};

use crate::snapshot::{ActiveCellData, MutationResult, SelectionAggregates};
use crate::storage::engine::YrsComputeEngine;
use crate::storage::sheet::merges;
use bridge_core as bridge;
use cell_types::{CellId, SheetId};
use compute_wire::ViewportBounds;
use compute_wire::viewport as viewport_binary;
use value_types::CellValue;
use value_types::ComputeError;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "viewport",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    /// Get full data for the active cell (for toolbar/formula bar display).
    #[bridge::skip(ts_bridge)]
    #[bridge::read(scope = "sheet")]
    pub fn get_active_cell(&self, sheet_id: &SheetId, cell_id: &CellId) -> ActiveCellData {
        let is_sheet_protected = self.is_sheet_protected(sheet_id);
        functions::get_active_cell(
            &self.stores,
            &self.mirror,
            &self.settings,
            sheet_id,
            cell_id,
            is_sheet_protected,
        )
    }

    /// Get the formula string for a cell (returns None if no formula).
    /// Delegation to `ComputeCore::get_formula` for bridge generation.
    #[bridge::read(scope = "workbook")]
    pub fn get_formula(&self, cell_id: &CellId) -> Option<String> {
        self.stores
            .compute
            .get_formula(cell_id)
            .map(|s| s.to_string())
    }

    /// Compute aggregates (SUM, COUNT, AVG, MIN, MAX) for the given cell ranges.
    /// Used for the status bar display.
    #[bridge::read(scope = "sheet")]
    pub fn get_selection_aggregates(
        &self,
        sheet_id: &SheetId,
        ranges: &[(u32, u32, u32, u32)], // Vec of (start_row, start_col, end_row, end_col)
    ) -> SelectionAggregates {
        let mirror = &self.mirror;
        let mut sum = 0.0_f64;
        let mut count = 0_u64;
        let mut numeric_count = 0_u64;
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;

        if let Some(grid) = self.stores.grid_indexes.get(sheet_id) {
            // Build merge child→origin lookup for aggregation
            let merge_origins: std::collections::HashMap<(u32, u32), (u32, u32)> = {
                let all_merges = merges::get_all_merges(
                    self.stores.storage.doc(),
                    self.stores.storage.sheets(),
                    *sheet_id,
                    grid,
                );
                let mut map = std::collections::HashMap::new();
                for m in &all_merges {
                    let origin = (m.start_row, m.start_col);
                    for r in m.start_row..=m.end_row {
                        for c in m.start_col..=m.end_col {
                            if (r, c) != origin {
                                map.insert((r, c), origin);
                            }
                        }
                    }
                }
                map
            };

            for &(sr, sc, er, ec) in ranges {
                for row in sr..=er {
                    for col in sc..=ec {
                        // Skip merge child cells — merged region counts as one cell
                        if merge_origins.contains_key(&(row, col)) {
                            continue;
                        }

                        if let Some(cell_id) = grid.cell_id_at(row, col) {
                            // ComputeCore-first value read, mirror fallback (zero-clone)
                            let mirror_val;
                            let value: &CellValue = if let Some(v) =
                                self.stores.compute.get_cell_value(&self.mirror, &cell_id)
                            {
                                v
                            } else {
                                mirror_val = mirror.get_cell_value_in_sheet(sheet_id, &cell_id);
                                match mirror_val {
                                    Some(v) => v,
                                    None => &CellValue::Null,
                                }
                            };

                            match value {
                                CellValue::Null => {}
                                CellValue::Number(n) => {
                                    count += 1;
                                    numeric_count += 1;
                                    sum += n.get();
                                    if n.get() < min {
                                        min = n.get();
                                    }
                                    if n.get() > max {
                                        max = n.get();
                                    }
                                }
                                CellValue::Boolean(_) => {
                                    count += 1;
                                }
                                CellValue::Text(s) if s.is_empty() => {}
                                _ => {
                                    count += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        // `sum` may have overflowed to ±∞ during accumulation — `FiniteF64::new`
        // maps that to `None`, which is the correct boundary signal.
        let sum = value_types::FiniteF64::new(sum);
        // `average` divides finite sum by positive count; only the overflowed-sum
        // case can produce ±∞, which `FiniteF64::new` handles.
        let average = if numeric_count > 0 {
            value_types::FiniteF64::new(
                sum.map(|v| v.get()).unwrap_or(f64::INFINITY) / numeric_count as f64,
            )
        } else {
            None
        };
        // The sentinels (±∞ before the inner check) are mapped to `None` *before*
        // wrapping, so the inner reaching `must` is by definition finite.
        let min = if min == f64::INFINITY {
            None
        } else {
            Some(value_types::FiniteF64::must(min))
        };
        let max = if max == f64::NEG_INFINITY {
            None
        } else {
            Some(value_types::FiniteF64::must(max))
        };

        SelectionAggregates {
            sum,
            count,
            numeric_count,
            average,
            min,
            max,
        }
    }

    // -------------------------------------------------------------------
    // Format helpers (use engine's cached locale)
    // -------------------------------------------------------------------

    /// Parse a date string using the workbook's locale conventions.
    #[bridge::read(scope = "workbook")]
    pub fn parse_date_input(&self, text: &str) -> Option<compute_formats::ParsedDateInput> {
        functions::parse_date_input(&self.settings, text)
    }

    /// Format a batch of cell values using format codes and the workbook's locale.
    #[bridge::read(scope = "workbook")]
    pub fn format_values(&self, entries: Vec<compute_formats::FormatEntry>) -> Vec<String> {
        functions::format_values(&self.settings, entries)
    }

    /// Binary viewport transfer — returns raw bytes for zero-copy TS consumption.
    ///
    /// The bridge handles `Vec<u8>` as direct byte transfer:
    ///   - Tauri: raw bytes via IPC (near zero-copy)
    ///   - WASM: wasm-bindgen does single memcpy to `Uint8Array`
    ///
    /// Uses the viewport registry to track state. A synthetic viewport key
    /// is derived from the sheet_id for backward compatibility with callers
    /// that don't yet provide an explicit viewport_id.
    ///
    /// Annotated `#[bridge::read(scope = "sheet")]` so the gated delegate
    /// routes the result through `filter_viewport_buffer` before handing it
    /// to the caller (ARCHITECTURE.md §7). Viewport registry + palette
    /// accumulation are observational caches implemented on `RefCell` inside
    /// `ViewportService`, so the method takes `&self` despite updating the
    /// registry.
    #[bridge::read(scope = "sheet")]
    pub fn get_viewport_binary(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        show_formulas: bool,
    ) -> Vec<u8> {
        let render_data = self.build_viewport_render_data_show_formulas(
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            show_formulas,
        );

        // Update viewport registration for future delta requests
        let palette_len = self
            .viewport
            .format_palettes()
            .get(sheet_id)
            .map(|p| p.len() as u16)
            .unwrap_or(0);
        let vp_key = functions::viewport_key_for_sheet(sheet_id);
        let mut regs = self.viewport.registered_viewports_mut();
        let reg = regs.entry(vp_key).or_insert(service::ViewportRegistration {
            sheet_id: *sheet_id,
            bounds: ViewportBounds {
                start_row,
                start_col,
                end_row,
                end_col,
            },
            palette_len: 0,
        });
        reg.bounds = ViewportBounds {
            start_row,
            start_col,
            end_row,
            end_col,
        };
        reg.palette_len = palette_len;
        drop(regs);

        viewport_binary::serialize_viewport_binary(&render_data, 0, false, 0)
    }

    /// Delta binary viewport transfer — returns only the new strip of cells.
    ///
    /// When scrolling past the prefetch edge, this method computes the delta
    /// region (new cells not in the previous viewport) and returns a compact
    /// binary buffer for just that strip. The TS side merges this with its
    /// existing buffer.
    ///
    /// If there's no overlap with the previous viewport (e.g., first request
    /// or large jump), falls back to a full response with `is_delta=false`.
    ///
    /// Annotated `#[bridge::read(scope = "sheet")]` — registry/palette writes
    /// here are observational; see the note on `get_viewport_binary`.
    #[bridge::read(scope = "sheet")]
    pub fn get_viewport_binary_delta(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        show_formulas: bool,
    ) -> Vec<u8> {
        let vp_key = functions::viewport_key_for_sheet(sheet_id);

        // Extract previous state from registration (copy out to release borrow on self)
        let prev = {
            let regs = self.viewport.registered_viewports();
            match regs.get(&vp_key) {
                Some(r) => (Some(r.bounds), r.palette_len),
                None => (None, 0),
            }
        };

        if let Some(prev_bounds) = prev.0 {
            let (pr1, pc1, pr2, pc2) = (
                prev_bounds.start_row,
                prev_bounds.start_col,
                prev_bounds.end_row,
                prev_bounds.end_col,
            );
            // Check for overlap between previous and new bounds
            // (using exclusive end coordinates, as used by build_viewport_render_data)
            if start_row < pr2 && end_row > pr1 && start_col < pc2 && end_col > pc1 {
                // Compute the delta strip: the bounding rectangle of the non-overlapping region.
                let (dr1, dc1, dr2, dc2) =
                    compute_delta_strip(start_row, start_col, end_row, end_col, pr1, pc1, pr2, pc2);

                // If the delta strip is non-empty, build and return a delta response
                if dr1 < dr2 && dc1 < dc2 {
                    let palette_start = prev.1;

                    let render_data = self.build_viewport_render_data_inner(
                        sheet_id,
                        dr1,
                        dc1,
                        dr2,
                        dc2,
                        palette_start,
                        show_formulas,
                    );

                    // Update registration after render (palette may have grown)
                    let palette_len = self
                        .viewport
                        .format_palettes()
                        .get(sheet_id)
                        .map(|p| p.len() as u16)
                        .unwrap_or(0);
                    if let Some(reg) = self.viewport.registered_viewports_mut().get_mut(&vp_key) {
                        reg.bounds = ViewportBounds {
                            start_row,
                            start_col,
                            end_row,
                            end_col,
                        };
                        reg.palette_len = palette_len;
                    }

                    return viewport_binary::serialize_viewport_binary(
                        &render_data,
                        0,
                        true,
                        palette_start,
                    );
                }
            }
        }

        // No overlap, first request, or empty delta — full refresh
        let render_data = self.build_viewport_render_data_show_formulas(
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            show_formulas,
        );

        let palette_len = self
            .viewport
            .format_palettes()
            .get(sheet_id)
            .map(|p| p.len() as u16)
            .unwrap_or(0);
        let mut regs = self.viewport.registered_viewports_mut();
        let reg = regs.entry(vp_key).or_insert(service::ViewportRegistration {
            sheet_id: *sheet_id,
            bounds: ViewportBounds {
                start_row,
                start_col,
                end_row,
                end_col,
            },
            palette_len: 0,
        });
        reg.bounds = ViewportBounds {
            start_row,
            start_col,
            end_row,
            end_col,
        };
        reg.palette_len = palette_len;
        drop(regs);

        viewport_binary::serialize_viewport_binary(&render_data, 0, false, 0)
    }

    /// Reset viewport state for a sheet (call on sheet switch or major recalc).
    ///
    /// Delegates to `reset_sheet_viewports` which removes all viewports for
    /// this sheet from the registry.
    #[bridge::write(scope = "sheet")]
    pub fn reset_viewport_state(
        &mut self,
        sheet_id: &SheetId,
    ) -> Result<(Vec<u8>, MutationResult), ComputeError> {
        let result = functions::reset_viewport_state(&self.viewport, sheet_id)?;
        Ok((
            compute_wire::mutation::serialize_multi_viewport_patches(&[]),
            result,
        ))
    }
}

// Removed: unused convenience wrapper `viewport_key_for_sheet` —
// callers use `functions::viewport_key_for_sheet` directly.

// ---------------------------------------------------------------------------
// Delta strip computation (free function, outside the bridge impl block)
// ---------------------------------------------------------------------------

/// Compute the bounding rectangle of the new region that doesn't overlap with
/// the previous viewport.
///
/// For a simple directional scroll, this returns the exact new strip:
///   - Scroll down:  new rows at the bottom
///   - Scroll right: new columns on the right
///   - Scroll up:    new rows at the top
///   - Scroll left:  new columns on the left
///
/// For a diagonal scroll, returns the bounding rectangle of the L-shaped new
/// region (may include some overlap, which is acceptable).
///
/// All coordinates use exclusive end bounds (consistent with build_viewport_render_data).
#[allow(clippy::too_many_arguments)]
fn compute_delta_strip(
    // New bounds
    nr1: u32,
    nc1: u32,
    nr2: u32,
    nc2: u32,
    // Previous bounds
    pr1: u32,
    pc1: u32,
    pr2: u32,
    pc2: u32,
) -> (u32, u32, u32, u32) {
    // Check which directions have new content
    let has_new_rows_top = nr1 < pr1;
    let has_new_rows_bottom = nr2 > pr2;
    let has_new_cols_left = nc1 < pc1;
    let has_new_cols_right = nc2 > pc2;

    // Simple directional scrolls: return just the strip
    match (
        has_new_rows_top,
        has_new_rows_bottom,
        has_new_cols_left,
        has_new_cols_right,
    ) {
        // Scroll down only: new rows at bottom, full column range
        (false, true, false, false) => (pr2, nc1, nr2, nc2),
        // Scroll up only: new rows at top, full column range
        (true, false, false, false) => (nr1, nc1, pr1, nc2),
        // Scroll right only: new columns on right, full row range
        (false, false, false, true) => (nr1, pc2, nr2, nc2),
        // Scroll left only: new columns on left, full row range
        (false, false, true, false) => (nr1, nc1, nr2, pc1),
        // Diagonal or multi-direction: use bounding rectangle of all new area
        _ => {
            // The bounding rectangle of the L-shaped region is the full new bounds
            // minus the overlap. Since we can't represent an L-shape as a single
            // rectangle, we return the full new bounds. Some cells will be redundant
            // (already in the old buffer), but this keeps the logic simple.
            (nr1, nc1, nr2, nc2)
        }
    }
}

#[cfg(test)]
mod delta_tests {
    use super::*;

    #[test]
    fn test_delta_strip_scroll_down() {
        // Previous: rows 0..100, cols 0..20
        // New:      rows 50..150, cols 0..20
        // Delta:    rows 100..150, cols 0..20
        let (r1, c1, r2, c2) = compute_delta_strip(50, 0, 150, 20, 0, 0, 100, 20);
        assert_eq!((r1, c1, r2, c2), (100, 0, 150, 20));
    }

    #[test]
    fn test_delta_strip_scroll_up() {
        // Previous: rows 50..150, cols 0..20
        // New:      rows 0..100, cols 0..20
        // Delta:    rows 0..50, cols 0..20
        let (r1, c1, r2, c2) = compute_delta_strip(0, 0, 100, 20, 50, 0, 150, 20);
        assert_eq!((r1, c1, r2, c2), (0, 0, 50, 20));
    }

    #[test]
    fn test_delta_strip_scroll_right() {
        // Previous: rows 0..50, cols 0..20
        // New:      rows 0..50, cols 10..30
        // Delta:    rows 0..50, cols 20..30
        let (r1, c1, r2, c2) = compute_delta_strip(0, 10, 50, 30, 0, 0, 50, 20);
        assert_eq!((r1, c1, r2, c2), (0, 20, 50, 30));
    }

    #[test]
    fn test_delta_strip_scroll_left() {
        // Previous: rows 0..50, cols 10..30
        // New:      rows 0..50, cols 0..20
        // Delta:    rows 0..50, cols 0..10
        let (r1, c1, r2, c2) = compute_delta_strip(0, 0, 50, 20, 0, 10, 50, 30);
        assert_eq!((r1, c1, r2, c2), (0, 0, 50, 10));
    }

    #[test]
    fn test_delta_strip_diagonal_fallback() {
        // Previous: rows 0..100, cols 0..20
        // New:      rows 50..150, cols 10..30
        // Diagonal: returns full new bounds
        let (r1, c1, r2, c2) = compute_delta_strip(50, 10, 150, 30, 0, 0, 100, 20);
        assert_eq!((r1, c1, r2, c2), (50, 10, 150, 30));
    }

    #[test]
    fn test_delta_strip_no_new_rows_or_cols() {
        // New is subset of old: all directions are false
        // Previous: rows 0..100, cols 0..20
        // New:      rows 10..90, cols 5..15
        // No new content in any direction — fallback to full bounds
        let (r1, c1, r2, c2) = compute_delta_strip(10, 5, 90, 15, 0, 0, 100, 20);
        assert_eq!((r1, c1, r2, c2), (10, 5, 90, 15));
    }

    /// Test the full delta pipeline via the engine.
    #[test]
    fn test_get_viewport_binary_delta_first_call_is_full() {
        use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
        use cell_types::SheetId;
        use value_types::FiniteF64;

        let sheet_id_str = "00000000-0000-0000-0000-000000000001";
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id_str.to_string(),
                name: "Sheet1".to_string(),
                rows: 200,
                cols: 30,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };

        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_id_str).unwrap();

        // First call: should be a full response (is_delta = false)
        let buf = engine.get_viewport_binary_delta(&sheet_id, 0, 0, 50, 20, false);
        assert!(!buf.is_empty());
        // Check flags byte (offset 30): bit 0 should be 0 (not delta)
        assert_eq!(buf[30] & 0x01, 0);
    }

    #[test]
    fn test_get_viewport_binary_delta_scroll_down_is_delta() {
        use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
        use cell_types::SheetId;

        let sheet_id_str = "00000000-0000-0000-0000-000000000001";
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id_str.to_string(),
                name: "Sheet1".to_string(),
                rows: 200,
                cols: 30,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };

        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_id_str).unwrap();

        // First call to establish state
        let _ = engine.get_viewport_binary_delta(&sheet_id, 0, 0, 50, 20, false);

        // Scroll down: overlapping region
        let buf = engine.get_viewport_binary_delta(&sheet_id, 30, 0, 80, 20, false);
        assert!(!buf.is_empty());
        // Should be a delta response
        assert_eq!(buf[30] & 0x01, 1, "Expected delta flag to be set");

        // Delta should cover rows 50..80 (the new strip), cols 0..20
        let start_row = u32::from_le_bytes(buf[0..4].try_into().unwrap());
        let start_col = u32::from_le_bytes(buf[4..8].try_into().unwrap());
        let viewport_rows = u16::from_le_bytes(buf[20..22].try_into().unwrap());
        let viewport_cols = u16::from_le_bytes(buf[22..24].try_into().unwrap());
        assert_eq!(start_row, 50);
        assert_eq!(start_col, 0);
        assert_eq!(viewport_rows, 30); // 80 - 50 = 30
        assert_eq!(viewport_cols, 20);
    }

    #[test]
    fn test_get_viewport_binary_delta_no_overlap_is_full() {
        use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};
        use cell_types::SheetId;

        let sheet_id_str = "00000000-0000-0000-0000-000000000001";
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id_str.to_string(),
                name: "Sheet1".to_string(),
                rows: 500,
                cols: 30,
                cells: vec![],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };

        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_id_str).unwrap();

        // First call
        let _ = engine.get_viewport_binary_delta(&sheet_id, 0, 0, 50, 20, false);

        // Jump to a completely non-overlapping region
        let buf = engine.get_viewport_binary_delta(&sheet_id, 200, 0, 250, 20, false);
        // Should be a full response (no overlap)
        assert_eq!(
            buf[30] & 0x01,
            0,
            "Expected full response for non-overlapping jump"
        );
    }

    #[test]
    fn test_get_viewport_binary_delta_palette_start_index() {
        use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
        use cell_types::SheetId;
        use value_types::{CellValue, FiniteF64};

        let sheet_id_str = "00000000-0000-0000-0000-000000000001";
        let cell_id_str = "00000000-0000-0000-0000-000000000010";

        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id_str.to_string(),
                name: "Sheet1".to_string(),
                rows: 200,
                cols: 30,
                cells: vec![CellData {
                    cell_id: cell_id_str.to_string(),
                    row: 0,
                    col: 0,
                    value: CellValue::Number(FiniteF64::must(42.0)),
                    formula: None,
                    identity_formula: None,
                    array_ref: None,
                }],
                ranges: vec![],
            }],
            named_ranges: vec![],
            tables: vec![],
            pivot_tables: vec![],
            data_table_regions: vec![],
            iterative_calc: false,
            max_iterations: 100,
            max_change: value_types::FiniteF64::must(0.001),
            calculation_settings: None,
        };

        let (mut engine, _) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_id_str).unwrap();

        // Helper to extract palette from the binary buffer.
        // Layout: 36-byte header, then cells, string pool, merges, row dims, col dims, palette, ...
        let extract_palette = |buf: &[u8]| -> (u16, Vec<domain_types::CellFormat>) {
            let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
            let palette_len = u32::from_le_bytes(buf[12..16].try_into().unwrap()) as usize;
            let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
            let merge_count = u16::from_le_bytes(buf[24..26].try_into().unwrap()) as usize;
            let row_dim_count = u16::from_le_bytes(buf[26..28].try_into().unwrap()) as usize;
            let col_dim_count = u16::from_le_bytes(buf[28..30].try_into().unwrap()) as usize;
            let offset = 36
                + cell_count * 32
                + string_pool_bytes
                + merge_count * 16
                + row_dim_count * 12
                + col_dim_count * 12;
            compute_wire::deserialize_palette_binary(&buf[offset..offset + palette_len]).unwrap()
        };

        // First call — full response, palette starts at 0
        let buf1 = engine.get_viewport_binary_delta(&sheet_id, 0, 0, 50, 20, false);
        let (start_idx1, _) = extract_palette(&buf1);
        assert_eq!(start_idx1, 0);

        // Delta call — palette start_index should be > 0 (equals palette length from first call)
        let buf2 = engine.get_viewport_binary_delta(&sheet_id, 30, 0, 80, 20, false);
        if buf2[30] & 0x01 == 1 {
            let (start_idx2, _) = extract_palette(&buf2);
            assert!(start_idx2 > 0, "Delta palette start_index should be > 0");
        }
    }
}
