//! Yrs schema for [`WorkbookProperties`] — flat Y.Map within `workbookSettings`.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, Map, ReadTxn, TransactionMut};

use super::helpers::*;
use crate::domain::workbook::{ObjectDisplayMode, UpdateLinks, WorkbookProperties};

// ─── Key constants ──────────────────────────────────────────────────────────
// Note: KEY_DATE1904 MUST stay as "date1904" — existing documents already use this key.

pub const KEY_DATE1904: &str = "date1904";
pub const KEY_SHOW_OBJECTS: &str = "showObjects";
pub const KEY_SHOW_BORDER_UNSELECTED_TABLES: &str = "showBorderUnselectedTables";
pub const KEY_FILTER_PRIVACY: &str = "filterPrivacy";
pub const KEY_PROMPTED_SOLUTIONS: &str = "promptedSolutions";
pub const KEY_SHOW_INK_ANNOTATION: &str = "showInkAnnotation";
pub const KEY_BACKUP_FILE: &str = "backupFile";
pub const KEY_SAVE_EXTERNAL_LINK_VALUES: &str = "saveExternalLinkValues";
pub const KEY_UPDATE_LINKS: &str = "updateLinks";
pub const KEY_CODE_NAME: &str = "codeName";
pub const KEY_HIDE_PIVOT_FIELD_LIST: &str = "hidePivotFieldList";
pub const KEY_SHOW_PIVOT_CHART_FILTER: &str = "showPivotChartFilter";
pub const KEY_ALLOW_REFRESH_QUERY: &str = "allowRefreshQuery";
pub const KEY_PUBLISH_ITEMS: &str = "publishItems";
pub const KEY_CHECK_COMPATIBILITY: &str = "checkCompatibility";
pub const KEY_AUTO_COMPRESS_PICTURES: &str = "autoCompressPictures";
pub const KEY_REFRESH_ALL_CONNECTIONS: &str = "refreshAllConnections";
pub const KEY_DEFAULT_THEME_VERSION: &str = "defaultThemeVersion";

// ─── Enum <-> String helpers ────────────────────────────────────────────────

fn object_display_mode_to_str(mode: &ObjectDisplayMode) -> &'static str {
    match mode {
        ObjectDisplayMode::All => "all",
        ObjectDisplayMode::Placeholders => "placeholders",
        ObjectDisplayMode::None => "none",
    }
}

fn str_to_object_display_mode(s: &str) -> ObjectDisplayMode {
    match s {
        "placeholders" => ObjectDisplayMode::Placeholders,
        "none" => ObjectDisplayMode::None,
        _ => ObjectDisplayMode::All,
    }
}

fn update_links_to_str(mode: &UpdateLinks) -> &'static str {
    match mode {
        UpdateLinks::UserSet => "userSet",
        UpdateLinks::Never => "never",
        UpdateLinks::Always => "always",
    }
}

fn str_to_update_links(s: &str) -> UpdateLinks {
    match s {
        "never" => UpdateLinks::Never,
        "always" => UpdateLinks::Always,
        _ => UpdateLinks::UserSet,
    }
}

// ─── to_yrs_prelim ─────────────────────────────────────────────────────────

/// Convert a [`WorkbookProperties`] to Yrs prelim entries for initial hydration.
///
/// These entries are written into the existing `workbookSettings` map.
pub fn to_yrs_prelim(props: &WorkbookProperties) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_DATE1904, Any::Bool(props.date1904)),
        (
            KEY_SHOW_OBJECTS,
            Any::String(Arc::from(object_display_mode_to_str(&props.show_objects))),
        ),
        (
            KEY_SHOW_BORDER_UNSELECTED_TABLES,
            Any::Bool(props.show_border_unselected_tables),
        ),
        (KEY_FILTER_PRIVACY, Any::Bool(props.filter_privacy)),
        (KEY_PROMPTED_SOLUTIONS, Any::Bool(props.prompted_solutions)),
        (
            KEY_SHOW_INK_ANNOTATION,
            Any::Bool(props.show_ink_annotation),
        ),
        (KEY_BACKUP_FILE, Any::Bool(props.backup_file)),
        (
            KEY_SAVE_EXTERNAL_LINK_VALUES,
            Any::Bool(props.save_external_link_values),
        ),
        (
            KEY_UPDATE_LINKS,
            Any::String(Arc::from(update_links_to_str(&props.update_links))),
        ),
        (
            KEY_HIDE_PIVOT_FIELD_LIST,
            Any::Bool(props.hide_pivot_field_list),
        ),
        (
            KEY_SHOW_PIVOT_CHART_FILTER,
            Any::Bool(props.show_pivot_chart_filter),
        ),
        (
            KEY_ALLOW_REFRESH_QUERY,
            Any::Bool(props.allow_refresh_query),
        ),
        (KEY_PUBLISH_ITEMS, Any::Bool(props.publish_items)),
        (
            KEY_CHECK_COMPATIBILITY,
            Any::Bool(props.check_compatibility),
        ),
        (
            KEY_AUTO_COMPRESS_PICTURES,
            Any::Bool(props.auto_compress_pictures),
        ),
        (
            KEY_REFRESH_ALL_CONNECTIONS,
            Any::Bool(props.refresh_all_connections),
        ),
    ];
    if let Some(cn) = &props.code_name {
        entries.push((KEY_CODE_NAME, Any::String(Arc::from(cn.as_str()))));
    }
    if let Some(tv) = props.default_theme_version {
        entries.push((KEY_DEFAULT_THEME_VERSION, Any::Number(tv as f64)));
    }
    entries
}

// ─── from_yrs_map ───────────────────────────────────────────────────────────

/// Read a [`WorkbookProperties`] from a Y.Map (the `workbookSettings` map).
///
/// Tolerates missing keys gracefully — returns defaults for absent fields.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> WorkbookProperties {
    WorkbookProperties {
        date1904: read_bool(map, txn, KEY_DATE1904).unwrap_or(false),
        show_objects: read_string(map, txn, KEY_SHOW_OBJECTS)
            .map(|s| str_to_object_display_mode(&s))
            .unwrap_or_default(),
        show_border_unselected_tables: read_bool(map, txn, KEY_SHOW_BORDER_UNSELECTED_TABLES)
            .unwrap_or(true),
        filter_privacy: read_bool(map, txn, KEY_FILTER_PRIVACY).unwrap_or(false),
        prompted_solutions: read_bool(map, txn, KEY_PROMPTED_SOLUTIONS).unwrap_or(false),
        show_ink_annotation: read_bool(map, txn, KEY_SHOW_INK_ANNOTATION).unwrap_or(true),
        backup_file: read_bool(map, txn, KEY_BACKUP_FILE).unwrap_or(false),
        save_external_link_values: read_bool(map, txn, KEY_SAVE_EXTERNAL_LINK_VALUES)
            .unwrap_or(true),
        update_links: read_string(map, txn, KEY_UPDATE_LINKS)
            .map(|s| str_to_update_links(&s))
            .unwrap_or_default(),
        code_name: read_string(map, txn, KEY_CODE_NAME),
        hide_pivot_field_list: read_bool(map, txn, KEY_HIDE_PIVOT_FIELD_LIST).unwrap_or(false),
        show_pivot_chart_filter: read_bool(map, txn, KEY_SHOW_PIVOT_CHART_FILTER).unwrap_or(false),
        allow_refresh_query: read_bool(map, txn, KEY_ALLOW_REFRESH_QUERY).unwrap_or(false),
        publish_items: read_bool(map, txn, KEY_PUBLISH_ITEMS).unwrap_or(false),
        check_compatibility: read_bool(map, txn, KEY_CHECK_COMPATIBILITY).unwrap_or(false),
        auto_compress_pictures: read_bool(map, txn, KEY_AUTO_COMPRESS_PICTURES).unwrap_or(true),
        refresh_all_connections: read_bool(map, txn, KEY_REFRESH_ALL_CONNECTIONS).unwrap_or(false),
        default_theme_version: read_u32(map, txn, KEY_DEFAULT_THEME_VERSION),
    }
}

/// Update a single field on an existing workbook properties Y.Map.
pub fn update_field(map: &MapRef, txn: &mut TransactionMut, key: &str, value: Any) {
    map.insert(txn, key, value);
}
