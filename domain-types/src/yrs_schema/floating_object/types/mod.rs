use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use crate::domain::floating_object::*;
use crate::yrs_schema::helpers::read_string;

mod chart;
mod codec_helpers;
mod common;
mod drawing;
mod embedded;
mod fields;
mod keys;
mod shapes;

use chart::{append_chart_entries, read_chart};
use common::{append_common_entries, read_common};
use drawing::{append_drawing_entries, read_drawing_or_legacy};
pub use fields::known_fields;

use embedded::{
    append_camera_entries, append_diagram_entries, append_equation_entries,
    append_form_control_entries, append_ole_object_entries, read_camera, read_diagram,
    read_equation, read_form_control, read_ole_object,
};
pub use keys::{
    KEY_ANCHOR_COL_OFFSET_EMU, KEY_ANCHOR_ROW_OFFSET_EMU, KEY_END_COL_OFFSET_EMU,
    KEY_END_ROW_OFFSET_EMU,
};
use shapes::{
    append_connector_entries, append_picture_entries, append_shape_entries, append_textbox_entries,
    read_connector, read_picture, read_shape, read_textbox,
};

// ── to_yrs_prelim ────────────────────────────────────────────────────

/// Write a FloatingObject to Y.Map prelim entries.
///
/// Returns `Vec<(String, Any)>` because drawing objects use dynamic keys
/// (`stroke:{id}`) that require owned strings. All entries are consumed
/// immediately by `MapPrelim::from_iter` which accepts `String: Into<Arc<str>>`.
pub fn to_yrs_prelim(obj: &FloatingObject) -> Vec<(String, Any)> {
    let mut entries: Vec<(String, Any)> = Vec::new();
    append_common_entries(&mut entries, obj);

    // Per-type fields
    match &obj.data {
        FloatingObjectData::Shape(d) => {
            append_shape_entries(&mut entries, d);
        }
        FloatingObjectData::Connector(d) => {
            append_connector_entries(&mut entries, d);
        }
        FloatingObjectData::Picture(d) => {
            append_picture_entries(&mut entries, d);
        }
        FloatingObjectData::Textbox(d) => {
            append_textbox_entries(&mut entries, d);
        }
        FloatingObjectData::Chart(d) => {
            append_chart_entries(&mut entries, d);
        }
        FloatingObjectData::Camera(d) => {
            append_camera_entries(&mut entries, d);
        }
        FloatingObjectData::Equation(d) => {
            append_equation_entries(&mut entries, d);
        }
        FloatingObjectData::Diagram(d) => {
            append_diagram_entries(&mut entries, d);
        }
        FloatingObjectData::Drawing(d) => {
            append_drawing_entries(&mut entries, d);
        }
        FloatingObjectData::OleObject(d) => {
            append_ole_object_entries(&mut entries, d);
        }
        FloatingObjectData::FormControl(d) => {
            append_form_control_entries(&mut entries, d);
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

    let common = read_common(map, txn, id, sheet_id);

    let data = match type_str.as_str() {
        "shape" => FloatingObjectData::Shape(read_shape(map, txn)),
        "connector" => FloatingObjectData::Connector(read_connector(map, txn)),
        "picture" => FloatingObjectData::Picture(read_picture(map, txn)),
        "textbox" => FloatingObjectData::Textbox(read_textbox(map, txn)),
        "chart" => FloatingObjectData::Chart(read_chart(map, txn)),
        "camera" => FloatingObjectData::Camera(read_camera(map, txn)),
        "equation" => FloatingObjectData::Equation(read_equation(map, txn)),
        "diagram" => FloatingObjectData::Diagram(read_diagram(map, txn)),
        "drawing" => {
            let data = match read_drawing_or_legacy(map, txn, &common) {
                Ok(data) => data,
                Err(obj) => return Some(obj),
            };
            FloatingObjectData::Drawing(data)
        }
        "oleObject" => FloatingObjectData::OleObject(read_ole_object(map, txn)),
        "formControl" => FloatingObjectData::FormControl(read_form_control(map, txn)),
        "slicer" => FloatingObjectData::Slicer(SlicerData::default()),
        // Unknown type — default to Drawing with empty data
        _ => FloatingObjectData::Drawing(DrawingData::default()),
    };

    Some(FloatingObject { common, data })
}
