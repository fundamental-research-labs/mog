use cell_types::CellId;
use compute_document::hex::hex_to_id;
use compute_document::identity::GridIndex;
use compute_layout_index::LayoutIndex;
use snapshot_types::FloatingObjectBounds;

use super::keys::{
    KEY_ANCHOR_COL_OFFSET_EMU, KEY_ANCHOR_ROW_OFFSET_EMU, KEY_END_COL_OFFSET_EMU,
    KEY_END_ROW_OFFSET_EMU, KEY_EXTENT_CX_EMU, KEY_EXTENT_CY_EMU,
};
use super::units::emu_to_px;

pub fn compute_object_pixel_bounds(
    grid_index: Option<&GridIndex>,
    layout_index: Option<&LayoutIndex>,
    obj_json: &serde_json::Value,
) -> Option<FloatingObjectBounds> {
    let layout = layout_index?;

    // Support both nested (typed) and flat (legacy) JSON:
    // Typed: { "anchor": { "anchorMode": "oneCell", "anchorRow": 5, ... }, "width": 200, ... }
    // Flat:  { "anchorMode": "oneCell", "anchorRow": 5, "xOffset": 10, "width": 200, ... }
    let anchor_obj = obj_json.get("anchor");

    let anchor_mode = anchor_obj
        .and_then(|a| a.get("anchorMode"))
        .and_then(|v| v.as_str())
        .or_else(|| obj_json.get("anchorMode").and_then(|v| v.as_str()))
        .unwrap_or("oneCell");
    let rotation = obj_json
        .get("rotation")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    // Helper: read a field from nested anchor first, then fall back to top-level.
    let anchor_field = |key: &str| -> Option<f64> {
        anchor_obj
            .and_then(|a| a.get(key))
            .and_then(|v| v.as_f64())
            .or_else(|| obj_json.get(key).and_then(|v| v.as_f64()))
    };
    let anchor_field_aliased = |canonical: &str, legacy: &str| -> Option<f64> {
        anchor_field(canonical).or_else(|| anchor_field(legacy))
    };
    let _anchor_field_str = |key: &str| -> Option<&str> {
        anchor_obj
            .and_then(|a| a.get(key))
            .and_then(|v| v.as_str())
            .or_else(|| obj_json.get(key).and_then(|v| v.as_str()))
    };

    // Read col offset (anchorColOffsetEmu is persisted in EMUs; xOffset is legacy px input).
    let read_col_offset = || -> f64 {
        anchor_field_aliased(KEY_ANCHOR_COL_OFFSET_EMU, "anchorColOffset")
            .map(emu_to_px)
            .or_else(|| obj_json.get("xOffset").and_then(|v| v.as_f64()))
            .unwrap_or(0.0)
    };
    // Read row offset (anchorRowOffsetEmu is persisted in EMUs; yOffset is legacy px input).
    let read_row_offset = || -> f64 {
        anchor_field_aliased(KEY_ANCHOR_ROW_OFFSET_EMU, "anchorRowOffset")
            .map(emu_to_px)
            .or_else(|| obj_json.get("yOffset").and_then(|v| v.as_f64()))
            .unwrap_or(0.0)
    };

    /// Resolve anchor position from CellId or raw row/col, supporting both nested and flat JSON.
    fn resolve_anchor_pos(
        grid_index: Option<&GridIndex>,
        obj_json: &serde_json::Value,
        anchor_obj: Option<&serde_json::Value>,
        cell_id_key: &str,
        row_key: &str,
        col_key: &str,
    ) -> (usize, usize) {
        // Try CellId resolution first (top-level or nested)
        let cell_id_hex = obj_json
            .get(cell_id_key)
            .and_then(|v| v.as_str())
            .or_else(|| {
                anchor_obj
                    .and_then(|a| a.get(cell_id_key))
                    .and_then(|v| v.as_str())
            });
        if let (Some(grid), Some(hex)) = (grid_index, cell_id_hex)
            && let Some(raw_id) = hex_to_id(hex)
        {
            let cell_id = CellId::from_raw(raw_id);
            if let Some((row, col)) = grid.cell_position(&cell_id) {
                return (row as usize, col as usize);
            }
        }
        // Fall back to raw indices (nested anchor first, then top-level)
        let row = anchor_obj
            .and_then(|a| a.get(row_key))
            .and_then(|v| v.as_u64())
            .or_else(|| obj_json.get(row_key).and_then(|v| v.as_u64()))
            .unwrap_or(0) as usize;
        let col = anchor_obj
            .and_then(|a| a.get(col_key))
            .and_then(|v| v.as_u64())
            .or_else(|| obj_json.get(col_key).and_then(|v| v.as_u64()))
            .unwrap_or(0) as usize;
        (row, col)
    }

    match anchor_mode {
        "absolute" => {
            // Absolute anchors: x/y are already pixel coordinates
            let x = obj_json.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let y = obj_json.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let width = obj_json
                .get("width")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let height = obj_json
                .get("height")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            // All coordinates derive from layout/yrs storage which uses
            // pixel/CharWidth values that stay finite by construction.
            // `FiniteF64::must` documents the storage invariant.
            Some(FloatingObjectBounds {
                x: value_types::FiniteF64::must(x),
                y: value_types::FiniteF64::must(y),
                width: value_types::FiniteF64::must(width),
                height: value_types::FiniteF64::must(height),
                rotation: value_types::FiniteF64::must(rotation),
            })
        }
        "twoCell" => {
            // From anchor — resolve via CellId if available
            let (anchor_row, anchor_col) = resolve_anchor_pos(
                grid_index,
                obj_json,
                anchor_obj,
                "anchorCellId",
                "anchorRow",
                "anchorCol",
            );
            let col_offset = read_col_offset();
            let row_offset = read_row_offset();

            // To anchor — resolve via CellId if available
            let (to_row, to_col) = resolve_anchor_pos(
                grid_index,
                obj_json,
                anchor_obj,
                "toAnchorCellId",
                "endRow",
                "endCol",
            );
            let to_col_offset = anchor_field_aliased(KEY_END_COL_OFFSET_EMU, "endColOffset")
                .map(emu_to_px)
                .or_else(|| obj_json.get("toXOffset").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            let to_row_offset = anchor_field_aliased(KEY_END_ROW_OFFSET_EMU, "endRowOffset")
                .map(emu_to_px)
                .or_else(|| obj_json.get("toYOffset").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);

            let from_x = layout.get_col_position(anchor_col).0 + col_offset;
            let from_y = layout.get_row_position(anchor_row).0 + row_offset;
            let to_x = layout.get_col_position(to_col).0 + to_col_offset;
            let to_y = layout.get_row_position(to_row).0 + to_row_offset;

            Some(FloatingObjectBounds {
                x: value_types::FiniteF64::must(from_x),
                y: value_types::FiniteF64::must(from_y),
                width: value_types::FiniteF64::must((to_x - from_x).abs()),
                height: value_types::FiniteF64::must((to_y - from_y).abs()),
                rotation: value_types::FiniteF64::must(rotation),
            })
        }
        _ => {
            // oneCell (default): position from anchor + offset, explicit width/height
            // Resolve via CellId if available
            let (anchor_row, anchor_col) = resolve_anchor_pos(
                grid_index,
                obj_json,
                anchor_obj,
                "anchorCellId",
                "anchorRow",
                "anchorCol",
            );
            let col_offset = read_col_offset();
            let row_offset = read_row_offset();
            let width = anchor_field_aliased(KEY_EXTENT_CX_EMU, "extentCx")
                .map(emu_to_px)
                .or_else(|| obj_json.get("width").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);
            let height = anchor_field_aliased(KEY_EXTENT_CY_EMU, "extentCy")
                .map(emu_to_px)
                .or_else(|| obj_json.get("height").and_then(|v| v.as_f64()))
                .unwrap_or(0.0);

            let x = layout.get_col_position(anchor_col).0 + col_offset;
            let y = layout.get_row_position(anchor_row).0 + row_offset;

            Some(FloatingObjectBounds {
                x: value_types::FiniteF64::must(x),
                y: value_types::FiniteF64::must(y),
                width: value_types::FiniteF64::must(width),
                height: value_types::FiniteF64::must(height),
                rotation: value_types::FiniteF64::must(rotation),
            })
        }
    }
}

// =============================================================================
// Tests
