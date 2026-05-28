use crate::engine_types::floating_objects::CreateShapeConfig;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use compute_document::identity::GridIndex;
use compute_document::schema::KEY_FLOATING_OBJECTS;
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::domain::floating_object::{
    AnchorMode, ChartData, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon,
    FloatingObjectData, ShapeData,
};
use value_types::ComputeError;
use yrs::{Doc, MapRef, Origin, Transact};

use super::codec::{read_all_typed, write_object_typed};
use super::ids::{generate_object_id, now_millis};
use super::keys::{
    KEY_ANCHOR_COL_OFFSET_EMU, KEY_ANCHOR_ROW_OFFSET_EMU, KEY_END_COL_OFFSET_EMU,
    KEY_END_ROW_OFFSET_EMU, KEY_EXTENT_CX_EMU, KEY_EXTENT_CY_EMU,
};
use super::objects::get_all_floating_objects;
use super::sheet_map::get_sheet_submap;
use super::units::{json_i64_alias, px_to_emu};

pub fn create_shape_from_config(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: &CreateShapeConfig,
    grid_index: Option<&mut GridIndex>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<serde_json::Value, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map =
        get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS).ok_or_else(|| {
            ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            }
        })?;

    let object_id = generate_object_id(id_alloc);
    let now = now_millis();

    // Read all floating objects once and reuse for z-index and shape counting.
    let all_objects = read_all_typed(&txn, &map);

    // Compute z-index: max across all floating objects (charts are floating objects now), then +1.
    let max_z = all_objects
        .iter()
        .map(|o| o.common.z_index)
        .max()
        .unwrap_or(-1);

    // Auto-generate shape name if not provided.
    let name = config.name.clone().unwrap_or_else(|| {
        let count = all_objects
            .iter()
            .filter(|o| o.object_type() == "shape")
            .count();
        format!("Shape {}", count + 1)
    });

    // Apply defaults for fill and outline.
    let fill = config
        .fill
        .clone()
        .unwrap_or_else(CreateShapeConfig::default_fill);
    let outline = config
        .outline
        .clone()
        .unwrap_or_else(CreateShapeConfig::default_outline);

    // Store stable CellId for identity-based anchoring
    let anchor_cell_id = grid_index.map(|grid| {
        let cell_id = grid.ensure_cell_id(config.anchor_row, config.anchor_col);
        id_to_hex(cell_id.as_u128()).to_string()
    });

    // Build the FloatingObject struct directly — no flat JSON intermediate.
    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: object_id.clone(),
            sheet_id: sheet_hex.to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: config.anchor_row,
                anchor_col: config.anchor_col,
                anchor_row_offset: px_to_emu(config.y_offset.get()),
                anchor_col_offset: px_to_emu(config.x_offset.get()),
                anchor_mode: AnchorMode::OneCell,
                extent_cx: Some(px_to_emu(config.width.get())),
                extent_cy: Some(px_to_emu(config.height.get())),
                ..Default::default()
            },
            width: config.width.get(),
            height: config.height.get(),
            z_index: max_z + 1,
            rotation: config.rotation.map(|r| r.get()).unwrap_or(0.0),
            locked: false,
            printable: true,
            visible: true,
            opacity: 1.0,
            name,
            created_at: now,
            updated_at: now,
            anchor_cell_id,
            ..Default::default()
        },
        data: FloatingObjectData::Shape(ShapeData {
            shape_type: serde_json::to_string(&config.shape_type)
                .unwrap_or_default()
                .trim_matches('"')
                .to_string(),
            fill: Some(fill),
            outline: Some(outline),
            text: config.text.clone(),
            shadow: config.shadow.clone(),
            // Boundary type uses FiniteF64; ShapeData (domain) uses bare f64.
            // Unwrap each finite value back to f64 — no fallibility added.
            adjustments: config
                .adjustments
                .as_ref()
                .map(|m| m.iter().map(|(k, v)| (k.clone(), v.get())).collect()),
            scene_3d: None,
            sp_3d: None,
            ooxml: None,
        }),
    };

    write_object_typed(&mut txn, &map, &object_id, &obj);
    serde_json::to_value(&obj).map_err(|e| ComputeError::Eval {
        message: e.to_string(),
    })
}

/// Create a new chart as a floating object with `type: "chart"`.
///
/// Generates a unique ID, computes z-index (max of all floating objects + 1),
/// and stores the object via `write_object_typed` (the canonical struct-based write path).
/// All chart domain fields (series, axes, legend, colors, data ranges, etc.) are
/// stored as individual Y.Map keys on the floating object — no `chartConfig` sub-object.
///
/// Returns the full JSON object on success.
pub fn create_chart_object(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    config: &serde_json::Value,
    grid_index: Option<&mut GridIndex>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<serde_json::Value, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let mut txn = doc.transact_mut_with(Origin::from(ORIGIN_USER_EDIT));
    let map =
        get_sheet_submap(&txn, sheets, &sheet_hex, KEY_FLOATING_OBJECTS).ok_or_else(|| {
            ComputeError::SheetNotFound {
                sheet_id: sheet_hex.to_string(),
            }
        })?;

    let object_id = generate_object_id(id_alloc);
    let now = now_millis();

    // Read all floating objects for z-index and chart counting.
    let all_objects = read_all_typed(&txn, &map);

    // Compute z-index: max across all floating objects (charts are floating objects now), then +1.
    let max_z = all_objects
        .iter()
        .map(|o| o.common.z_index)
        .max()
        .unwrap_or(-1);

    // Count existing charts for auto-name generation.
    let chart_count = all_objects
        .iter()
        .filter(|o| o.object_type() == "chart")
        .count();

    let config_obj = config.as_object().cloned().unwrap_or_default();

    // Extract common fields from config.
    let anchor_row = config_obj
        .get("anchorRow")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let anchor_col = config_obj
        .get("anchorCol")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let x_offset_emu = if let Some(px) = config_obj.get("xOffset").and_then(|v| v.as_f64()) {
        px_to_emu(px)
    } else {
        json_i64_alias(&config_obj, KEY_ANCHOR_COL_OFFSET_EMU, "anchorColOffset").unwrap_or(0)
    };
    let y_offset_emu = if let Some(px) = config_obj.get("yOffset").and_then(|v| v.as_f64()) {
        px_to_emu(px)
    } else {
        json_i64_alias(&config_obj, KEY_ANCHOR_ROW_OFFSET_EMU, "anchorRowOffset").unwrap_or(0)
    };
    let width = config_obj
        .get("width")
        .and_then(|v| v.as_f64())
        .unwrap_or(400.0);
    let height = config_obj
        .get("height")
        .and_then(|v| v.as_f64())
        .unwrap_or(300.0);
    let anchor_mode_str = config_obj
        .get("anchorMode")
        .and_then(|v| v.as_str())
        .unwrap_or("oneCell");
    let anchor_mode = match anchor_mode_str {
        "twoCell" => AnchorMode::TwoCell,
        "absolute" => AnchorMode::Absolute,
        _ => AnchorMode::OneCell,
    };
    let name = config_obj
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Chart {}", chart_count + 1));

    // Store stable CellId for identity-based anchoring.
    let anchor_cell_id = grid_index.map(|grid| {
        let cell_id = grid.ensure_cell_id(anchor_row, anchor_col);
        id_to_hex(cell_id.as_u128()).to_string()
    });

    // Build a merged JSON for chart-specific field parsing.
    let mut chart_json = config_obj.clone();
    // Ensure chartType is set (may have come as "type" from caller).
    if !chart_json.contains_key("chartType")
        && let Some(t) = chart_json.get("type").cloned()
    {
        chart_json.insert("chartType".to_string(), t);
    }

    let chart_data: ChartData = serde_json::from_value(serde_json::Value::Object(chart_json))
        .map_err(|e| ComputeError::Eval {
            message: format!("Invalid chart config: {}", e),
        })?;

    // Build the FloatingObject struct directly — no flat JSON → serde roundtrip.
    let obj = FloatingObject {
        common: FloatingObjectCommon {
            id: object_id.clone(),
            sheet_id: sheet_hex.to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row,
                anchor_col,
                anchor_row_offset: y_offset_emu,
                anchor_col_offset: x_offset_emu,
                anchor_mode,
                absolute_x: config_obj.get("absoluteXEmu").and_then(|v| v.as_i64()),
                absolute_y: config_obj.get("absoluteYEmu").and_then(|v| v.as_i64()),
                end_row: config_obj
                    .get("endRow")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
                end_col: config_obj
                    .get("endCol")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32),
                end_row_offset: json_i64_alias(&config_obj, KEY_END_ROW_OFFSET_EMU, "endRowOffset"),
                end_col_offset: json_i64_alias(&config_obj, KEY_END_COL_OFFSET_EMU, "endColOffset"),
                extent_cx: json_i64_alias(&config_obj, KEY_EXTENT_CX_EMU, "extentCx")
                    .or_else(|| Some(px_to_emu(width))),
                extent_cy: json_i64_alias(&config_obj, KEY_EXTENT_CY_EMU, "extentCy")
                    .or_else(|| Some(px_to_emu(height))),
            },
            width,
            height,
            z_index: max_z + 1,
            locked: false,
            printable: true,
            visible: true,
            opacity: 1.0,
            name,
            created_at: now,
            updated_at: now,
            anchor_cell_id,
            ..Default::default()
        },
        data: FloatingObjectData::Chart(chart_data),
    };

    write_object_typed(&mut txn, &map, &object_id, &obj);
    serde_json::to_value(&obj).map_err(|e| ComputeError::Eval {
        message: e.to_string(),
    })
}

// =============================================================================
// Chart Query Helpers (floating objects filtered by type=="chart")
// =============================================================================

/// Get all chart floating objects in a sheet as JSON values.
#[allow(dead_code)]
pub fn get_chart_objects(doc: &Doc, sheets: &MapRef, sheet_id: &SheetId) -> Vec<serde_json::Value> {
    get_all_floating_objects(doc, sheets, sheet_id)
        .into_iter()
        .filter(|(_id, json)| json.get("type").and_then(|v| v.as_str()) == Some("chart"))
        .map(|(_id, json)| json)
        .collect()
}

/// Get all chart floating objects linked to a specific table (by sourceTableId primitive field).
#[allow(dead_code)]
pub fn get_charts_linked_to_table(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    table_id: &str,
) -> Vec<serde_json::Value> {
    get_all_floating_objects(doc, sheets, sheet_id)
        .into_iter()
        .filter(|(_id, json)| {
            json.get("type").and_then(|v| v.as_str()) == Some("chart")
                && json.get("sourceTableId").and_then(|v| v.as_str()) == Some(table_id)
        })
        .map(|(_id, json)| json)
        .collect()
}
