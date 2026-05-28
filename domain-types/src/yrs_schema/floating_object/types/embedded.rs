use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use crate::domain::floating_object::*;
use crate::yrs_schema::helpers::{read_bool, read_string};

use super::codec_helpers::{option_sub_object, read_sub_object, sub_object_to_any};

pub(super) fn append_camera_entries(entries: &mut Vec<(String, Any)>, d: &CameraData) {
    entries.push((
        "sourceRef".into(),
        Any::String(Arc::from(d.source_ref.as_str())),
    ));
    if let Some(ref v) = d.error {
        entries.push(("error".into(), Any::String(Arc::from(v.as_str()))));
    }
}

pub(super) fn read_camera<R: ReadTxn>(map: &MapRef, txn: &R) -> CameraData {
    CameraData {
        source_ref: read_string(map, txn, "sourceRef").unwrap_or_default(),
        error: read_string(map, txn, "error"),
    }
}

pub(super) fn append_equation_entries(entries: &mut Vec<(String, Any)>, d: &EquationData) {
    entries.push((
        "equation".into(),
        Any::String(Arc::from(d.equation.as_str())),
    ));
}

pub(super) fn read_equation<R: ReadTxn>(map: &MapRef, txn: &R) -> EquationData {
    EquationData {
        equation: read_string(map, txn, "equation").unwrap_or_default(),
    }
}

pub(super) fn append_diagram_entries(entries: &mut Vec<(String, Any)>, d: &DiagramData) {
    entries.push(("definition".into(), sub_object_to_any(&d.definition)));
    if let Some(ref c) = d.category {
        let s = serde_json::to_value(c)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();
        entries.push(("category".into(), Any::String(Arc::from(s.as_str()))));
    }
}

pub(super) fn read_diagram<R: ReadTxn>(map: &MapRef, txn: &R) -> DiagramData {
    DiagramData {
        definition: read_sub_object(map, txn, "definition").unwrap_or_default(),
        category: read_string(map, txn, "category")
            .and_then(|s| serde_json::from_value(serde_json::Value::String(s)).ok()),
    }
}

pub(super) fn append_ole_object_entries(entries: &mut Vec<(String, Any)>, d: &OleObjectData) {
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

pub(super) fn read_ole_object<R: ReadTxn>(map: &MapRef, txn: &R) -> OleObjectData {
    OleObjectData {
        prog_id: read_string(map, txn, "progId").unwrap_or_default(),
        dv_aspect: read_string(map, txn, "dvAspect").unwrap_or_default(),
        is_linked: read_bool(map, txn, "isLinked").unwrap_or(false),
        is_embedded: read_bool(map, txn, "isEmbedded").unwrap_or(false),
        preview_image_src: read_string(map, txn, "previewImageSrc"),
        alt_text: read_string(map, txn, "altText"),
        ooxml: read_sub_object(map, txn, "ooxml"),
    }
}

pub(super) fn append_form_control_entries(entries: &mut Vec<(String, Any)>, d: &FormControlData) {
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

pub(super) fn read_form_control<R: ReadTxn>(map: &MapRef, txn: &R) -> FormControlData {
    FormControlData {
        control_type: read_string(map, txn, "controlType").unwrap_or_default(),
        cell_link: read_string(map, txn, "cellLink"),
        input_range: read_string(map, txn, "inputRange"),
        ooxml: read_sub_object(map, txn, "ooxml"),
    }
}
