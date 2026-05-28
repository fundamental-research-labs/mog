use std::collections::BTreeMap;
use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn};

use crate::domain::floating_object::*;
use crate::yrs_schema::helpers::*;

pub(super) const KEY_ANCHOR_ROW_OFFSET_EMU: &str = "anchorRowOffsetEmu";
pub(super) const KEY_ANCHOR_COL_OFFSET_EMU: &str = "anchorColOffsetEmu";
pub(super) const KEY_END_ROW_OFFSET_EMU: &str = "endRowOffsetEmu";
pub(super) const KEY_END_COL_OFFSET_EMU: &str = "endColOffsetEmu";
const KEY_EXTENT_CX_EMU: &str = "extentCxEmu";
const KEY_EXTENT_CY_EMU: &str = "extentCyEmu";
const KEY_ABSOLUTE_X_EMU: &str = "absoluteXEmu";
const KEY_ABSOLUTE_Y_EMU: &str = "absoluteYEmu";

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
    if let Some(v) = a.absolute_x {
        entries.push((KEY_ABSOLUTE_X_EMU.into(), Any::Number(v as f64)));
    }
    if let Some(v) = a.absolute_y {
        entries.push((KEY_ABSOLUTE_Y_EMU.into(), Any::Number(v as f64)));
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
        absolute_x: read_i64_aliased(map, txn, KEY_ABSOLUTE_X_EMU, "absoluteX"),
        absolute_y: read_i64_aliased(map, txn, KEY_ABSOLUTE_Y_EMU, "absoluteY"),
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
            source_table_id: read_string(map, txn, "sourceTableId"),
            table_data_columns: read_sub_object::<Vec<String>, _>(map, txn, "tableDataColumns"),
            table_category_column: read_string(map, txn, "tableCategoryColumn"),
            use_table_column_names_as_labels: read_bool(map, txn, "useTableColumnNamesAsLabels"),
            table_column_names: read_sub_object::<Vec<String>, _>(map, txn, "tableColumnNames"),
            width_cells: read_number(map, txn, "widthCells"),
            height_cells: read_number(map, txn, "heightCells"),
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
