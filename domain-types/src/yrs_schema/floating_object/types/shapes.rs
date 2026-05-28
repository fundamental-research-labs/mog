use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use crate::domain::floating_object::*;
use crate::yrs_schema::helpers::{read_number, read_string};

use super::codec_helpers::{option_sub_object, read_sub_object};

pub(super) fn append_shape_entries(entries: &mut Vec<(String, Any)>, d: &ShapeData) {
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

pub(super) fn read_shape<R: ReadTxn>(map: &MapRef, txn: &R) -> ShapeData {
    ShapeData {
        shape_type: read_string(map, txn, "shapeType").unwrap_or_default(),
        fill: read_sub_object(map, txn, "fill"),
        outline: read_sub_object(map, txn, "outline"),
        text: read_sub_object(map, txn, "text"),
        shadow: read_sub_object(map, txn, "shadow"),
        adjustments: read_sub_object(map, txn, "adjustments"),
        scene_3d: read_sub_object(map, txn, "scene3d"),
        sp_3d: read_sub_object(map, txn, "sp3d"),
        ooxml: read_sub_object(map, txn, "ooxml"),
    }
}

pub(super) fn append_connector_entries(entries: &mut Vec<(String, Any)>, d: &ConnectorData) {
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

pub(super) fn read_connector<R: ReadTxn>(map: &MapRef, txn: &R) -> ConnectorData {
    ConnectorData {
        shape_type: read_string(map, txn, "shapeType").unwrap_or_default(),
        fill: read_sub_object(map, txn, "fill"),
        outline: read_sub_object(map, txn, "outline"),
        start_connection: read_sub_object(map, txn, "startConnection"),
        end_connection: read_sub_object(map, txn, "endConnection"),
        adjustments: read_sub_object(map, txn, "adjustments"),
        ooxml: read_sub_object(map, txn, "ooxml"),
    }
}

pub(super) fn append_picture_entries(entries: &mut Vec<(String, Any)>, d: &PictureData) {
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

pub(super) fn read_picture<R: ReadTxn>(map: &MapRef, txn: &R) -> PictureData {
    PictureData {
        src: read_string(map, txn, "src").unwrap_or_default(),
        original_width: read_number(map, txn, "originalWidth"),
        original_height: read_number(map, txn, "originalHeight"),
        crop: read_sub_object(map, txn, "crop"),
        adjustments: read_sub_object(map, txn, "adjustments"),
        border: read_sub_object(map, txn, "border"),
        color_type: read_sub_object(map, txn, "colorType"),
        ooxml: read_sub_object(map, txn, "ooxml"),
    }
}

pub(super) fn append_textbox_entries(entries: &mut Vec<(String, Any)>, d: &TextboxData) {
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

pub(super) fn read_textbox<R: ReadTxn>(map: &MapRef, txn: &R) -> TextboxData {
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
    TextboxData {
        text,
        fill: read_sub_object(map, txn, "fill"),
        border: read_sub_object(map, txn, "border"),
        text_effects: read_sub_object(map, txn, "textEffects"),
        ooxml: read_sub_object(map, txn, "ooxml"),
    }
}
