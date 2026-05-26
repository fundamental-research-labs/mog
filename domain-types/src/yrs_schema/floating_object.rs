//! Unified YrsSchema for FloatingObject — all 12 floating object types.
//!
//! Every floating object is stored as a single Y.Map with:
//! - Common fields (id, sheetId, type, position, size, etc.) as native Yrs keys
//! - Per-type primitive fields as native Yrs keys
//! - Per-type sub-object fields as JSON-serialized strings
//!
//! This replaces the 6 separate yrs_schema modules (floating_object, chart,
//! connector, ole_object, diagram, form_control) with ONE unified module.

use std::collections::BTreeMap;
use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn};

use super::helpers::*;
use crate::domain::floating_object::*;

const KEY_ANCHOR_ROW_OFFSET_EMU: &str = "anchorRowOffsetEmu";
const KEY_ANCHOR_COL_OFFSET_EMU: &str = "anchorColOffsetEmu";
const KEY_END_ROW_OFFSET_EMU: &str = "endRowOffsetEmu";
const KEY_END_COL_OFFSET_EMU: &str = "endColOffsetEmu";
const KEY_EXTENT_CX_EMU: &str = "extentCxEmu";
const KEY_EXTENT_CY_EMU: &str = "extentCyEmu";

// ── Serialization helpers ─────────────────────────────────────────────

/// Serialize an Option<T: Serialize> to Any::String (JSON) or skip if None.
fn sub_object_to_any<T: serde::Serialize>(val: &T) -> Any {
    Any::String(Arc::from(
        serde_json::to_string(val).unwrap_or_default().as_str(),
    ))
}

/// Serialize an Option<T: Serialize> — returns Some(Any::String) or None.
fn option_sub_object<T: serde::Serialize>(val: &Option<T>) -> Option<Any> {
    val.as_ref().map(|v| sub_object_to_any(v))
}

/// Read a sub-object from a Y.Map key (stored as JSON string).
fn read_sub_object<T: serde::de::DeserializeOwned, R: ReadTxn>(
    map: &MapRef,
    txn: &R,
    key: &str,
) -> Option<T> {
    read_string(map, txn, key).and_then(|s| match serde_json::from_str(&s) {
        Ok(v) => Some(v),
        Err(e) => {
            eprintln!("[WARN] read_sub_object({key}): deserialization failed: {e}");
            None
        }
    })
}

fn read_i64_aliased<R: ReadTxn>(
    map: &MapRef,
    txn: &R,
    canonical: &str,
    legacy: &str,
) -> Option<i64> {
    read_i64(map, txn, canonical).or_else(|| read_i64(map, txn, legacy))
}

fn anchor_mode_to_str(mode: &AnchorMode) -> &'static str {
    match mode {
        AnchorMode::OneCell => "oneCell",
        AnchorMode::TwoCell => "twoCell",
        AnchorMode::Absolute => "absolute",
    }
}

fn str_to_anchor_mode(s: &str) -> AnchorMode {
    match s {
        "twoCell" => AnchorMode::TwoCell,
        "absolute" => AnchorMode::Absolute,
        _ => AnchorMode::OneCell,
    }
}

// ── to_yrs_prelim ────────────────────────────────────────────────────

/// Write a FloatingObject to Y.Map prelim entries.
///
/// Returns `Vec<(String, Any)>` because drawing objects use dynamic keys
/// (`stroke:{id}`) that require owned strings. All entries are consumed
/// immediately by `MapPrelim::from_iter` which accepts `String: Into<Arc<str>>`.
pub fn to_yrs_prelim(obj: &FloatingObject) -> Vec<(String, Any)> {
    let c = &obj.common;
    let a = &c.anchor;

    let mut entries: Vec<(String, Any)> = vec![
        ("id".into(), Any::String(Arc::from(c.id.as_str()))),
        (
            "sheetId".into(),
            Any::String(Arc::from(c.sheet_id.as_str())),
        ),
        ("type".into(), Any::String(Arc::from(obj.object_type()))),
        ("anchorRow".into(), Any::Number(a.anchor_row as f64)),
        ("anchorCol".into(), Any::Number(a.anchor_col as f64)),
        (
            KEY_ANCHOR_ROW_OFFSET_EMU.into(),
            Any::Number(a.anchor_row_offset as f64),
        ),
        (
            KEY_ANCHOR_COL_OFFSET_EMU.into(),
            Any::Number(a.anchor_col_offset as f64),
        ),
        (
            "anchorMode".into(),
            Any::String(Arc::from(anchor_mode_to_str(&a.anchor_mode))),
        ),
        ("width".into(), Any::Number(c.width)),
        ("height".into(), Any::Number(c.height)),
        ("zIndex".into(), Any::Number(c.z_index as f64)),
        ("rotation".into(), Any::Number(c.rotation)),
        ("flipH".into(), Any::Bool(c.flip_h)),
        ("flipV".into(), Any::Bool(c.flip_v)),
        ("locked".into(), Any::Bool(c.locked)),
        ("visible".into(), Any::Bool(c.visible)),
        ("printable".into(), Any::Bool(c.printable)),
        ("opacity".into(), Any::Number(c.opacity)),
        ("name".into(), Any::String(Arc::from(c.name.as_str()))),
        ("createdAt".into(), Any::Number(c.created_at as f64)),
        ("updatedAt".into(), Any::Number(c.updated_at as f64)),
    ];

    // Optional anchor fields
    if let Some(v) = a.end_row {
        entries.push(("endRow".into(), Any::Number(v as f64)));
    }
    if let Some(v) = a.end_col {
        entries.push(("endCol".into(), Any::Number(v as f64)));
    }
    if let Some(v) = a.end_row_offset {
        entries.push((KEY_END_ROW_OFFSET_EMU.into(), Any::Number(v as f64)));
    }
    if let Some(v) = a.end_col_offset {
        entries.push((KEY_END_COL_OFFSET_EMU.into(), Any::Number(v as f64)));
    }
    if let Some(v) = a.extent_cx {
        entries.push((KEY_EXTENT_CX_EMU.into(), Any::Number(v as f64)));
    }
    if let Some(v) = a.extent_cy {
        entries.push((KEY_EXTENT_CY_EMU.into(), Any::Number(v as f64)));
    }
    if let Some(ref v) = c.group_id {
        entries.push(("groupId".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(ref v) = c.anchor_cell_id {
        entries.push(("anchorCellId".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(ref v) = c.to_anchor_cell_id {
        entries.push(("toAnchorCellId".into(), Any::String(Arc::from(v.as_str()))));
    }
    if let Some(a) = option_sub_object(&c.import_status) {
        entries.push(("importStatus".into(), a));
    }

    // Per-type fields
    match &obj.data {
        FloatingObjectData::Shape(d) => {
            entries.push((
                "shapeType".into(),
                Any::String(Arc::from(d.shape_type.as_str())),
            ));
            if let Some(a) = option_sub_object(&d.fill) {
                entries.push(("fill".into(), a));
            }
            if let Some(a) = option_sub_object(&d.outline) {
                entries.push(("outline".into(), a));
            }
            if let Some(a) = option_sub_object(&d.text) {
                entries.push(("text".into(), a));
            }
            if let Some(a) = option_sub_object(&d.shadow) {
                entries.push(("shadow".into(), a));
            }
            if let Some(a) = option_sub_object(&d.adjustments) {
                entries.push(("adjustments".into(), a));
            }
            if let Some(a) = option_sub_object(&d.scene_3d) {
                entries.push(("scene3d".into(), a));
            }
            if let Some(a) = option_sub_object(&d.sp_3d) {
                entries.push(("sp3d".into(), a));
            }
            if let Some(a) = option_sub_object(&d.ooxml) {
                entries.push(("ooxml".into(), a));
            }
        }
        FloatingObjectData::Connector(d) => {
            entries.push((
                "shapeType".into(),
                Any::String(Arc::from(d.shape_type.as_str())),
            ));
            if let Some(a) = option_sub_object(&d.fill) {
                entries.push(("fill".into(), a));
            }
            if let Some(a) = option_sub_object(&d.outline) {
                entries.push(("outline".into(), a));
            }
            if let Some(a) = option_sub_object(&d.start_connection) {
                entries.push(("startConnection".into(), a));
            }
            if let Some(a) = option_sub_object(&d.end_connection) {
                entries.push(("endConnection".into(), a));
            }
            if let Some(a) = option_sub_object(&d.adjustments) {
                entries.push(("adjustments".into(), a));
            }
            if let Some(a) = option_sub_object(&d.ooxml) {
                entries.push(("ooxml".into(), a));
            }
        }
        FloatingObjectData::Picture(d) => {
            entries.push(("src".into(), Any::String(Arc::from(d.src.as_str()))));
            if let Some(v) = d.original_width {
                entries.push(("originalWidth".into(), Any::Number(v)));
            }
            if let Some(v) = d.original_height {
                entries.push(("originalHeight".into(), Any::Number(v)));
            }
            if let Some(a) = option_sub_object(&d.crop) {
                entries.push(("crop".into(), a));
            }
            if let Some(a) = option_sub_object(&d.adjustments) {
                entries.push(("adjustments".into(), a));
            }
            if let Some(a) = option_sub_object(&d.border) {
                entries.push(("border".into(), a));
            }
            if let Some(a) = option_sub_object(&d.color_type) {
                entries.push(("colorType".into(), a));
            }
            if let Some(a) = option_sub_object(&d.ooxml) {
                entries.push(("ooxml".into(), a));
            }
        }
        FloatingObjectData::Textbox(d) => {
            if let Some(ref text) = d.text {
                entries.push((
                    "content".into(),
                    Any::String(Arc::from(text.content.as_str())),
                ));
                if let Some(a) = option_sub_object(&text.format) {
                    entries.push(("defaultFormat".into(), a));
                }
                if let Some(a) = option_sub_object(&text.margins) {
                    entries.push(("margins".into(), a));
                }
                if let Some(ref v) = text.vertical_align
                    && let Ok(s) = serde_json::to_value(v)
                    && let Some(s) = s.as_str()
                {
                    entries.push(("verticalAlign".into(), Any::String(Arc::from(s))));
                }
            }
            if let Some(a) = option_sub_object(&d.fill) {
                entries.push(("fill".into(), a));
            }
            if let Some(a) = option_sub_object(&d.border) {
                entries.push(("border".into(), a));
            }
            if let Some(a) = option_sub_object(&d.text_effects) {
                entries.push(("textEffects".into(), a));
            }
            if let Some(a) = option_sub_object(&d.ooxml) {
                entries.push(("ooxml".into(), a));
            }
        }
        FloatingObjectData::Chart(d) => {
            entries.push((
                "chartType".into(),
                Any::String(Arc::from(d.chart_type.as_str())),
            ));
            if let Some(ref v) = d.sub_type {
                entries.push(("subType".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(ref v) = d.series_orientation {
                entries.push((
                    "seriesOrientation".into(),
                    Any::String(Arc::from(v.as_str())),
                ));
            }
            if let Some(ref v) = d.data_range {
                entries.push(("dataRange".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(a) = option_sub_object(&d.data_range_identity) {
                entries.push(("dataRangeIdentity".into(), a));
            }
            if let Some(ref v) = d.series_range {
                entries.push(("seriesRange".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(a) = option_sub_object(&d.series_range_identity) {
                entries.push(("seriesRangeIdentity".into(), a));
            }
            if let Some(ref v) = d.category_range {
                entries.push(("categoryRange".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(a) = option_sub_object(&d.category_range_identity) {
                entries.push(("categoryRangeIdentity".into(), a));
            }
            if let Some(ref v) = d.title {
                entries.push(("title".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(ref v) = d.subtitle {
                entries.push(("subtitle".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(a) = option_sub_object(&d.legend) {
                entries.push(("legend".into(), a));
            }
            if let Some(a) = option_sub_object(&d.axis) {
                entries.push(("axis".into(), a));
            }
            if let Some(ref v) = d.colors {
                let json_val = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
                if let Some(a) = option_sub_object(&Some(json_val)) {
                    entries.push(("colors".into(), a));
                }
            }
            if let Some(a) = option_sub_object(&d.series) {
                entries.push(("series".into(), a));
            }
            if let Some(a) = option_sub_object(&d.data_labels) {
                entries.push(("dataLabels".into(), a));
            }
            if let Some(a) = option_sub_object(&d.pie_slice) {
                entries.push(("pieSlice".into(), a));
            }
            if let Some(a) = option_sub_object(&d.trendline) {
                entries.push(("trendline".into(), a));
            }
            if let Some(v) = d.show_lines {
                entries.push(("showLines".into(), Any::Bool(v)));
            }
            if let Some(v) = d.smooth_lines {
                entries.push(("smoothLines".into(), Any::Bool(v)));
            }
            if let Some(v) = d.radar_filled {
                entries.push(("radarFilled".into(), Any::Bool(v)));
            }
            if let Some(v) = d.radar_markers {
                entries.push(("radarMarkers".into(), Any::Bool(v)));
            }
            if let Some(a) = option_sub_object(&d.waterfall) {
                entries.push(("waterfall".into(), a));
            }
            if let Some(ref v) = d.display_blanks_as {
                entries.push(("displayBlanksAs".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(v) = d.plot_visible_only {
                entries.push(("plotVisibleOnly".into(), Any::Bool(v)));
            }
            if let Some(v) = d.gap_width {
                entries.push(("gapWidth".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.overlap {
                entries.push(("overlap".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.doughnut_hole_size {
                entries.push(("doughnutHoleSize".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.first_slice_angle {
                entries.push(("firstSliceAngle".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.bubble_scale {
                entries.push(("bubbleScale".into(), Any::Number(v as f64)));
            }
            if let Some(ref v) = d.split_type {
                entries.push(("splitType".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(v) = d.split_value {
                entries.push(("splitValue".into(), Any::Number(v)));
            }
            // Simple config properties
            if let Some(v) = d.category_label_level {
                entries.push(("categoryLabelLevel".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.series_name_level {
                entries.push(("seriesNameLevel".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.show_all_field_buttons {
                entries.push(("showAllFieldButtons".into(), Any::Bool(v)));
            }
            // Chart-level series properties
            if let Some(v) = d.second_plot_size {
                entries.push(("secondPlotSize".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.vary_by_categories {
                entries.push(("varyByCategories".into(), Any::Bool(v)));
            }
            // Title alignment/shadow
            if let Some(ref v) = d.title_h_align {
                entries.push(("titleHAlign".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(ref v) = d.title_v_align {
                entries.push(("titleVAlign".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(v) = d.title_show_shadow {
                entries.push(("titleShowShadow".into(), Any::Bool(v)));
            }
            // Pivot chart options
            if let Some(a) = option_sub_object(&d.pivot_options) {
                entries.push(("pivotOptions".into(), a));
            }
            // Bar shape
            if let Some(ref v) = d.bar_shape {
                entries.push(("barShape".into(), Any::String(Arc::from(v.as_str()))));
            }
            // Bubble / Surface / Theming
            if let Some(v) = d.bubble_3d_effect {
                entries.push(("bubble3dEffect".into(), Any::Bool(v)));
            }
            if let Some(v) = d.wireframe {
                entries.push(("wireframe".into(), Any::Bool(v)));
            }
            if let Some(v) = d.surface_top_view {
                entries.push(("surfaceTopView".into(), Any::Bool(v)));
            }
            if let Some(v) = d.color_scheme {
                entries.push(("colorScheme".into(), Any::Number(v as f64)));
            }
            // Position in points
            if let Some(v) = d.height_pt {
                entries.push(("heightPt".into(), Any::Number(v)));
            }
            if let Some(v) = d.width_pt {
                entries.push(("widthPt".into(), Any::Number(v)));
            }
            if let Some(v) = d.left_pt {
                entries.push(("leftPt".into(), Any::Number(v)));
            }
            if let Some(v) = d.top_pt {
                entries.push(("topPt".into(), Any::Number(v)));
            }
            // API-exposed fields
            if let Some(v) = d.style {
                entries.push(("style".into(), Any::Number(v as f64)));
            }
            if let Some(v) = d.rounded_corners {
                entries.push(("roundedCorners".into(), Any::Bool(v)));
            }
            if let Some(v) = d.auto_title_deleted {
                entries.push(("autoTitleDeleted".into(), Any::Bool(v)));
            }
            if let Some(v) = d.show_data_labels_over_max {
                entries.push(("showDataLabelsOverMax".into(), Any::Bool(v)));
            }
            if let Some(a) = option_sub_object(&d.chart_format) {
                entries.push(("chartFormat".into(), a));
            }
            if let Some(a) = option_sub_object(&d.plot_format) {
                entries.push(("plotFormat".into(), a));
            }
            if let Some(a) = option_sub_object(&d.title_format) {
                entries.push(("titleFormat".into(), a));
            }
            if let Some(a) = option_sub_object(&d.title_rich_text) {
                entries.push(("titleRichText".into(), a));
            }
            if let Some(ref v) = d.title_formula {
                entries.push(("titleFormula".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(a) = option_sub_object(&d.data_table) {
                entries.push(("dataTable".into(), a));
            }
            // 3D
            if let Some(a) = option_sub_object(&d.view_3d) {
                entries.push(("view3d".into(), a));
            }
            if let Some(a) = option_sub_object(&d.floor_format) {
                entries.push(("floorFormat".into(), a));
            }
            if let Some(a) = option_sub_object(&d.side_wall_format) {
                entries.push(("sideWallFormat".into(), a));
            }
            if let Some(a) = option_sub_object(&d.back_wall_format) {
                entries.push(("backWallFormat".into(), a));
            }
            // Round-trip preservation
            if let Some(a) = option_sub_object(&d.rt) {
                entries.push(("rt".into(), a));
            }
            if let Some(ref v) = d.source_table_id {
                entries.push(("sourceTableId".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(ref v) = d.table_data_columns {
                let json_val = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
                if let Some(a) = option_sub_object(&Some(json_val)) {
                    entries.push(("tableDataColumns".into(), a));
                }
            }
            if let Some(ref v) = d.table_category_column {
                entries.push((
                    "tableCategoryColumn".into(),
                    Any::String(Arc::from(v.as_str())),
                ));
            }
            if let Some(v) = d.use_table_column_names_as_labels {
                entries.push(("useTableColumnNamesAsLabels".into(), Any::Bool(v)));
            }
            if let Some(ref v) = d.table_column_names {
                let json_val = serde_json::to_value(v).unwrap_or(serde_json::Value::Null);
                if let Some(a) = option_sub_object(&Some(json_val)) {
                    entries.push(("tableColumnNames".into(), a));
                }
            }
            if let Some(v) = d.width_cells {
                entries.push(("widthCells".into(), Any::Number(v)));
            }
            if let Some(v) = d.height_cells {
                entries.push(("heightCells".into(), Any::Number(v)));
            }
            if let Some(ref v) = d.preserved_chart_xml {
                entries.push((
                    "preservedChartXml".into(),
                    Any::String(Arc::from(v.as_str())),
                ));
            }
            if let Some(a) = option_sub_object(&d.ooxml) {
                entries.push(("ooxml".into(), a));
            }
        }
        FloatingObjectData::Camera(d) => {
            entries.push((
                "sourceRef".into(),
                Any::String(Arc::from(d.source_ref.as_str())),
            ));
            if let Some(ref v) = d.error {
                entries.push(("error".into(), Any::String(Arc::from(v.as_str()))));
            }
        }
        FloatingObjectData::Equation(d) => {
            entries.push((
                "equation".into(),
                Any::String(Arc::from(d.equation.as_str())),
            ));
        }
        FloatingObjectData::Diagram(d) => {
            entries.push(("definition".into(), sub_object_to_any(&d.definition)));
            if let Some(ref c) = d.category {
                let s = serde_json::to_value(c)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();
                entries.push(("category".into(), Any::String(Arc::from(s.as_str()))));
            }
        }
        FloatingObjectData::Drawing(d) => {
            // Each stroke as an individual Y.Map key for CRDT-safe concurrent edits
            for (id, stroke) in &d.strokes {
                entries.push((format!("stroke:{}", id), sub_object_to_any(stroke)));
            }
            entries.push(("toolState".into(), sub_object_to_any(&d.tool_state)));
            if !d.recognitions.is_empty() {
                entries.push(("recognitions".into(), sub_object_to_any(&d.recognitions)));
            }
            if let Some(ref bg) = d.background_color {
                entries.push((
                    "backgroundColor".into(),
                    Any::String(Arc::from(bg.as_str())),
                ));
            }
        }
        FloatingObjectData::OleObject(d) => {
            entries.push(("progId".into(), Any::String(Arc::from(d.prog_id.as_str()))));
            entries.push((
                "dvAspect".into(),
                Any::String(Arc::from(d.dv_aspect.as_str())),
            ));
            entries.push(("isLinked".into(), Any::Bool(d.is_linked)));
            entries.push(("isEmbedded".into(), Any::Bool(d.is_embedded)));
            if let Some(ref v) = d.preview_image_src {
                entries.push(("previewImageSrc".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(ref v) = d.alt_text {
                entries.push(("altText".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(a) = option_sub_object(&d.ooxml) {
                entries.push(("ooxml".into(), a));
            }
        }
        FloatingObjectData::FormControl(d) => {
            entries.push((
                "controlType".into(),
                Any::String(Arc::from(d.control_type.as_str())),
            ));
            if let Some(ref v) = d.cell_link {
                entries.push(("cellLink".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(ref v) = d.input_range {
                entries.push(("inputRange".into(), Any::String(Arc::from(v.as_str()))));
            }
            if let Some(a) = option_sub_object(&d.ooxml) {
                entries.push(("ooxml".into(), a));
            }
        }
        FloatingObjectData::Slicer(_) => {
            // Slicers carry no per-floating-object payload; the canonical
            // slicer state lives in the workbook-level slicers Y.Map as
            // `StoredSlicer` entries.
        }
    }

    entries
}

// ── from_yrs_map ─────────────────────────────────────────────────────

/// Read a FloatingObject from a Y.Map.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<FloatingObject> {
    let type_str = read_string(map, txn, "type")?;
    let id = read_string(map, txn, "id")?;
    let sheet_id = read_string(map, txn, "sheetId")?;

    let anchor = FloatingObjectAnchor {
        anchor_row: read_u32(map, txn, "anchorRow").unwrap_or(0),
        anchor_col: read_u32(map, txn, "anchorCol").unwrap_or(0),
        anchor_row_offset: read_i64_aliased(map, txn, KEY_ANCHOR_ROW_OFFSET_EMU, "anchorRowOffset")
            .unwrap_or(0),
        anchor_col_offset: read_i64_aliased(map, txn, KEY_ANCHOR_COL_OFFSET_EMU, "anchorColOffset")
            .unwrap_or(0),
        anchor_mode: read_string(map, txn, "anchorMode")
            .map(|s| str_to_anchor_mode(&s))
            .unwrap_or(AnchorMode::OneCell),
        end_row: read_u32(map, txn, "endRow"),
        end_col: read_u32(map, txn, "endCol"),
        end_row_offset: read_i64_aliased(map, txn, KEY_END_ROW_OFFSET_EMU, "endRowOffset"),
        end_col_offset: read_i64_aliased(map, txn, KEY_END_COL_OFFSET_EMU, "endColOffset"),
        extent_cx: read_i64_aliased(map, txn, KEY_EXTENT_CX_EMU, "extentCx"),
        extent_cy: read_i64_aliased(map, txn, KEY_EXTENT_CY_EMU, "extentCy"),
    };

    let common = FloatingObjectCommon {
        id,
        sheet_id,
        anchor,
        width: read_number(map, txn, "width").unwrap_or(0.0),
        height: read_number(map, txn, "height").unwrap_or(0.0),
        z_index: read_i32(map, txn, "zIndex").unwrap_or(0),
        rotation: read_number(map, txn, "rotation").unwrap_or(0.0),
        flip_h: read_bool(map, txn, "flipH").unwrap_or(false),
        flip_v: read_bool(map, txn, "flipV").unwrap_or(false),
        locked: read_bool(map, txn, "locked").unwrap_or(false),
        visible: read_bool(map, txn, "visible").unwrap_or(true),
        printable: read_bool(map, txn, "printable").unwrap_or(true),
        opacity: read_number(map, txn, "opacity").unwrap_or(1.0),
        name: read_string(map, txn, "name").unwrap_or_default(),
        created_at: read_i64(map, txn, "createdAt").unwrap_or(0),
        updated_at: read_i64(map, txn, "updatedAt").unwrap_or(0),
        group_id: read_string(map, txn, "groupId"),
        anchor_cell_id: read_string(map, txn, "anchorCellId"),
        to_anchor_cell_id: read_string(map, txn, "toAnchorCellId"),
        lock_aspect_ratio: read_bool(map, txn, "lockAspectRatio"),
        alt_text_title: read_string(map, txn, "altTextTitle"),
        display_name: read_string(map, txn, "displayName"),
        import_status: read_sub_object(map, txn, "importStatus"),
    };

    let data = match type_str.as_str() {
        "shape" => FloatingObjectData::Shape(ShapeData {
            shape_type: read_string(map, txn, "shapeType").unwrap_or_default(),
            fill: read_sub_object(map, txn, "fill"),
            outline: read_sub_object(map, txn, "outline"),
            text: read_sub_object(map, txn, "text"),
            shadow: read_sub_object(map, txn, "shadow"),
            adjustments: read_sub_object(map, txn, "adjustments"),
            scene_3d: read_sub_object(map, txn, "scene3d"),
            sp_3d: read_sub_object(map, txn, "sp3d"),
            ooxml: read_sub_object(map, txn, "ooxml"),
        }),
        "connector" => FloatingObjectData::Connector(ConnectorData {
            shape_type: read_string(map, txn, "shapeType").unwrap_or_default(),
            fill: read_sub_object(map, txn, "fill"),
            outline: read_sub_object(map, txn, "outline"),
            start_connection: read_sub_object(map, txn, "startConnection"),
            end_connection: read_sub_object(map, txn, "endConnection"),
            adjustments: read_sub_object(map, txn, "adjustments"),
            ooxml: read_sub_object(map, txn, "ooxml"),
        }),
        "picture" => FloatingObjectData::Picture(PictureData {
            src: read_string(map, txn, "src").unwrap_or_default(),
            original_width: read_number(map, txn, "originalWidth"),
            original_height: read_number(map, txn, "originalHeight"),
            crop: read_sub_object(map, txn, "crop"),
            adjustments: read_sub_object(map, txn, "adjustments"),
            border: read_sub_object(map, txn, "border"),
            color_type: read_sub_object(map, txn, "colorType"),
            ooxml: read_sub_object(map, txn, "ooxml"),
        }),
        "textbox" => {
            let content = read_string(map, txn, "content");
            let default_format = read_sub_object(map, txn, "defaultFormat");
            let margins = read_sub_object(map, txn, "margins");
            let vertical_align =
                read_string(map, txn, "verticalAlign").and_then(|s| VerticalAlign::from_str(&s));
            let text = if content.is_some()
                || default_format.is_some()
                || margins.is_some()
                || vertical_align.is_some()
            {
                Some(ShapeText {
                    content: content.unwrap_or_default(),
                    format: default_format,
                    runs: None,
                    vertical_align,
                    horizontal_align: None,
                    margins,
                    auto_size: None,
                    orientation: None,
                    reading_order: None,
                    horizontal_overflow: None,
                    vertical_overflow: None,
                    text_body: None,
                })
            } else {
                None
            };
            FloatingObjectData::Textbox(TextboxData {
                text,
                fill: read_sub_object(map, txn, "fill"),
                border: read_sub_object(map, txn, "border"),
                text_effects: read_sub_object(map, txn, "textEffects"),
                ooxml: read_sub_object(map, txn, "ooxml"),
            })
        }
        "chart" => FloatingObjectData::Chart(ChartData {
            chart_type: read_string(map, txn, "chartType")
                .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok())
                .unwrap_or_default(),
            sub_type: read_string(map, txn, "subType")
                .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok()),
            series_orientation: read_string(map, txn, "seriesOrientation")
                .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok()),
            data_range: read_string(map, txn, "dataRange"),
            data_range_identity: read_sub_object(map, txn, "dataRangeIdentity"),
            series_range: read_string(map, txn, "seriesRange"),
            series_range_identity: read_sub_object(map, txn, "seriesRangeIdentity"),
            category_range: read_string(map, txn, "categoryRange"),
            category_range_identity: read_sub_object(map, txn, "categoryRangeIdentity"),
            title: read_string(map, txn, "title").filter(|s| s != "undefined" && !s.is_empty()),
            subtitle: read_string(map, txn, "subtitle")
                .filter(|s| s != "undefined" && !s.is_empty()),
            legend: read_sub_object(map, txn, "legend"),
            axis: read_sub_object(map, txn, "axis"),
            colors: read_sub_object::<Vec<String>, _>(map, txn, "colors"),
            series: read_sub_object(map, txn, "series"),
            data_labels: read_sub_object(map, txn, "dataLabels"),
            pie_slice: read_sub_object(map, txn, "pieSlice"),
            trendline: read_sub_object(map, txn, "trendline"),
            show_lines: read_bool(map, txn, "showLines"),
            smooth_lines: read_bool(map, txn, "smoothLines"),
            radar_filled: read_bool(map, txn, "radarFilled"),
            radar_markers: read_bool(map, txn, "radarMarkers"),
            waterfall: read_sub_object(map, txn, "waterfall"),
            display_blanks_as: read_string(map, txn, "displayBlanksAs"),
            plot_visible_only: read_bool(map, txn, "plotVisibleOnly"),
            gap_width: read_number(map, txn, "gapWidth").map(|n| n as u32),
            overlap: read_number(map, txn, "overlap").map(|n| n as i32),
            doughnut_hole_size: read_number(map, txn, "doughnutHoleSize").map(|n| n as u32),
            first_slice_angle: read_number(map, txn, "firstSliceAngle").map(|n| n as u32),
            bubble_scale: read_number(map, txn, "bubbleScale").map(|n| n as u32),
            split_type: read_string(map, txn, "splitType"),
            split_value: read_number(map, txn, "splitValue"),
            // Simple config properties
            category_label_level: read_number(map, txn, "categoryLabelLevel").map(|n| n as u32),
            series_name_level: read_number(map, txn, "seriesNameLevel").map(|n| n as u32),
            show_all_field_buttons: read_bool(map, txn, "showAllFieldButtons"),
            // Chart-level series properties
            second_plot_size: read_number(map, txn, "secondPlotSize").map(|n| n as u32),
            vary_by_categories: read_bool(map, txn, "varyByCategories"),
            // Title alignment/shadow
            title_h_align: read_string(map, txn, "titleHAlign"),
            title_v_align: read_string(map, txn, "titleVAlign"),
            title_show_shadow: read_bool(map, txn, "titleShowShadow"),
            // Pivot chart options
            pivot_options: read_sub_object(map, txn, "pivotOptions"),
            // Bar shape
            bar_shape: read_string(map, txn, "barShape"),
            // Bubble / Surface / Theming
            bubble_3d_effect: read_bool(map, txn, "bubble3dEffect"),
            wireframe: read_bool(map, txn, "wireframe"),
            surface_top_view: read_bool(map, txn, "surfaceTopView"),
            color_scheme: read_number(map, txn, "colorScheme").map(|n| n as u8),
            // Position in points
            height_pt: read_number(map, txn, "heightPt"),
            width_pt: read_number(map, txn, "widthPt"),
            left_pt: read_number(map, txn, "leftPt"),
            top_pt: read_number(map, txn, "topPt"),
            // API-exposed fields
            style: read_number(map, txn, "style").map(|n| n as u8),
            rounded_corners: read_bool(map, txn, "roundedCorners"),
            auto_title_deleted: read_bool(map, txn, "autoTitleDeleted"),
            show_data_labels_over_max: read_bool(map, txn, "showDataLabelsOverMax"),
            chart_format: read_sub_object(map, txn, "chartFormat"),
            plot_format: read_sub_object(map, txn, "plotFormat"),
            title_format: read_sub_object(map, txn, "titleFormat"),
            title_rich_text: read_sub_object(map, txn, "titleRichText"),
            title_formula: read_string(map, txn, "titleFormula"),
            data_table: read_sub_object(map, txn, "dataTable"),
            // 3D
            view_3d: read_sub_object(map, txn, "view3d"),
            floor_format: read_sub_object(map, txn, "floorFormat"),
            side_wall_format: read_sub_object(map, txn, "sideWallFormat"),
            back_wall_format: read_sub_object(map, txn, "backWallFormat"),
            // Round-trip preservation
            rt: read_sub_object(map, txn, "rt"),
            source_table_id: read_string(map, txn, "sourceTableId"),
            table_data_columns: read_sub_object::<Vec<String>, _>(map, txn, "tableDataColumns"),
            table_category_column: read_string(map, txn, "tableCategoryColumn"),
            use_table_column_names_as_labels: read_bool(map, txn, "useTableColumnNamesAsLabels"),
            table_column_names: read_sub_object::<Vec<String>, _>(map, txn, "tableColumnNames"),
            width_cells: read_number(map, txn, "widthCells"),
            height_cells: read_number(map, txn, "heightCells"),
            preserved_chart_xml: read_string(map, txn, "preservedChartXml"),
            ooxml: read_sub_object(map, txn, "ooxml"),
        }),
        "camera" => FloatingObjectData::Camera(CameraData {
            source_ref: read_string(map, txn, "sourceRef").unwrap_or_default(),
            error: read_string(map, txn, "error"),
        }),
        "equation" => FloatingObjectData::Equation(EquationData {
            equation: read_string(map, txn, "equation").unwrap_or_default(),
        }),
        "diagram" => FloatingObjectData::Diagram(DiagramData {
            definition: read_sub_object(map, txn, "definition").unwrap_or_default(),
            category: read_string(map, txn, "category")
                .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok()),
        }),
        "drawing" => {
            // Read per-stroke keys (new format: "stroke:{id}" → InkStroke JSON)
            let mut strokes: BTreeMap<String, InkStroke> = BTreeMap::new();
            for (key, _value) in map.iter(txn) {
                if let Some(stroke_id) = key.strip_prefix("stroke:")
                    && let Some(stroke) = read_sub_object::<InkStroke, _>(map, txn, key)
                {
                    strokes.insert(stroke_id.to_string(), stroke);
                }
            }
            let tool_state: InkToolState =
                read_sub_object(map, txn, "toolState").unwrap_or_default();
            let recognitions: BTreeMap<String, RecognitionResult> =
                read_sub_object(map, txn, "recognitions").unwrap_or_default();
            let background_color: Option<String> = read_string(map, txn, "backgroundColor");

            // Only attempt old-format migration if no "toolState" key exists
            // (new-format drawings always write toolState)
            let has_tool_state_key = map.get(txn, "toolState").is_some();
            if !has_tool_state_key
                && let Some(blob) = read_sub_object::<serde_json::Value, _>(map, txn, "data")
                && let Some(obj) = blob.as_object()
            {
                let old_strokes: BTreeMap<String, InkStroke> = obj
                    .get("strokes")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let old_tool_state: InkToolState = obj
                    .get("toolState")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let old_recognitions: BTreeMap<String, RecognitionResult> = obj
                    .get("recognitions")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                let old_bg = obj
                    .get("backgroundColor")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or(background_color);

                return Some(FloatingObject {
                    common,
                    data: FloatingObjectData::Drawing(DrawingData {
                        strokes: old_strokes,
                        tool_state: old_tool_state,
                        recognitions: old_recognitions,
                        background_color: old_bg,
                    }),
                });
            }

            FloatingObjectData::Drawing(DrawingData {
                strokes,
                tool_state,
                recognitions,
                background_color,
            })
        }
        "oleObject" => FloatingObjectData::OleObject(OleObjectData {
            prog_id: read_string(map, txn, "progId").unwrap_or_default(),
            dv_aspect: read_string(map, txn, "dvAspect").unwrap_or_default(),
            is_linked: read_bool(map, txn, "isLinked").unwrap_or(false),
            is_embedded: read_bool(map, txn, "isEmbedded").unwrap_or(false),
            preview_image_src: read_string(map, txn, "previewImageSrc"),
            alt_text: read_string(map, txn, "altText"),
            ooxml: read_sub_object(map, txn, "ooxml"),
        }),
        "formControl" => FloatingObjectData::FormControl(FormControlData {
            control_type: read_string(map, txn, "controlType").unwrap_or_default(),
            cell_link: read_string(map, txn, "cellLink"),
            input_range: read_string(map, txn, "inputRange"),
            ooxml: read_sub_object(map, txn, "ooxml"),
        }),
        "slicer" => FloatingObjectData::Slicer(SlicerData::default()),
        // Unknown type — default to Drawing with empty data
        _ => FloatingObjectData::Drawing(DrawingData::default()),
    };

    Some(FloatingObject { common, data })
}

// ── known_fields ─────────────────────────────────────────────────────

/// Common keys present on ALL floating objects.
const COMMON_KEYS: &[&str] = &[
    "id",
    "sheetId",
    "type",
    "anchorRow",
    "anchorCol",
    "anchorRowOffsetEmu",
    "anchorColOffsetEmu",
    "anchorMode",
    "width",
    "height",
    "zIndex",
    "rotation",
    "flipH",
    "flipV",
    "locked",
    "visible",
    "printable",
    "opacity",
    "name",
    "createdAt",
    "updatedAt",
    // optional common (may or may not be present)
    "endRow",
    "endCol",
    "endRowOffsetEmu",
    "endColOffsetEmu",
    "extentCxEmu",
    "extentCyEmu",
    "groupId",
    "anchorCellId",
    "toAnchorCellId",
];

/// Returns (primitive_keys, sub_object_keys) for a given floating object type.
///
/// This helps the storage layer know which keys to read/write for each type.
/// Primitive keys are stored as native Yrs values (Number, String, Bool).
/// Sub-object keys are stored as JSON-serialized strings.
pub fn known_fields(object_type: &str) -> (Vec<&'static str>, Vec<&'static str>) {
    let mut primitives: Vec<&str> = COMMON_KEYS.to_vec();
    let mut sub_objects: Vec<&str> = Vec::new();

    match object_type {
        "shape" => {
            primitives.push("shapeType");
            sub_objects.extend_from_slice(&[
                "fill",
                "outline",
                "text",
                "shadow",
                "adjustments",
                "scene3d",
                "sp3d",
                "ooxml",
            ]);
        }
        "connector" => {
            primitives.push("shapeType");
            sub_objects.extend_from_slice(&[
                "fill",
                "outline",
                "startConnection",
                "endConnection",
                "adjustments",
                "ooxml",
            ]);
        }
        "picture" => {
            primitives.extend_from_slice(&["src", "originalWidth", "originalHeight"]);
            sub_objects.extend_from_slice(&["crop", "adjustments", "border", "ooxml"]);
        }
        "textbox" => {
            primitives.extend_from_slice(&["content", "verticalAlign"]);
            sub_objects.extend_from_slice(&[
                "defaultFormat",
                "fill",
                "border",
                "margins",
                "textEffects",
                "ooxml",
            ]);
        }
        "chart" => {
            primitives.extend_from_slice(&[
                "chartType",
                "subType",
                "seriesOrientation",
                "dataRange",
                "seriesRange",
                "categoryRange",
                "title",
                "subtitle",
                "sourceTableId",
                "tableCategoryColumn",
                "useTableColumnNamesAsLabels",
                "widthCells",
                "heightCells",
                "showLines",
                "smoothLines",
                "radarFilled",
                "radarMarkers",
                "displayBlanksAs",
                "plotVisibleOnly",
                "gapWidth",
                "overlap",
                "doughnutHoleSize",
                "firstSliceAngle",
                "bubbleScale",
                "splitType",
                "splitValue",
                "bubble3dEffect",
                "wireframe",
                "surfaceTopView",
                "colorScheme",
                "heightPt",
                "widthPt",
                "leftPt",
                "topPt",
                "style",
                "roundedCorners",
                "autoTitleDeleted",
                "showDataLabelsOverMax",
                "barShape",
                "titleFormula",
                "categoryLabelLevel",
                "seriesNameLevel",
                "showAllFieldButtons",
                "secondPlotSize",
                "varyByCategories",
                "titleHAlign",
                "titleVAlign",
                "titleShowShadow",
                "preservedChartXml",
            ]);
            sub_objects.extend_from_slice(&[
                "dataRangeIdentity",
                "seriesRangeIdentity",
                "categoryRangeIdentity",
                "legend",
                "axis",
                "colors",
                "series",
                "dataLabels",
                "pieSlice",
                "trendline",
                "waterfall",
                "tableDataColumns",
                "tableColumnNames",
                "chartFormat",
                "plotFormat",
                "titleFormat",
                "dataTable",
                "view3d",
                "floorFormat",
                "sideWallFormat",
                "backWallFormat",
                "rt",
                "definition",
                "ooxml",
                "pivotOptions",
                "titleRichText",
            ]);
        }
        "camera" => {
            primitives.extend_from_slice(&["sourceRef", "error"]);
        }
        "equation" => {
            primitives.push("equation");
        }
        "diagram" => {
            primitives.push("category");
            sub_objects.push("definition");
        }
        "drawing" => {
            // Note: stroke data stored as dynamic "stroke:{id}" keys, not enumerable here
            primitives.push("backgroundColor");
            sub_objects.extend_from_slice(&["toolState", "recognitions", "data"]);
            // "data" kept for migration
        }
        "oleObject" => {
            primitives.extend_from_slice(&[
                "progId",
                "dvAspect",
                "isLinked",
                "isEmbedded",
                "previewImageSrc",
                "altText",
            ]);
            sub_objects.push("ooxml");
        }
        "formControl" => {
            primitives.extend_from_slice(&["controlType", "cellLink", "inputRange"]);
            sub_objects.push("ooxml");
        }
        "slicer" => {
            // Slicer floating objects have no type-specific fields here;
            // canonical slicer state lives in the workbook slicers Y.Map.
        }
        _ => {}
    }

    (primitives, sub_objects)
}

// ── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::smartart::*;
    use yrs::{Doc, Map, MapPrelim, Transact};

    /// Macro to perform a Yrs round-trip test.
    macro_rules! yrs_roundtrip {
        ($obj:expr) => {{
            let doc = Doc::new();
            let root = doc.get_or_insert_map("test");
            {
                let mut txn = doc.transact_mut();
                let entries = to_yrs_prelim($obj);
                let prelim: MapPrelim = entries.into_iter().collect();
                root.insert(&mut txn, "item", prelim);
            }
            let txn = doc.transact();
            let map_ref = root
                .get(&txn, "item")
                .unwrap()
                .cast::<yrs::MapRef>()
                .unwrap();
            from_yrs_map(&map_ref, &txn).unwrap()
        }};
    }

    fn make_common(id: &str, sheet_id: &str) -> FloatingObjectCommon {
        FloatingObjectCommon {
            id: id.to_string(),
            sheet_id: sheet_id.to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: 5,
                anchor_col: 3,
                anchor_row_offset: 12700,
                anchor_col_offset: 25400,
                anchor_mode: AnchorMode::TwoCell,
                end_row: Some(20),
                end_col: Some(8),
                end_row_offset: Some(0),
                end_col_offset: Some(50800),
                extent_cx: None,
                extent_cy: None,
            },
            width: 600.5,
            height: 400.25,
            z_index: 3,
            rotation: 45.0,
            flip_h: true,
            flip_v: false,
            locked: true,
            visible: true,
            printable: true,
            opacity: 0.9,
            name: "Test Object".to_string(),
            created_at: 1700000000000,
            updated_at: 1700000001000,
            group_id: Some("group-1".to_string()),
            anchor_cell_id: Some("cell-A1".to_string()),
            to_anchor_cell_id: Some("cell-D10".to_string()),
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: None,
        }
    }

    #[test]
    fn test_to_yrs_prelim_writes_unit_explicit_anchor_keys() {
        let obj = FloatingObject {
            common: make_common("shape-1", "sheet-1"),
            data: FloatingObjectData::Shape(ShapeData {
                shape_type: "rect".to_string(),
                ..Default::default()
            }),
        };

        let entries = to_yrs_prelim(&obj);
        assert!(entries.iter().any(|(k, _)| k == KEY_ANCHOR_ROW_OFFSET_EMU));
        assert!(entries.iter().any(|(k, _)| k == KEY_ANCHOR_COL_OFFSET_EMU));
        assert!(entries.iter().any(|(k, _)| k == KEY_END_ROW_OFFSET_EMU));
        assert!(entries.iter().any(|(k, _)| k == KEY_END_COL_OFFSET_EMU));
        assert!(!entries.iter().any(|(k, _)| k == "anchorRowOffset"));
        assert!(!entries.iter().any(|(k, _)| k == "anchorColOffset"));
        assert!(!entries.iter().any(|(k, _)| k == "endRowOffset"));
        assert!(!entries.iter().any(|(k, _)| k == "endColOffset"));
    }

    fn assert_common_eq(a: &FloatingObjectCommon, b: &FloatingObjectCommon) {
        assert_eq!(a.id, b.id);
        assert_eq!(a.sheet_id, b.sheet_id);
        assert_eq!(a.anchor.anchor_row, b.anchor.anchor_row);
        assert_eq!(a.anchor.anchor_col, b.anchor.anchor_col);
        assert_eq!(a.anchor.anchor_row_offset, b.anchor.anchor_row_offset);
        assert_eq!(a.anchor.anchor_col_offset, b.anchor.anchor_col_offset);
        assert_eq!(a.anchor.anchor_mode, b.anchor.anchor_mode);
        assert_eq!(a.anchor.end_row, b.anchor.end_row);
        assert_eq!(a.anchor.end_col, b.anchor.end_col);
        assert_eq!(a.anchor.end_row_offset, b.anchor.end_row_offset);
        assert_eq!(a.anchor.end_col_offset, b.anchor.end_col_offset);
        assert_eq!(a.anchor.extent_cx, b.anchor.extent_cx);
        assert_eq!(a.anchor.extent_cy, b.anchor.extent_cy);
        assert!((a.width - b.width).abs() < f64::EPSILON);
        assert!((a.height - b.height).abs() < f64::EPSILON);
        assert_eq!(a.z_index, b.z_index);
        assert!((a.rotation - b.rotation).abs() < f64::EPSILON);
        assert_eq!(a.flip_h, b.flip_h);
        assert_eq!(a.flip_v, b.flip_v);
        assert_eq!(a.locked, b.locked);
        assert_eq!(a.visible, b.visible);
        assert_eq!(a.printable, b.printable);
        assert!((a.opacity - b.opacity).abs() < f64::EPSILON);
        assert_eq!(a.name, b.name);
        assert_eq!(a.created_at, b.created_at);
        assert_eq!(a.updated_at, b.updated_at);
        assert_eq!(a.group_id, b.group_id);
        assert_eq!(a.anchor_cell_id, b.anchor_cell_id);
        assert_eq!(a.to_anchor_cell_id, b.to_anchor_cell_id);
    }

    #[test]
    fn test_shape_roundtrip() {
        let obj = FloatingObject {
            common: make_common("shape-1", "sheet-1"),
            data: FloatingObjectData::Shape(ShapeData {
                shape_type: "roundRect".to_string(),
                fill: Some(ObjectFill {
                    fill_type: FillType::Solid,
                    color: Some("#ff0000".to_string()),
                    gradient: None,
                    transparency: None,
                    pattern: None,
                    blip: None,
                }),
                outline: Some(ShapeOutline {
                    style: OutlineStyle::Solid,
                    color: "#000000".to_string(),
                    width: 1.5,
                    head_end: None,
                    tail_end: None,
                    dash: None,
                    transparency: None,
                    compound: None,
                    visible: None,
                }),
                text: Some(ShapeText {
                    content: "Hello".to_string(),
                    format: None,
                    runs: None,
                    vertical_align: Some(VerticalAlign::Middle),
                    horizontal_align: None,
                    margins: None,
                    auto_size: None,
                    orientation: None,
                    reading_order: None,
                    horizontal_overflow: None,
                    vertical_overflow: None,
                    text_body: None,
                }),
                shadow: Some(OuterShadowEffect {
                    blur_radius: 40000.0,
                    distance: 20000.0,
                    direction: 315.0,
                    color: "#000000".to_string(),
                    opacity: 0.4,
                    ..Default::default()
                }),
                adjustments: None,
                scene_3d: None,
                sp_3d: None,
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "shape");
        if let FloatingObjectData::Shape(ref s) = restored.data {
            assert_eq!(s.shape_type, "roundRect");
            let fill = s.fill.as_ref().unwrap();
            assert_eq!(fill.fill_type, FillType::Solid);
            assert_eq!(fill.color.as_deref(), Some("#ff0000"));
            let outline = s.outline.as_ref().unwrap();
            assert_eq!(outline.style, OutlineStyle::Solid);
            assert_eq!(outline.color, "#000000");
            let text = s.text.as_ref().unwrap();
            assert_eq!(text.content, "Hello");
            assert_eq!(text.vertical_align, Some(VerticalAlign::Middle));
            let shadow = s.shadow.as_ref().unwrap();
            assert!((shadow.blur_radius - 40000.0).abs() < f64::EPSILON);
        } else {
            panic!("Expected Shape variant");
        }
    }

    #[test]
    fn test_connector_roundtrip() {
        let obj = FloatingObject {
            common: make_common("conn-1", "sheet-1"),
            data: FloatingObjectData::Connector(ConnectorData {
                shape_type: "straightConnector1".to_string(),
                fill: None,
                outline: Some(ShapeOutline {
                    style: OutlineStyle::Solid,
                    color: "#000".to_string(),
                    width: 1.0,
                    head_end: None,
                    tail_end: Some(LineEnd {
                        end_type: LineEndType::Triangle,
                        width: Some(LineEndSize::Med),
                        length: Some(LineEndSize::Med),
                    }),
                    dash: None,
                    transparency: None,
                    compound: None,
                    visible: None,
                }),
                start_connection: Some(ConnectorBinding {
                    shape_id: "shape-1".to_string(),
                    site_index: 2,
                }),
                end_connection: Some(ConnectorBinding {
                    shape_id: "shape-2".to_string(),
                    site_index: 0,
                }),
                adjustments: None,
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "connector");
        if let FloatingObjectData::Connector(ref c) = restored.data {
            assert_eq!(c.shape_type, "straightConnector1");
            assert_eq!(c.start_connection.as_ref().unwrap().shape_id, "shape-1");
            assert_eq!(c.end_connection.as_ref().unwrap().site_index, 0);
            let tail = c.outline.as_ref().unwrap().tail_end.as_ref().unwrap();
            assert_eq!(tail.end_type, LineEndType::Triangle);
        } else {
            panic!("Expected Connector variant");
        }
    }

    #[test]
    fn test_picture_roundtrip() {
        let obj = FloatingObject {
            common: make_common("pic-1", "sheet-1"),
            data: FloatingObjectData::Picture(PictureData {
                src: "https://example.com/img.png".to_string(),
                original_width: Some(800.0),
                original_height: Some(600.0),
                crop: Some(PictureCrop {
                    top: 0.1,
                    right: 0.0,
                    bottom: 0.1,
                    left: 0.0,
                }),
                adjustments: Some(PictureAdjustments {
                    brightness: Some(0.1),
                    contrast: Some(-0.2),
                    transparency: None,
                }),
                border: None,
                color_type: None,
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "picture");
        if let FloatingObjectData::Picture(ref p) = restored.data {
            assert_eq!(p.src, "https://example.com/img.png");
            assert_eq!(p.original_width, Some(800.0));
            assert_eq!(p.original_height, Some(600.0));
            let crop = p.crop.as_ref().unwrap();
            assert!((crop.top - 0.1).abs() < f64::EPSILON);
            let adj = p.adjustments.as_ref().unwrap();
            assert_eq!(adj.brightness, Some(0.1));
        } else {
            panic!("Expected Picture variant");
        }
    }

    #[test]
    fn test_textbox_roundtrip() {
        let obj = FloatingObject {
            common: make_common("tb-1", "sheet-1"),
            data: FloatingObjectData::Textbox(TextboxData {
                text: Some(ShapeText {
                    content: "Hello world".to_string(),
                    format: None,
                    runs: None,
                    vertical_align: Some(VerticalAlign::Top),
                    horizontal_align: None,
                    margins: Some(TextMargins {
                        top: 5.0,
                        right: 5.0,
                        bottom: 5.0,
                        left: 5.0,
                    }),
                    auto_size: None,
                    orientation: None,
                    reading_order: None,
                    horizontal_overflow: None,
                    vertical_overflow: None,
                    text_body: None,
                }),
                fill: Some(ObjectFill {
                    fill_type: FillType::Solid,
                    color: Some("#ffffff".to_string()),
                    gradient: None,
                    transparency: None,
                    pattern: None,
                    blip: None,
                }),
                border: None,
                text_effects: None,
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "textbox");
        if let FloatingObjectData::Textbox(ref t) = restored.data {
            let text = t.text.as_ref().unwrap();
            assert_eq!(text.content, "Hello world");
            assert_eq!(text.vertical_align, Some(VerticalAlign::Top));
            let fill = t.fill.as_ref().unwrap();
            assert_eq!(fill.fill_type, FillType::Solid);
            let margins = text.margins.as_ref().unwrap();
            assert!((margins.top - 5.0).abs() < f64::EPSILON);
        } else {
            panic!("Expected Textbox variant");
        }
    }

    #[test]
    fn test_chart_roundtrip() {
        use crate::domain::chart::{ChartSubType, ChartType, SeriesOrientation};
        use crate::domain::conditional_format::CellIdRange;

        let obj = FloatingObject {
            common: make_common("chart-1", "sheet-1"),
            data: FloatingObjectData::Chart(ChartData {
                chart_type: ChartType::Bar,
                sub_type: Some(ChartSubType::Clustered),
                series_orientation: Some(SeriesOrientation::Columns),
                data_range: Some("A1:D10".to_string()),
                data_range_identity: Some(CellIdRange {
                    top_left_cell_id: "id-a1".to_string(),
                    bottom_right_cell_id: "id-d10".to_string(),
                }),
                series_range: Some("B1:B10".to_string()),
                series_range_identity: Some(CellIdRange {
                    top_left_cell_id: "id-b1".to_string(),
                    bottom_right_cell_id: "id-b10".to_string(),
                }),
                category_range: Some("A1:A10".to_string()),
                category_range_identity: Some(CellIdRange {
                    top_left_cell_id: "id-a1".to_string(),
                    bottom_right_cell_id: "id-a10".to_string(),
                }),
                title: Some("My Chart".to_string()),
                subtitle: None,
                legend: None,
                axis: None,
                colors: Some(vec!["#ff0000".to_string()]),
                series: Some(vec![crate::domain::chart::ChartSeriesData {
                    name: Some("Revenue".to_string()),
                    r#type: None,
                    color: None,
                    values: None,
                    categories: None,
                    bubble_size: None,
                    smooth: None,
                    explosion: None,
                    invert_if_negative: None,
                    y_axis_index: None,
                    show_markers: None,
                    marker_size: None,
                    marker_style: None,
                    line_width: None,
                    points: None,
                    data_labels: None,
                    trendlines: None,
                    error_bars: None,
                    x_error_bars: None,
                    y_error_bars: None,
                    idx: None,
                    order: None,
                    format: None,
                    bar_shape: None,
                    invert_color: None,
                    marker_background_color: None,
                    marker_foreground_color: None,
                    filtered: None,
                    show_shadow: None,
                    show_connector_lines: None,
                    leader_line_format: None,
                    show_leader_lines: None,
                }]),
                data_labels: None,
                pie_slice: None,
                trendline: None,
                show_lines: Some(true),
                smooth_lines: None,
                radar_filled: None,
                radar_markers: None,
                waterfall: None,
                display_blanks_as: None,
                plot_visible_only: None,
                gap_width: None,
                overlap: None,
                doughnut_hole_size: None,
                first_slice_angle: None,
                bubble_scale: None,
                split_type: None,
                split_value: None,
                category_label_level: None,
                series_name_level: None,
                show_all_field_buttons: None,
                second_plot_size: None,
                vary_by_categories: None,
                title_h_align: None,
                title_v_align: None,
                title_show_shadow: None,
                pivot_options: None,
                bar_shape: None,
                // Bubble / Surface / Theming
                bubble_3d_effect: None,
                wireframe: None,
                surface_top_view: None,
                color_scheme: None,
                // Position in points
                height_pt: None,
                width_pt: None,
                left_pt: None,
                top_pt: None,
                style: None,
                rounded_corners: None,
                auto_title_deleted: None,
                show_data_labels_over_max: None,
                chart_format: None,
                plot_format: None,
                title_format: None,
                title_rich_text: None,
                title_formula: None,
                data_table: None,
                view_3d: None,
                floor_format: None,
                side_wall_format: None,
                back_wall_format: None,
                rt: None,
                source_table_id: Some("table-1".to_string()),
                table_data_columns: None,
                table_category_column: None,
                use_table_column_names_as_labels: None,
                table_column_names: None,
                width_cells: Some(8.0),
                height_cells: Some(15.0),
                preserved_chart_xml: None,
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "chart");
        if let FloatingObjectData::Chart(ref c) = restored.data {
            assert_eq!(c.chart_type, ChartType::Bar);
            assert_eq!(c.sub_type, Some(ChartSubType::Clustered));
            assert_eq!(c.series_orientation, Some(SeriesOrientation::Columns));
            assert_eq!(c.data_range.as_deref(), Some("A1:D10"));
            assert_eq!(
                c.data_range_identity,
                Some(CellIdRange {
                    top_left_cell_id: "id-a1".to_string(),
                    bottom_right_cell_id: "id-d10".to_string()
                })
            );
            assert_eq!(c.title.as_deref(), Some("My Chart"));
            assert_eq!(c.colors.as_ref().map(|v| v.len()), Some(1));
            assert_eq!(c.show_lines, Some(true));
            assert_eq!(c.source_table_id.as_deref(), Some("table-1"));
            assert_eq!(c.width_cells, Some(8.0));
            assert_eq!(c.height_cells, Some(15.0));
            assert!(c.series.is_some());
        } else {
            panic!("Expected Chart variant");
        }
    }

    #[test]
    fn test_camera_roundtrip() {
        let obj = FloatingObject {
            common: make_common("cam-1", "sheet-1"),
            data: FloatingObjectData::Camera(CameraData {
                source_ref: "Sheet2!A1:D10".to_string(),
                error: Some("source not found".to_string()),
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "camera");
        if let FloatingObjectData::Camera(ref c) = restored.data {
            assert_eq!(c.source_ref, "Sheet2!A1:D10");
            assert_eq!(c.error.as_deref(), Some("source not found"));
        } else {
            panic!("Expected Camera variant");
        }
    }

    #[test]
    fn test_equation_roundtrip() {
        let obj = FloatingObject {
            common: make_common("eq-1", "sheet-1"),
            data: FloatingObjectData::Equation(EquationData {
                equation: "x^2 + y^2 = r^2".to_string(),
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "equation");
        if let FloatingObjectData::Equation(ref e) = restored.data {
            assert_eq!(e.equation, "x^2 + y^2 = r^2");
        } else {
            panic!("Expected Equation variant");
        }
    }

    #[test]
    fn test_diagram_roundtrip() {
        let obj = FloatingObject {
            common: make_common("diagram-1", "sheet-1"),
            data: FloatingObjectData::Diagram(DiagramData {
                definition: SmartArtDefinition {
                    dm_rel_id: Some("rId1".to_string()),
                    data_xml: Some("<dgm:dataModel/>".to_string()),
                    ..Default::default()
                },
                category: Some(SmartArtCategory::Hierarchy),
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "diagram");
        if let FloatingObjectData::Diagram(ref s) = restored.data {
            assert_eq!(s.category, Some(SmartArtCategory::Hierarchy));
            assert_eq!(s.definition.dm_rel_id.as_deref(), Some("rId1"));
            assert_eq!(s.definition.data_xml.as_deref(), Some("<dgm:dataModel/>"));
        } else {
            panic!("Expected Diagram variant");
        }
    }

    #[test]
    fn test_drawing_roundtrip() {
        let mut strokes = BTreeMap::new();
        strokes.insert(
            "stroke-1".to_string(),
            InkStroke {
                id: "stroke-1".to_string(),
                points: vec![
                    InkPoint {
                        x: 10.0,
                        y: 20.0,
                        pressure: Some(0.5),
                        tilt: None,
                        timestamp: Some(1000.0),
                    },
                    InkPoint {
                        x: 30.0,
                        y: 40.0,
                        pressure: None,
                        tilt: None,
                        timestamp: None,
                    },
                ],
                tool: InkTool::Pen,
                color: "#000000".to_string(),
                width: 2.0,
                opacity: 1.0,
                created_by: "user-1".to_string(),
                created_at: 1234567890.0,
            },
        );
        strokes.insert(
            "stroke-2".to_string(),
            InkStroke {
                id: "stroke-2".to_string(),
                points: vec![InkPoint {
                    x: 50.0,
                    y: 60.0,
                    pressure: None,
                    tilt: None,
                    timestamp: None,
                }],
                tool: InkTool::Highlighter,
                color: "#ffff00".to_string(),
                width: 8.0,
                opacity: 0.5,
                created_by: "user-2".to_string(),
                created_at: 1234567891.0,
            },
        );

        let obj = FloatingObject {
            common: make_common("dr-1", "sheet-1"),
            data: FloatingObjectData::Drawing(DrawingData {
                strokes,
                tool_state: InkToolState::default(),
                recognitions: BTreeMap::new(),
                background_color: Some("#ffffff".to_string()),
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "drawing");
        if let FloatingObjectData::Drawing(ref d) = restored.data {
            assert_eq!(d.strokes.len(), 2);
            assert!(d.strokes.contains_key("stroke-1"));
            assert!(d.strokes.contains_key("stroke-2"));
            assert_eq!(d.strokes["stroke-1"].color, "#000000");
            assert_eq!(d.strokes["stroke-1"].points.len(), 2);
            assert_eq!(d.strokes["stroke-1"].points[0].pressure, Some(0.5));
            assert_eq!(d.strokes["stroke-2"].tool, InkTool::Highlighter);
            assert_eq!(d.background_color, Some("#ffffff".to_string()));
            assert_eq!(d.tool_state, InkToolState::default());
            assert!(d.recognitions.is_empty());
        } else {
            panic!("Expected Drawing variant");
        }
    }

    #[test]
    fn test_drawing_old_format_migration() {
        // Test reading old-format "data" blob and migrating to new typed fields
        let doc = yrs::Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();

            // Build the old format: common fields + a single "data" JSON blob
            let old_blob = serde_json::json!({
                "strokes": {
                    "s1": {
                        "id": "s1",
                        "points": [{"x": 1.0, "y": 2.0}],
                        "tool": "pen",
                        "color": "#000",
                        "width": 2.0,
                        "opacity": 1.0,
                        "createdBy": "user1",
                        "createdAt": 100.0
                    }
                },
                "toolState": {
                    "activeTool": "pen",
                    "toolSettings": {}
                },
                "backgroundColor": "#fff"
            });

            let data_json = serde_json::to_string(&old_blob).unwrap();
            let prelim: yrs::MapPrelim = vec![
                ("type".to_string(), Any::String(Arc::from("drawing"))),
                ("id".to_string(), Any::String(Arc::from("obj-1"))),
                ("sheetId".to_string(), Any::String(Arc::from("sheet-1"))),
                ("anchorRow".to_string(), Any::Number(0.0)),
                ("anchorCol".to_string(), Any::Number(0.0)),
                ("anchorRowOffset".to_string(), Any::Number(0.0)),
                ("anchorColOffset".to_string(), Any::Number(0.0)),
                ("anchorMode".to_string(), Any::String(Arc::from("oneCell"))),
                ("width".to_string(), Any::Number(100.0)),
                ("height".to_string(), Any::Number(100.0)),
                ("zIndex".to_string(), Any::Number(0.0)),
                ("rotation".to_string(), Any::Number(0.0)),
                ("flipH".to_string(), Any::Bool(false)),
                ("flipV".to_string(), Any::Bool(false)),
                ("locked".to_string(), Any::Bool(false)),
                ("visible".to_string(), Any::Bool(true)),
                ("printable".to_string(), Any::Bool(true)),
                ("opacity".to_string(), Any::Number(1.0)),
                ("name".to_string(), Any::String(Arc::from(""))),
                ("createdAt".to_string(), Any::Number(0.0)),
                ("updatedAt".to_string(), Any::Number(0.0)),
                (
                    "data".to_string(),
                    Any::String(Arc::from(data_json.as_str())),
                ),
            ]
            .into_iter()
            .collect();
            root.insert(&mut txn, "item", prelim);
        }

        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        let result = from_yrs_map(&map_ref, &txn);

        assert!(result.is_some(), "Should successfully read old format");
        let obj = result.unwrap();
        assert_eq!(obj.object_type(), "drawing");

        if let FloatingObjectData::Drawing(ref d) = obj.data {
            assert_eq!(d.strokes.len(), 1, "Should have migrated 1 stroke");
            assert!(d.strokes.contains_key("s1"));
            assert_eq!(d.strokes["s1"].color, "#000");
            assert_eq!(d.background_color, Some("#fff".to_string()));
        } else {
            panic!("Expected Drawing variant");
        }
    }

    #[test]
    fn test_ole_object_roundtrip() {
        let obj = FloatingObject {
            common: make_common("ole-1", "sheet-1"),
            data: FloatingObjectData::OleObject(OleObjectData {
                prog_id: "Word.Document.12".to_string(),
                dv_aspect: "DVASPECT_CONTENT".to_string(),
                is_linked: false,
                is_embedded: true,
                preview_image_src: Some("preview.png".to_string()),
                alt_text: Some("Embedded document".to_string()),
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "oleObject");
        if let FloatingObjectData::OleObject(ref o) = restored.data {
            assert_eq!(o.prog_id, "Word.Document.12");
            assert_eq!(o.dv_aspect, "DVASPECT_CONTENT");
            assert!(!o.is_linked);
            assert!(o.is_embedded);
            assert_eq!(o.preview_image_src.as_deref(), Some("preview.png"));
            assert_eq!(o.alt_text.as_deref(), Some("Embedded document"));
        } else {
            panic!("Expected OleObject variant");
        }
    }

    #[test]
    fn test_form_control_roundtrip() {
        let obj = FloatingObject {
            common: make_common("fc-1", "sheet-1"),
            data: FloatingObjectData::FormControl(FormControlData {
                control_type: "CheckBox".to_string(),
                cell_link: Some("$A$1".to_string()),
                input_range: Some("$B$1:$B$10".to_string()),
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_common_eq(&obj.common, &restored.common);
        assert_eq!(restored.object_type(), "formControl");
        if let FloatingObjectData::FormControl(ref fc) = restored.data {
            assert_eq!(fc.control_type, "CheckBox");
            assert_eq!(fc.cell_link.as_deref(), Some("$A$1"));
            assert_eq!(fc.input_range.as_deref(), Some("$B$1:$B$10"));
        } else {
            panic!("Expected FormControl variant");
        }
    }

    #[test]
    fn test_minimal_shape_roundtrip() {
        let obj = FloatingObject {
            common: FloatingObjectCommon {
                id: "min-1".to_string(),
                sheet_id: "sh-1".to_string(),
                anchor: FloatingObjectAnchor {
                    anchor_row: 0,
                    anchor_col: 0,
                    anchor_row_offset: 0,
                    anchor_col_offset: 0,
                    anchor_mode: AnchorMode::OneCell,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    extent_cx: None,
                    extent_cy: None,
                },
                width: 0.0,
                height: 0.0,
                z_index: 0,
                rotation: 0.0,
                flip_h: false,
                flip_v: false,
                locked: false,
                visible: true,
                printable: true,
                opacity: 1.0,
                name: String::new(),
                created_at: 0,
                updated_at: 0,
                group_id: None,
                anchor_cell_id: None,
                to_anchor_cell_id: None,
                lock_aspect_ratio: None,
                alt_text_title: None,
                display_name: None,
                import_status: None,
            },
            data: FloatingObjectData::Shape(ShapeData {
                shape_type: "rect".to_string(),
                fill: None,
                outline: None,
                text: None,
                shadow: None,
                adjustments: None,
                scene_3d: None,
                sp_3d: None,
                ooxml: None,
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_eq!(restored.common.id, "min-1");
        assert_eq!(restored.object_type(), "shape");
        assert_eq!(restored.common.anchor.anchor_mode, AnchorMode::OneCell);
        assert!(restored.common.group_id.is_none());
        assert!(restored.common.anchor.end_row.is_none());
    }

    #[test]
    fn test_known_fields_shape() {
        let (prims, subs) = known_fields("shape");
        assert!(prims.contains(&"shapeType"));
        assert!(subs.contains(&"fill"));
        assert!(subs.contains(&"outline"));
        assert!(subs.contains(&"text"));
        assert!(subs.contains(&"shadow"));
    }

    #[test]
    fn test_known_fields_chart() {
        let (prims, subs) = known_fields("chart");
        assert!(prims.contains(&"chartType"));
        assert!(prims.contains(&"subType"));
        assert!(prims.contains(&"seriesOrientation"));
        assert!(prims.contains(&"dataRange"));
        assert!(
            !prims.contains(&"dataRangeIdentity"),
            "dataRangeIdentity should be a sub_object"
        );
        assert!(subs.contains(&"dataRangeIdentity"));
        assert!(subs.contains(&"seriesRangeIdentity"));
        assert!(subs.contains(&"categoryRangeIdentity"));
        assert!(prims.contains(&"title"));
        assert!(prims.contains(&"sourceTableId"));
        assert!(prims.contains(&"widthCells"));
        assert!(prims.contains(&"showLines"));
        assert!(subs.contains(&"legend"));
        assert!(subs.contains(&"axis"));
        assert!(subs.contains(&"colors"));
        assert!(subs.contains(&"series"));
        assert!(subs.contains(&"definition"));
        assert!(subs.contains(&"ooxml"));
    }

    #[test]
    fn test_extent_cx_cy_roundtrip() {
        let obj = FloatingObject {
            common: FloatingObjectCommon {
                id: "ext-1".to_string(),
                sheet_id: "sh-1".to_string(),
                anchor: FloatingObjectAnchor {
                    anchor_row: 0,
                    anchor_col: 0,
                    anchor_row_offset: 0,
                    anchor_col_offset: 0,
                    anchor_mode: AnchorMode::OneCell,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    extent_cx: Some(5000000),
                    extent_cy: Some(3000000),
                },
                width: 100.0,
                height: 50.0,
                z_index: 0,
                rotation: 0.0,
                flip_h: false,
                flip_v: false,
                locked: false,
                visible: true,
                printable: true,
                opacity: 1.0,
                name: String::new(),
                created_at: 0,
                updated_at: 0,
                group_id: None,
                anchor_cell_id: None,
                to_anchor_cell_id: None,
                lock_aspect_ratio: None,
                alt_text_title: None,
                display_name: None,
                import_status: None,
            },
            data: FloatingObjectData::Equation(EquationData {
                equation: "E=mc^2".to_string(),
            }),
        };

        let restored = yrs_roundtrip!(&obj);
        assert_eq!(restored.common.anchor.extent_cx, Some(5000000));
        assert_eq!(restored.common.anchor.extent_cy, Some(3000000));
    }
}
