//! YrsSchema for named ranges (defined names) — flat Y.Map with native keys.
//!
//! Fields: id, name, refersTo, scope, comment, visible.
//! All are scalar primitives stored as native Yrs `Any` values.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use crate::domain::named_range::DefinedName;

use super::helpers::*;

// ── Y.Map keys ───────────────────────────────────────────────────────
pub const KEY_ID: &str = "id";
pub const KEY_NAME: &str = "name";
pub const KEY_REFERS_TO: &str = "refersTo";
pub const KEY_RAW_REFERS_TO: &str = "rawRefersTo";
pub const KEY_SCOPE: &str = "scope";
pub const KEY_COMMENT: &str = "comment";
pub const KEY_CUSTOM_MENU: &str = "customMenu";
pub const KEY_DESCRIPTION: &str = "description";
pub const KEY_HELP: &str = "help";
pub const KEY_STATUS_BAR: &str = "statusBar";
pub const KEY_VISIBLE: &str = "visible";
pub const KEY_ORDER: &str = "order";
pub const KEY_XLM: &str = "xlm";
pub const KEY_FUNCTION: &str = "function";
pub const KEY_VB_PROCEDURE: &str = "vbProcedure";
pub const KEY_PUBLISH_TO_SERVER: &str = "publishToServer";
pub const KEY_WORKBOOK_PARAMETER: &str = "workbookParameter";
pub const KEY_XML_SPACE_PRESERVE: &str = "xmlSpacePreserve";
pub const KEY_LINKED_RANGE_ID: &str = "linkedRangeId";

/// Write a named range to Y.Map prelim entries.
pub fn to_yrs_prelim(nr: &DefinedName) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(nr.id.as_str()))),
        (KEY_NAME, Any::String(Arc::from(nr.name.as_str()))),
        (KEY_REFERS_TO, Any::String(Arc::from(nr.refers_to.as_str()))),
        (KEY_VISIBLE, Any::Bool(nr.visible)),
    ];

    match &nr.scope {
        Some(s) => entries.push((KEY_SCOPE, Any::String(Arc::from(s.as_str())))),
        None => entries.push((KEY_SCOPE, Any::Null)),
    }

    match &nr.comment {
        Some(c) => entries.push((KEY_COMMENT, Any::String(Arc::from(c.as_str())))),
        None => entries.push((KEY_COMMENT, Any::Null)),
    }
    if let Some(custom_menu) = &nr.custom_menu {
        entries.push((
            KEY_CUSTOM_MENU,
            Any::String(Arc::from(custom_menu.as_str())),
        ));
    }
    if let Some(description) = &nr.description {
        entries.push((
            KEY_DESCRIPTION,
            Any::String(Arc::from(description.as_str())),
        ));
    }
    if let Some(help) = &nr.help {
        entries.push((KEY_HELP, Any::String(Arc::from(help.as_str()))));
    }
    if let Some(status_bar) = &nr.status_bar {
        entries.push((KEY_STATUS_BAR, Any::String(Arc::from(status_bar.as_str()))));
    }

    if let Some(order) = nr.order {
        entries.push((KEY_ORDER, Any::Number(order as f64)));
    }
    if nr.xlm {
        entries.push((KEY_XLM, Any::Bool(true)));
    }
    if nr.function {
        entries.push((KEY_FUNCTION, Any::Bool(true)));
    }
    if nr.vb_procedure {
        entries.push((KEY_VB_PROCEDURE, Any::Bool(true)));
    }
    if nr.publish_to_server {
        entries.push((KEY_PUBLISH_TO_SERVER, Any::Bool(true)));
    }
    if nr.workbook_parameter {
        entries.push((KEY_WORKBOOK_PARAMETER, Any::Bool(true)));
    }
    if nr.xml_space_preserve {
        entries.push((KEY_XML_SPACE_PRESERVE, Any::Bool(true)));
    }
    if let Some(ref rid) = nr.linked_range_id {
        entries.push((
            KEY_LINKED_RANGE_ID,
            Any::String(Arc::from(rid.to_uuid_string().as_str())),
        ));
    }
    if let Some(raw) = &nr.raw_refers_to {
        entries.push((KEY_RAW_REFERS_TO, Any::String(Arc::from(raw.as_str()))));
    }

    entries
}

/// Read a named range from a Y.Map. Returns `None` if required fields are missing.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<DefinedName> {
    let linked_range_id = read_string(map, txn, KEY_LINKED_RANGE_ID)
        .and_then(|s| cell_types::RangeId::from_uuid_str(&s).ok());

    Some(DefinedName {
        id: read_string(map, txn, KEY_ID)?,
        name: read_string(map, txn, KEY_NAME)?,
        refers_to: read_string(map, txn, KEY_REFERS_TO)?,
        raw_refers_to: read_string(map, txn, KEY_RAW_REFERS_TO),
        scope: read_string(map, txn, KEY_SCOPE),
        comment: read_string(map, txn, KEY_COMMENT),
        custom_menu: read_string(map, txn, KEY_CUSTOM_MENU),
        description: read_string(map, txn, KEY_DESCRIPTION),
        help: read_string(map, txn, KEY_HELP),
        status_bar: read_string(map, txn, KEY_STATUS_BAR),
        visible: read_bool(map, txn, KEY_VISIBLE).unwrap_or(true),
        order: read_i64(map, txn, KEY_ORDER).map(|v| v as u32),
        xlm: read_bool(map, txn, KEY_XLM).unwrap_or(false),
        function: read_bool(map, txn, KEY_FUNCTION).unwrap_or(false),
        vb_procedure: read_bool(map, txn, KEY_VB_PROCEDURE).unwrap_or(false),
        publish_to_server: read_bool(map, txn, KEY_PUBLISH_TO_SERVER).unwrap_or(false),
        workbook_parameter: read_bool(map, txn, KEY_WORKBOOK_PARAMETER).unwrap_or(false),
        xml_space_preserve: read_bool(map, txn, KEY_XML_SPACE_PRESERVE).unwrap_or(false),
        linked_range_id,
    })
}

/// Update a single field on an existing named range Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
