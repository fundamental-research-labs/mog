//! Binary viewport rendering: builds [`ViewportRenderData`] for the binary transfer protocol.
//!
//! This module provides `build_viewport_render_data`, which produces lean, binary-friendly output
//! with format deduplication via [`FormatPalette`].
//!
//! Reads from `grid_indexes` + ComputeCore (authoritative), NOT the CRDT mirror.

use cell_types::SheetId;
use value_types::Color;

use crate::storage::engine::YrsComputeEngine;
use compute_wire::ViewportRenderData;

// =============================================================================
// Color conversion helper
// =============================================================================

/// Pack a `Color` (R, G, B, A) into a u32 in RGBA order: 0xRRGGBBAA.
#[inline]
pub(crate) fn color_to_u32(color: &Color) -> u32 {
    (color.r() as u32) << 24
        | (color.g() as u32) << 16
        | (color.b() as u32) << 8
        | (color.a() as u32)
}

impl YrsComputeEngine {
    /// Build lean viewport render data for the binary transfer protocol.
    pub fn build_viewport_render_data(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    ) -> ViewportRenderData {
        self.build_viewport_render_data_inner(
            sheet_id, start_row, start_col, end_row, end_col, 0, false,
        )
    }

    /// Build viewport render data with `show_formulas` support.
    pub(crate) fn build_viewport_render_data_show_formulas(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        show_formulas: bool,
    ) -> ViewportRenderData {
        self.build_viewport_render_data_inner(
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            0,
            show_formulas,
        )
    }

    /// Build viewport render data, slicing the format palette from `palette_start_index`.
    #[allow(dead_code)]
    pub(crate) fn build_viewport_render_data_with_palette_start(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        palette_start_index: u16,
    ) -> ViewportRenderData {
        self.build_viewport_render_data_inner(
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            palette_start_index,
            false,
        )
    }

    /// Core viewport render data builder — delegates to the free function in `functions.rs`.
    ///
    /// Takes `&self`; palette access goes through `ViewportService`'s
    /// interior-mutable `format_palettes` map. The palette `RefMut` guard is
    /// held for the duration of the inner build call — nothing else in the
    /// engine concurrently touches the palette map on the same thread, and
    /// the engine is single-threaded by construction (dispatch loop).
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn build_viewport_render_data_inner(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        palette_start_index: u16,
        show_formulas: bool,
    ) -> ViewportRenderData {
        let mut palettes = self.viewport.format_palettes_mut();
        let palette = palettes.entry(*sheet_id).or_default();
        let cf_cache_entry = self.stores.cf_cache.get(sheet_id);
        let mirror = &self.mirror;
        let resolve_table_format =
            |sid: &SheetId, row: u32, col: u32| -> Option<domain_types::CellFormat> {
                crate::storage::engine::services::tables::resolve_table_format_at_cell(
                    mirror, sid, row, col,
                )
            };
        super::functions::build_viewport_render_data_inner(
            &self.stores,
            &self.mirror,
            &self.settings,
            palette,
            cf_cache_entry,
            sheet_id,
            start_row,
            start_col,
            end_row,
            end_col,
            palette_start_index,
            show_formulas,
            &resolve_table_format,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use compute_wire::flags as render_flags;
    use value_types::FiniteF64;

    /// Helper: create a minimal engine from a snapshot with one sheet.
    fn make_test_engine() -> (YrsComputeEngine, SheetId) {
        use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
        use value_types::CellValue;

        let sheet_id_str = "00000000-0000-0000-0000-000000000001";
        let cell_id_str = "00000000-0000-0000-0000-000000000010";

        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id_str.to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
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

        let (engine, _recalc) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_id_str).unwrap();
        (engine, sheet_id)
    }

    #[test]
    fn build_viewport_render_data_dense_row_major() {
        let (mut engine, sheet_id) = make_test_engine();

        // Request a 3x3 viewport starting at (0,0)
        let data = engine.build_viewport_render_data(&sheet_id, 0, 0, 3, 3);

        // Dense: should have exactly 3*3 = 9 cells
        assert_eq!(data.cells.len(), 9);
        assert_eq!(data.viewport_rows, 3);
        assert_eq!(data.viewport_cols, 3);
        assert_eq!(data.start_row, 0);
        assert_eq!(data.start_col, 0);

        // First cell (0,0) should have the value 42.0
        let c00 = &data.cells[0];
        assert_eq!(c00.row, 0);
        assert_eq!(c00.col, 0);
        assert_eq!(
            c00.flags & render_flags::VALUE_TYPE_MASK,
            render_flags::VALUE_TYPE_NUMBER
        );
        assert!((c00.number_value - 42.0).abs() < f64::EPSILON);
        assert!(c00.formatted.is_some());

        // Cell (0,1) should be null (empty)
        let c01 = &data.cells[1];
        assert_eq!(c01.row, 0);
        assert_eq!(c01.col, 1);
        assert_eq!(
            c01.flags & render_flags::VALUE_TYPE_MASK,
            render_flags::VALUE_TYPE_NULL
        );
        assert!(c01.number_value.is_nan());

        // Format palette should have at least 1 entry (the default format)
        assert!(!data.format_palette.is_empty());
    }

    #[test]
    fn build_viewport_render_data_format_dedup() {
        let (mut engine, sheet_id) = make_test_engine();

        // Two calls should reuse the same palette (append-only)
        let data1 = engine.build_viewport_render_data(&sheet_id, 0, 0, 2, 2);
        let palette_len_1 = data1.format_palette.len();

        let data2 = engine.build_viewport_render_data(&sheet_id, 0, 0, 2, 2);
        let palette_len_2 = data2.format_palette.len();

        // Same formats, so palette should not grow
        assert_eq!(palette_len_1, palette_len_2);
    }

    #[test]
    fn build_viewport_render_data_empty_sheet() {
        use crate::snapshot::{CellData, SheetSnapshot, WorkbookSnapshot};
        use value_types::CellValue;

        let sheet_id_str = "00000000-0000-0000-0000-000000000002";
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id_str.to_string(),
                name: "Empty".to_string(),
                rows: 100,
                cols: 26,
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

        let data = engine.build_viewport_render_data(&sheet_id, 0, 0, 5, 5);

        // All 25 cells should be null
        assert_eq!(data.cells.len(), 25);
        for cell in &data.cells {
            assert_eq!(
                cell.flags & render_flags::VALUE_TYPE_MASK,
                render_flags::VALUE_TYPE_NULL
            );
            assert!(cell.number_value.is_nan());
        }
    }

    /// Helper: create an empty engine + sheet for projection-flag tests.
    fn make_empty_engine() -> (YrsComputeEngine, SheetId) {
        use crate::snapshot::{SheetSnapshot, WorkbookSnapshot};

        let sheet_id_str = "00000000-0000-0000-0000-000000000001";
        let snapshot = WorkbookSnapshot {
            sheets: vec![SheetSnapshot {
                id: sheet_id_str.to_string(),
                name: "Sheet1".to_string(),
                rows: 100,
                cols: 26,
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

        let (engine, _recalc) = YrsComputeEngine::from_snapshot(snapshot).unwrap();
        let sheet_id = SheetId::from_uuid_str(sheet_id_str).unwrap();
        (engine, sheet_id)
    }

    /// Dynamic-array spill (e.g. `=SEQUENCE(3)`): only the anchor owns
    /// formula text. Non-anchor projection members carry `IS_SPILL_MEMBER`
    /// without `HAS_FORMULA`.
    #[test]
    fn dynamic_array_spill_has_formula_only_on_anchor() {
        use crate::storage::engine::mutation::CellInput;
        use cell_types::CellId;

        let (mut engine, sheet_id) = make_empty_engine();
        let a1_id = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();

        // Set A1 = SEQUENCE(3) — spills to A1, A2, A3.
        engine
            .set_cell(
                &sheet_id,
                a1_id,
                0,
                0,
                CellInput::Parse {
                    text: "=SEQUENCE(3)".to_string(),
                },
            )
            .expect("set_cell SEQUENCE(3)");

        let data = engine.build_viewport_render_data(&sheet_id, 0, 0, 5, 5);
        let cell_at = |row: u32, col: u32| {
            data.cells
                .iter()
                .find(|c| c.row == row && c.col == col)
                .expect("cell present in viewport")
        };

        // Anchor (A1, row 0): HAS_FORMULA set, IS_SPILL_MEMBER not set.
        let a1 = cell_at(0, 0);
        assert!(
            a1.flags & render_flags::HAS_FORMULA != 0,
            "anchor must carry HAS_FORMULA (flags={:#x})",
            a1.flags
        );
        assert!(
            a1.flags & render_flags::IS_SPILL_MEMBER == 0,
            "anchor must NOT carry IS_SPILL_MEMBER (flags={:#x})",
            a1.flags
        );

        // Members (A2, A3): projected values, not formula owners.
        for row in 1..=2u32 {
            let m = cell_at(row, 0);
            assert!(
                m.flags & render_flags::IS_SPILL_MEMBER != 0,
                "member ({},0) must carry IS_SPILL_MEMBER (flags={:#x})",
                row,
                m.flags
            );
            assert!(
                m.flags & render_flags::HAS_FORMULA == 0,
                "dynamic-spill member ({},0) must NOT carry HAS_FORMULA \
                 (flags={:#x})",
                row,
                m.flags
            );
        }
    }

    /// CSE (Ctrl+Shift+Enter) array formula: the user explicitly entered the
    /// formula across the whole rectangle, so every member belongs to the
    /// formula. Anchor + members all carry `HAS_FORMULA`; members
    /// additionally carry `IS_SPILL_MEMBER` so the renderer can draw the
    /// outline only around the rectangle.
    #[test]
    fn cse_array_has_formula_on_all_members() {
        use cell_types::CellId;

        let (mut engine, sheet_id) = make_empty_engine();
        let a1_id = CellId::from_uuid_str("00000000-0000-0000-0000-000000000010").unwrap();
        let _ = a1_id; // CellId is allocated implicitly inside set_array_formula.

        // CSE-enter `=SEQUENCE(2,3)` over A1:C2 (2 rows × 3 cols).
        engine
            .set_array_formula(&sheet_id, 0, 0, 1, 2, "=SEQUENCE(2,3)".to_string())
            .expect("set_array_formula SEQUENCE(2,3)");

        let data = engine.build_viewport_render_data(&sheet_id, 0, 0, 5, 5);
        let cell_at = |row: u32, col: u32| {
            data.cells
                .iter()
                .find(|c| c.row == row && c.col == col)
                .expect("cell present in viewport")
        };

        // Every cell in A1:C2 must carry HAS_FORMULA.
        for row in 0..=1u32 {
            for col in 0..=2u32 {
                let c = cell_at(row, col);
                assert!(
                    c.flags & render_flags::HAS_FORMULA != 0,
                    "CSE member ({},{}) must carry HAS_FORMULA (flags={:#x})",
                    row,
                    col,
                    c.flags
                );
                let is_anchor = row == 0 && col == 0;
                if is_anchor {
                    assert!(
                        c.flags & render_flags::IS_SPILL_MEMBER == 0,
                        "CSE anchor must NOT carry IS_SPILL_MEMBER \
                         (flags={:#x})",
                        c.flags
                    );
                } else {
                    assert!(
                        c.flags & render_flags::IS_SPILL_MEMBER != 0,
                        "CSE member ({},{}) must carry IS_SPILL_MEMBER \
                         (flags={:#x})",
                        row,
                        col,
                        c.flags
                    );
                }
            }
        }
    }
}
