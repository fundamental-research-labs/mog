//! JSON serialization helpers for query bridge payloads.

use crate::mirror::CellMirror;
use crate::storage::cells::values as cell_values;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
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

/// Convert a CellData to a JSON representation.
pub(in crate::storage::engine) fn cell_data_to_json(
    data: &cell_values::CellData,
) -> serde_json::Value {
    let mut json = serde_json::json!({
        "cell_id": id_to_hex(data.cell_id.as_u128()),
        "row": data.row,
        "col": data.col,
    });

    if let Some(ref raw) = data.raw {
        json["raw"] = cell_value_to_json(raw);
    }
    if let Some(ref computed) = data.computed {
        json["computed"] = cell_value_to_json(computed);
    }
    if let Some(ref formula) = data.formula {
        json["formula"] = serde_json::Value::String(formula.clone());
    }
    if let Some(ref hyperlink) = data.hyperlink {
        json["hyperlink"] = serde_json::Value::String(hyperlink.clone());
    }
    if let Some(ref note) = data.note {
        json["note"] = serde_json::Value::String(note.clone());
    }

    json
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
