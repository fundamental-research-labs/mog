use std::sync::Arc;

use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use crate::domain::floating_object::*;
use crate::yrs_schema::helpers::*;

use super::codec_helpers::{
    anchor_mode_to_str, option_sub_object, read_i64_aliased, read_sub_object, str_to_anchor_mode,
};
use super::keys::{
    KEY_ABSOLUTE_X_EMU, KEY_ABSOLUTE_Y_EMU, KEY_ANCHOR_COL_OFFSET_EMU, KEY_ANCHOR_ROW_OFFSET_EMU,
    KEY_END_COL_OFFSET_EMU, KEY_END_ROW_OFFSET_EMU, KEY_EXTENT_CX_EMU, KEY_EXTENT_CY_EMU,
};

pub(super) fn append_common_entries(entries: &mut Vec<(String, Any)>, obj: &FloatingObject) {
    let c = &obj.common;
    let a = &c.anchor;

    entries.extend([
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
    ]);

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
}

pub(super) fn read_common<R: ReadTxn>(
    map: &MapRef,
    txn: &R,
    id: String,
    sheet_id: String,
) -> FloatingObjectCommon {
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

    FloatingObjectCommon {
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
    }
}
