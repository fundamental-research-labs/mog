use crate::cells::CellStore;
use crate::engine_types::floating_objects::CreateShapeConfig;
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use compute_document::hex::id_to_hex;
use domain_types::domain::floating_object::{
    AnchorMode, ChartData, FloatingObject, FloatingObjectAnchor, FloatingObjectCommon,
    FloatingObjectData, ShapeData,
};
use value_types::ComputeError;

use super::ids::{generate_object_id, now_millis};
use super::keys::{
    KEY_ANCHOR_COL_OFFSET_EMU, KEY_ANCHOR_ROW_OFFSET_EMU, KEY_END_COL_OFFSET_EMU,
    KEY_END_ROW_OFFSET_EMU, KEY_EXTENT_CX_EMU, KEY_EXTENT_CY_EMU,
};
use super::state::{required_state_mut, state};
use super::units::{json_i64_alias, px_to_emu};

fn json_number_to_i64(value: &serde_json::Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|v| v.round() as i64))
}

fn nested_or_flat_u32(
    anchor_obj: Option<&serde_json::Map<String, serde_json::Value>>,
    config_obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<u32> {
    anchor_obj
        .and_then(|a| a.get(key))
        .and_then(|v| v.as_u64())
        .or_else(|| config_obj.get(key).and_then(|v| v.as_u64()))
        .map(|v| v as u32)
}

fn nested_or_flat_str<'a>(
    anchor_obj: Option<&'a serde_json::Map<String, serde_json::Value>>,
    config_obj: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<&'a str> {
    anchor_obj
        .and_then(|a| a.get(key))
        .and_then(|v| v.as_str())
        .or_else(|| config_obj.get(key).and_then(|v| v.as_str()))
}

fn nested_or_flat_i64_alias(
    anchor_obj: Option<&serde_json::Map<String, serde_json::Value>>,
    config_obj: &serde_json::Map<String, serde_json::Value>,
    canonical: &str,
    legacy: &str,
) -> Option<i64> {
    anchor_obj
        .and_then(|a| a.get(canonical))
        .and_then(json_number_to_i64)
        .or_else(|| {
            anchor_obj
                .and_then(|a| a.get(legacy))
                .and_then(json_number_to_i64)
        })
        .or_else(|| json_i64_alias(config_obj, canonical, legacy))
}

pub fn create_shape_from_config(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    config: &CreateShapeConfig,
    grid_index: Option<&mut CellStore>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<serde_json::Value, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let object_id = generate_object_id(id_alloc);
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        floating_objects.objects,
        object_id
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        floating_objects.order
    );
    let state = required_state_mut(storage, sheet_id)?;
    let now = now_millis();

    // Read all floating objects once and reuse for z-index and shape counting.
    let all_objects: Vec<_> = state.objects.values().collect();

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
    let anchor_cell_id = grid_index.and_then(|grid| {
        let cell_id = grid.ensure_identity_at(
            sheet_id,
            cell_types::SheetPos::new(config.anchor_row, config.anchor_col),
        );
        Some(id_to_hex(cell_id?.as_u128()).to_string())
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

    let result = serde_json::to_value(&obj);
    state.insert(obj);
    result.map_err(|e| ComputeError::Eval {
        message: e.to_string(),
    })
}

/// Create a new chart as a floating object with `type: "chart"`.
///
/// Generates a unique ID, computes z-index (max of all floating objects + 1),
/// and stores the object via `write_object_typed` (the canonical struct-based write path).
/// All chart domain fields (series, axes, legend, colors, data ranges, etc.) are
/// decoded into the chart domain fields at the public JSON boundary.
///
/// Returns the full JSON object on success.
pub fn create_chart_object(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    config: &serde_json::Value,
    grid_index: Option<&mut CellStore>,
    id_alloc: &cell_types::IdAllocator,
) -> Result<serde_json::Value, ComputeError> {
    let sheet_hex = id_to_hex(sheet_id.as_u128());
    let object_id = generate_object_id(id_alloc);
    crate::storage::engine::history::metadata::capture_sheet_entry!(
        storage,
        *sheet_id,
        floating_objects.objects,
        object_id
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        floating_objects.order
    );
    let state = required_state_mut(storage, sheet_id)?;
    let now = now_millis();

    // Read all floating objects for z-index and chart counting.
    let all_objects: Vec<_> = state.objects.values().collect();

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
    let anchor_obj = config_obj.get("anchor").and_then(|v| v.as_object());

    // Accept both the canonical nested anchor contract and legacy flat fields.
    let anchor_row = nested_or_flat_u32(anchor_obj, &config_obj, "anchorRow").unwrap_or(0);
    let anchor_col = nested_or_flat_u32(anchor_obj, &config_obj, "anchorCol").unwrap_or(0);
    let x_offset_emu = if let Some(px) = config_obj.get("xOffset").and_then(|v| v.as_f64()) {
        px_to_emu(px)
    } else {
        nested_or_flat_i64_alias(
            anchor_obj,
            &config_obj,
            KEY_ANCHOR_COL_OFFSET_EMU,
            "anchorColOffset",
        )
        .unwrap_or(0)
    };
    let y_offset_emu = if let Some(px) = config_obj.get("yOffset").and_then(|v| v.as_f64()) {
        px_to_emu(px)
    } else {
        nested_or_flat_i64_alias(
            anchor_obj,
            &config_obj,
            KEY_ANCHOR_ROW_OFFSET_EMU,
            "anchorRowOffset",
        )
        .unwrap_or(0)
    };
    let width = config_obj
        .get("width")
        .and_then(|v| v.as_f64())
        .unwrap_or(400.0);
    let height = config_obj
        .get("height")
        .and_then(|v| v.as_f64())
        .unwrap_or(300.0);
    let anchor_mode_str =
        nested_or_flat_str(anchor_obj, &config_obj, "anchorMode").unwrap_or("oneCell");
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
    let anchor_cell_id = grid_index.and_then(|grid| {
        let cell_id =
            grid.ensure_identity_at(sheet_id, cell_types::SheetPos::new(anchor_row, anchor_col));
        Some(id_to_hex(cell_id?.as_u128()).to_string())
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
                end_row: nested_or_flat_u32(anchor_obj, &config_obj, "endRow"),
                end_col: nested_or_flat_u32(anchor_obj, &config_obj, "endCol"),
                end_row_offset: nested_or_flat_i64_alias(
                    anchor_obj,
                    &config_obj,
                    KEY_END_ROW_OFFSET_EMU,
                    "endRowOffset",
                ),
                end_col_offset: nested_or_flat_i64_alias(
                    anchor_obj,
                    &config_obj,
                    KEY_END_COL_OFFSET_EMU,
                    "endColOffset",
                ),
                extent_cx: nested_or_flat_i64_alias(
                    anchor_obj,
                    &config_obj,
                    KEY_EXTENT_CX_EMU,
                    "extentCx",
                )
                .or_else(|| Some(px_to_emu(width))),
                extent_cy: nested_or_flat_i64_alias(
                    anchor_obj,
                    &config_obj,
                    KEY_EXTENT_CY_EMU,
                    "extentCy",
                )
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

    let result = serde_json::to_value(&obj);
    state.insert(obj);
    result.map_err(|e| ComputeError::Eval {
        message: e.to_string(),
    })
}

/// Get native chart objects, excluding other drawing kinds before cloning.
pub fn get_chart_objects(storage: &WorkbookStorage, sheet_id: &SheetId) -> Vec<FloatingObject> {
    state(storage, sheet_id)
        .into_iter()
        .flat_map(|state| state.objects.values())
        .filter(|object| matches!(object.data, FloatingObjectData::Chart(_)))
        .map(|object| object.as_ref().clone())
        .collect()
}

/// Get native charts whose source is the specified table identity.
pub fn get_charts_linked_to_table(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    table_id: &str,
) -> Vec<FloatingObject> {
    state(storage, sheet_id).into_iter().flat_map(|state| state.objects.values())
        .filter(|object| matches!(&object.data, FloatingObjectData::Chart(chart) if chart.source_table_id.as_deref() == Some(table_id)))
        .map(|object| object.as_ref().clone()).collect()
}
