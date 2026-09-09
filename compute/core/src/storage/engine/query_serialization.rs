//! JSON serialization helpers for query bridge payloads.

use crate::mirror::CellMirror;
use cell_types::SheetId;
use value_types::CellValue;

/// Convert a CellValue to a JSON representation.
pub(in crate::storage::engine) fn cell_value_to_json(value: &CellValue) -> serde_json::Value {
    match value {
        CellValue::Null => serde_json::json!({ "type": "null" }),
        CellValue::Number(n) => serde_json::json!({ "type": "number", "value": n.get() }),
        CellValue::Text(s) => serde_json::json!({ "type": "text", "value": s.to_string() }),
        CellValue::Boolean(b) => serde_json::json!({ "type": "boolean", "value": *b }),
        CellValue::Error(e, _) => serde_json::json!({ "type": "error", "value": e.as_str() }),
        CellValue::Array(_) => serde_json::json!({ "type": "array" }),
        CellValue::Control(c) => serde_json::json!({ "type": "boolean", "value": c.value }),
        CellValue::Image(image) => serde_json::json!({
            "type": "image",
            "source": image.source.as_ref(),
            "altText": image.alt_text.as_deref(),
            "sizing": image.sizing,
            "height": image.height,
            "width": image.width,
        }),
    }
}

/// Build the `region` JSON value for a cell at `(sheet, row, col)` by
/// composing `mirror.cell_render_at(...)`. Returns `null` when the cell is
/// not part of any region (CSE, dynamic-array spill, Data Table; future
/// pivot / table column / etc.).
///
/// **D4 chokepoint.** This is the read path used by the kernel API
/// `cells.getData(...)` to surface region membership to the formula bar
/// and devtools probes. Mirrors the projection arm of
/// `viewport::functions::get_active_cell` so the wire shape is identical
/// regardless of which read entry consumers use.
pub(in crate::storage::engine) fn region_json(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> serde_json::Value {
    let region_meta: Option<crate::storage::properties::RegionMeta> =
        match mirror.cell_render_at(sheet_id, row, col) {
            crate::projection::CellRender::Projection(view) => {
                let kind = if view.is_cse {
                    crate::storage::properties::RegionKind::CseArray
                } else {
                    crate::storage::properties::RegionKind::ArraySpill
                };
                let bounds = mirror
                    .projection_registry
                    .get(&view.anchor_id)
                    .map(|p| crate::storage::properties::RegionBounds {
                        rows: p.rows,
                        cols: p.cols,
                    })
                    .unwrap_or(crate::storage::properties::RegionBounds { rows: 1, cols: 1 });
                let is_anchor = row == view.anchor_row && col == view.anchor_col;
                Some(crate::storage::properties::RegionMeta {
                    kind,
                    is_anchor,
                    anchor_row: view.anchor_row,
                    anchor_col: view.anchor_col,
                    bounds,
                })
            }
            crate::projection::CellRender::Plain(plain) => plain.region.map(|r| {
                let kind = match r.kind {
                    crate::projection::RegionKind::DataTable => {
                        crate::storage::properties::RegionKind::DataTable
                    }
                };
                crate::storage::properties::RegionMeta {
                    kind,
                    is_anchor: r.is_anchor,
                    anchor_row: r.anchor_row,
                    anchor_col: r.anchor_col,
                    bounds: crate::storage::properties::RegionBounds {
                        rows: r.rows,
                        cols: r.cols,
                    },
                }
            }),
            crate::projection::CellRender::Materialized(_) => None,
            crate::projection::CellRender::Empty => None,
        };

    match region_meta {
        Some(rm) => serde_json::to_value(rm).unwrap_or(serde_json::Value::Null),
        None => serde_json::Value::Null,
    }
}
