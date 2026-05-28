//! Yrs schema for [`Hyperlink`] — flat Y.Map with cellRef required.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::hyperlink::{Hyperlink, HyperlinkTargetKind};

pub const KEY_CELL_REF: &str = "cellRef";
pub const KEY_TARGET: &str = "target";
pub const KEY_LOCATION: &str = "location";
pub const KEY_DISPLAY: &str = "display";
pub const KEY_TOOLTIP: &str = "tooltip";
pub const KEY_TARGET_KIND: &str = "targetKind";
pub const KEY_TARGET_MODE: &str = "targetMode";

/// Convert a [`Hyperlink`] to Yrs prelim entries for initial hydration.
pub fn to_yrs_prelim(link: &Hyperlink) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> =
        vec![(KEY_CELL_REF, Any::String(Arc::from(link.cell_ref.as_str())))];
    if let Some(target) = &link.target {
        entries.push((KEY_TARGET, Any::String(Arc::from(target.as_str()))));
    }
    if let Some(location) = &link.location {
        entries.push((KEY_LOCATION, Any::String(Arc::from(location.as_str()))));
    }
    if let Some(display) = &link.display {
        entries.push((KEY_DISPLAY, Any::String(Arc::from(display.as_str()))));
    }
    if let Some(tooltip) = &link.tooltip {
        entries.push((KEY_TOOLTIP, Any::String(Arc::from(tooltip.as_str()))));
    }
    if let Some(target_kind) = link.target_kind {
        entries.push((
            KEY_TARGET_KIND,
            Any::String(Arc::from(target_kind_to_str(target_kind))),
        ));
    }
    if let Some(target_mode) = &link.target_mode {
        entries.push((
            KEY_TARGET_MODE,
            Any::String(Arc::from(target_mode.as_str())),
        ));
    }
    entries
}

/// Read a [`Hyperlink`] from a Y.Map. Returns `None` if cellRef is missing.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<Hyperlink> {
    Some(Hyperlink {
        cell_ref: read_string(map, txn, KEY_CELL_REF)?,
        target: read_string(map, txn, KEY_TARGET),
        location: read_string(map, txn, KEY_LOCATION),
        display: read_string(map, txn, KEY_DISPLAY),
        tooltip: read_string(map, txn, KEY_TOOLTIP),
        uid: None,
        target_kind: read_string(map, txn, KEY_TARGET_KIND)
            .as_deref()
            .and_then(target_kind_from_str),
        target_mode: read_string(map, txn, KEY_TARGET_MODE),
    })
}

/// Update a single field on an existing Hyperlink Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}

fn target_kind_to_str(kind: HyperlinkTargetKind) -> &'static str {
    match kind {
        HyperlinkTargetKind::InlineLocation => "inlineLocation",
        HyperlinkTargetKind::Relationship => "relationship",
    }
}

fn target_kind_from_str(value: &str) -> Option<HyperlinkTargetKind> {
    match value {
        "inlineLocation" => Some(HyperlinkTargetKind::InlineLocation),
        "relationship" => Some(HyperlinkTargetKind::Relationship),
        _ => None,
    }
}
