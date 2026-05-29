use domain_types::domain::hyperlink::{Hyperlink, HyperlinkTargetKind};
use yrs::{Any, Map, MapRef, Out};

use super::keys::{
    KEY_HYPERLINK, KEY_HYPERLINK_DISPLAY, KEY_HYPERLINK_LOCATION, KEY_HYPERLINK_ORDER,
    KEY_HYPERLINK_RANGE_REF, KEY_HYPERLINK_TARGET_KIND, KEY_HYPERLINK_TARGET_MODE,
    KEY_HYPERLINK_TOOLTIP, KEY_HYPERLINK_UID, TARGET_KIND_INLINE_LOCATION,
    TARGET_KIND_RELATIONSHIP,
};

pub(super) fn read_hyperlink_url<T: yrs::ReadTxn>(txn: &T, cell_map: &MapRef) -> Option<String> {
    read_string_key(txn, cell_map, KEY_HYPERLINK)
}

pub(super) fn decode_full_hyperlink<T: yrs::ReadTxn>(
    txn: &T,
    cell_map: &MapRef,
    cell_ref: String,
) -> Option<Hyperlink> {
    let target = Some(read_hyperlink_url(txn, cell_map)?);

    Some(Hyperlink {
        cell_ref,
        target,
        location: read_string_key(txn, cell_map, KEY_HYPERLINK_LOCATION),
        display: read_string_key(txn, cell_map, KEY_HYPERLINK_DISPLAY),
        tooltip: read_string_key(txn, cell_map, KEY_HYPERLINK_TOOLTIP),
        uid: read_string_key(txn, cell_map, KEY_HYPERLINK_UID),
        target_kind: read_target_kind(txn, cell_map),
        target_mode: read_string_key(txn, cell_map, KEY_HYPERLINK_TARGET_MODE),
    })
}

pub(super) fn decode_sheet_hyperlink<T: yrs::ReadTxn>(
    txn: &T,
    cell_map: &MapRef,
    fallback_cell_ref: String,
) -> Option<(u32, Hyperlink)> {
    let raw_url = read_hyperlink_url(txn, cell_map)?;
    let stored_target_kind_raw = read_string_key(txn, cell_map, KEY_HYPERLINK_TARGET_KIND);
    let stored_target_kind = stored_target_kind_raw
        .as_deref()
        .and_then(target_kind_from_str);
    let target_kind = if stored_target_kind_raw.is_some() {
        stored_target_kind
    } else if raw_url.is_empty() {
        None
    } else if raw_url.starts_with('#') {
        Some(HyperlinkTargetKind::InlineLocation)
    } else {
        Some(HyperlinkTargetKind::Relationship)
    };
    let (target, location_from_url) = target_and_location_from_stored_url(
        &raw_url,
        target_kind,
        stored_target_kind_raw.is_some(),
    );

    let location = read_string_key(txn, cell_map, KEY_HYPERLINK_LOCATION).or(location_from_url);
    let cell_ref =
        read_string_key(txn, cell_map, KEY_HYPERLINK_RANGE_REF).unwrap_or(fallback_cell_ref);
    let order = read_order(txn, cell_map);

    Some((
        order,
        Hyperlink {
            cell_ref,
            target,
            location,
            display: read_string_key(txn, cell_map, KEY_HYPERLINK_DISPLAY),
            tooltip: read_string_key(txn, cell_map, KEY_HYPERLINK_TOOLTIP),
            uid: read_string_key(txn, cell_map, KEY_HYPERLINK_UID),
            target_kind,
            target_mode: read_string_key(txn, cell_map, KEY_HYPERLINK_TARGET_MODE),
        },
    ))
}

fn target_and_location_from_stored_url(
    raw_url: &str,
    target_kind: Option<HyperlinkTargetKind>,
    has_explicit_kind: bool,
) -> (Option<String>, Option<String>) {
    if raw_url.is_empty() {
        return (None, None);
    }

    match target_kind {
        Some(HyperlinkTargetKind::Relationship) => (Some(raw_url.to_string()), None),
        Some(HyperlinkTargetKind::InlineLocation) => {
            if let Some(location) = raw_url.strip_prefix('#') {
                (None, Some(location.to_string()))
            } else {
                (None, Some(raw_url.to_string()))
            }
        }
        None if !has_explicit_kind => {
            if let Some(location) = raw_url.strip_prefix('#') {
                (None, Some(location.to_string()))
            } else {
                (Some(raw_url.to_string()), None)
            }
        }
        None => (Some(raw_url.to_string()), None),
    }
}

fn read_target_kind<T: yrs::ReadTxn>(txn: &T, cell_map: &MapRef) -> Option<HyperlinkTargetKind> {
    read_string_key(txn, cell_map, KEY_HYPERLINK_TARGET_KIND)
        .as_deref()
        .and_then(target_kind_from_str)
}

fn target_kind_from_str(value: &str) -> Option<HyperlinkTargetKind> {
    match value {
        TARGET_KIND_INLINE_LOCATION => Some(HyperlinkTargetKind::InlineLocation),
        TARGET_KIND_RELATIONSHIP => Some(HyperlinkTargetKind::Relationship),
        _ => None,
    }
}

fn read_order<T: yrs::ReadTxn>(txn: &T, cell_map: &MapRef) -> u32 {
    match cell_map.get(txn, KEY_HYPERLINK_ORDER) {
        Some(Out::Any(Any::Number(n))) => n as u32,
        _ => u32::MAX,
    }
}

fn read_string_key<T: yrs::ReadTxn>(txn: &T, cell_map: &MapRef, key: &str) -> Option<String> {
    match cell_map.get(txn, key) {
        Some(Out::Any(Any::String(s))) => Some(s.to_string()),
        _ => None,
    }
}
