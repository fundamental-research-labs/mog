use std::collections::BTreeMap;
use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn};

use crate::domain::floating_object::*;
use crate::yrs_schema::helpers::read_string;

use super::codec_helpers::{read_sub_object, sub_object_to_any};

pub(super) fn append_drawing_entries(entries: &mut Vec<(String, Any)>, d: &DrawingData) {
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

pub(super) fn read_drawing_or_legacy<R: ReadTxn>(
    map: &MapRef,
    txn: &R,
    common: &FloatingObjectCommon,
) -> Result<DrawingData, FloatingObject> {
    let mut strokes: BTreeMap<String, InkStroke> = BTreeMap::new();
    for (key, _value) in map.iter(txn) {
        if let Some(stroke_id) = key.strip_prefix("stroke:")
            && let Some(stroke) = read_sub_object::<InkStroke, _>(map, txn, key)
        {
            strokes.insert(stroke_id.to_string(), stroke);
        }
    }
    let tool_state: InkToolState = read_sub_object(map, txn, "toolState").unwrap_or_default();
    let recognitions: BTreeMap<String, RecognitionResult> =
        read_sub_object(map, txn, "recognitions").unwrap_or_default();
    let background_color: Option<String> = read_string(map, txn, "backgroundColor");

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

        return Err(FloatingObject {
            common: common.clone(),
            data: FloatingObjectData::Drawing(DrawingData {
                strokes: old_strokes,
                tool_state: old_tool_state,
                recognitions: old_recognitions,
                background_color: old_bg,
                ooxml: None,
            }),
        });
    }

    Ok(DrawingData {
        strokes,
        tool_state,
        recognitions,
        background_color,
        ooxml: None,
    })
}
