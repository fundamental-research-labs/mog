//! Typed sheet settings, exposed through the existing string-key API boundary.
use crate::storage::WorkbookStorage;
use cell_types::SheetId;
use domain_types::domain::sheet::{SheetProtectionOptions, SheetSettings};
use domain_types::units::{
    CharWidth, LayoutMetrics, Pixels, Points, pixels_to_char_width, pixels_to_points,
    points_to_pixels, resolve_default_column_width,
};

pub const SHEET_SETTINGS_KEYS: &[&str] = &[
    // SheetViewOptions
    "showGridlines",
    "showRowHeaders",
    "showColumnHeaders",
    "rightToLeft",
    "showFormulas",
    "showZeroValues",
    "zoomScale",
    // Protection
    "protectionDetails",
    // Other settings stored on the sheet meta map
    "gridlineColor",
    "defaultRowHeight",
    "defaultColWidth",
    "customProperties",
];

pub fn is_sheet_settings_key(key: &str) -> bool {
    SHEET_SETTINGS_KEYS.contains(&key)
}

#[cfg(test)]
pub(crate) fn get_sheet_settings(storage: &WorkbookStorage, sheet_id: &SheetId) -> SheetSettings {
    get_sheet_settings_with_layout_metrics(storage, sheet_id, LayoutMetrics::default())
}

pub(crate) fn get_sheet_settings_with_layout_metrics(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
    layout_metrics: LayoutMetrics,
) -> SheetSettings {
    let Some(meta) = storage.sheet_metadata.get(sheet_id) else {
        return SheetSettings {
            default_row_height: layout_metrics.default_row_height_px,
            default_col_width: layout_metrics.default_column_width_px,
            ..SheetSettings::default()
        };
    };
    SheetSettings {
        show_gridlines: meta.view.show_gridlines,
        show_row_headers: meta.view.show_row_headers,
        show_column_headers: meta.view.show_column_headers,
        show_zero_values: meta.view.show_zeros,
        right_to_left: meta.view.right_to_left,
        show_formulas: meta.view.show_formulas,
        zoom_scale: meta.view.zoom_scale,
        gridline_color: meta.gridline_color.clone(),
        custom_properties: meta.custom_properties.clone(),
        is_protected: meta
            .protection
            .as_ref()
            .is_some_and(|protection| protection.is_protected),
        protection_password_hash: meta
            .protection
            .as_ref()
            .and_then(|protection| protection.password_hash.clone()),
        protection_options: meta.protection.as_ref().map(SheetProtectionOptions::from),
        default_row_height: points_to_pixels(Points(
            meta.format.default_row_height.unwrap_or(15.0),
        ))
        .0,
        default_col_width: resolve_default_column_width(
            meta.format.default_col_width.map(CharWidth),
            meta.format.base_col_width,
            layout_metrics,
        )
        .pixels
        .0,
    }
}

#[cfg(test)]
pub(crate) fn set_sheet_setting(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    key: &str,
    value: &str,
) {
    set_sheet_setting_with_layout_metrics(storage, sheet_id, key, value, LayoutMetrics::default());
}

pub(crate) fn set_sheet_setting_with_layout_metrics(
    storage: &mut WorkbookStorage,
    sheet_id: &SheetId,
    key: &str,
    value: &str,
    layout_metrics: LayoutMetrics,
) {
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_gridlines
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_row_headers
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_column_headers
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_zeros
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.right_to_left
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.show_formulas
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        view.zoom_scale
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        gridline_color
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        custom_properties
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        format.default_row_height
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(
        storage,
        *sheet_id,
        format.default_col_width
    );
    crate::storage::engine::history::metadata::capture_sheet_field!(storage, *sheet_id, protection);
    let Some(meta) = storage.sheet_metadata.get_mut(sheet_id) else {
        return;
    };
    match key {
        "showGridlines" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.view.show_gridlines = value;
            }
        }
        "showRowHeaders" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.view.show_row_headers = value;
            }
        }
        "showColumnHeaders" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.view.show_column_headers = value;
            }
        }
        "showZeroValues" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.view.show_zeros = value;
            }
        }
        "rightToLeft" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.view.right_to_left = value;
            }
        }
        "showFormulas" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.view.show_formulas = value;
            }
        }
        "zoomScale" => {
            if let Ok(value) = value.parse::<u32>() {
                meta.view.zoom_scale = Some(value);
            }
        }
        "gridlineColor" => meta.gridline_color = Some(value.to_owned()),
        "customProperties" => meta.custom_properties = Some(value.to_owned()),
        "defaultRowHeight" => {
            if let Ok(value) = value.parse::<f64>()
                && value.is_finite()
            {
                meta.format.default_row_height = Some(pixels_to_points(Pixels(value)).0);
            }
        }
        "defaultColWidth" => {
            if let Ok(value) = value.parse::<f64>()
                && value.is_finite()
            {
                meta.format.default_col_width =
                    Some(pixels_to_char_width(Pixels(value), layout_metrics.column_width_mdw).0);
            }
        }
        "protectionPasswordHash" => {
            let protection = meta.protection.get_or_insert_with(Default::default);
            protection.password_hash = if value.is_empty() || value == "null" {
                None
            } else {
                Some(value.to_owned())
            };
        }
        "isProtected" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .is_protected = value;
            }
        }
        "selectLockedCells" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .select_locked = value;
            }
        }
        "selectUnlockedCells" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .select_unlocked = value;
            }
        }
        "formatCells" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .format_cells = value;
            }
        }
        "formatColumns" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .format_columns = value;
            }
        }
        "formatRows" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .format_rows = value;
            }
        }
        "insertColumns" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .insert_columns = value;
            }
        }
        "insertRows" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .insert_rows = value;
            }
        }
        "insertHyperlinks" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .insert_hyperlinks = value;
            }
        }
        "deleteColumns" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .delete_columns = value;
            }
        }
        "deleteRows" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .delete_rows = value;
            }
        }
        "sort" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection.get_or_insert_with(Default::default).sort = value;
            }
        }
        "useAutoFilter" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .auto_filter = value;
            }
        }
        "usePivotTableReports" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .pivot_tables = value;
            }
        }
        "editObjects" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection.get_or_insert_with(Default::default).objects = value;
            }
        }
        "editScenarios" => {
            if let Ok(value) = value.parse::<bool>() {
                meta.protection
                    .get_or_insert_with(Default::default)
                    .scenarios = value;
            }
        }
        _ => {}
    }
}

pub struct SheetRoundtripMeta {
    pub tab_selected: bool,
    pub active_cell: Option<String>,
    pub sqref: Option<String>,
    pub uid: Option<String>,
    pub default_row_height: Option<f64>,
    pub default_col_width: Option<f64>,
    pub default_row_descent: Option<f64>,
    pub base_col_width: Option<u32>,
    pub zoom_scale_normal: Option<u32>,
    /// Whether the default row height is custom (customHeight="1" on sheetFormatPr).
    pub custom_height: bool,
    /// Whether zero-height rows are the default (zeroHeight="1" on sheetFormatPr).
    pub zero_height: bool,
    /// Whether default rows use thick top borders.
    pub thick_top: bool,
    /// Whether default rows use thick bottom borders.
    pub thick_bottom: bool,
    /// Outline level for rows (outlineLevelRow on sheetFormatPr).
    pub outline_level_row: Option<u8>,
    /// Outline level for columns (outlineLevelCol on sheetFormatPr).
    pub outline_level_col: Option<u8>,
    /// Trailing column ranges (e.g. `<col max="16384">`) preserved for round-trip fidelity.
    pub trailing_col_ranges: Vec<domain_types::TrailingColRange>,
}

pub(crate) fn get_roundtrip_meta(
    storage: &WorkbookStorage,
    sheet_id: &SheetId,
) -> SheetRoundtripMeta {
    let default_meta = super::SheetMetadata::default();
    let meta = storage
        .sheet_metadata
        .get(sheet_id)
        .unwrap_or(&default_meta);
    SheetRoundtripMeta {
        tab_selected: meta.view.tab_selected.clone(),
        active_cell: meta.view.active_cell.clone(),
        sqref: meta.view.sqref.clone(),
        uid: meta.uid.clone(),
        default_row_height: meta.format.default_row_height.clone(),
        default_col_width: meta.format.default_col_width.clone(),
        default_row_descent: meta.format.default_row_descent.clone(),
        base_col_width: meta.format.base_col_width.clone(),
        zoom_scale_normal: meta.view.zoom_scale_normal.clone(),
        custom_height: meta.format.custom_height.clone(),
        zero_height: meta.format.zero_height.clone(),
        thick_top: meta.format.thick_top.clone(),
        thick_bottom: meta.format.thick_bottom.clone(),
        outline_level_row: meta.format.outline_level_row.clone(),
        outline_level_col: meta.format.outline_level_col.clone(),
        trailing_col_ranges: meta.format.trailing_col_ranges.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::sheet::test_support::setup;

    #[test]
    fn test_sheet_settings() {
        let (mut storage, _mirror, sid) = setup();
        let settings = get_sheet_settings(&storage, &sid);
        assert!(settings.show_gridlines);
        assert!(!settings.is_protected);
        assert_eq!(settings.default_row_height, 20.0);

        set_sheet_setting(&mut storage, &sid, "showGridlines", "false");
        let settings = get_sheet_settings(&storage, &sid);
        assert!(!settings.show_gridlines);

        set_sheet_setting(&mut storage, &sid, "defaultRowHeight", "25.0");
        let settings = get_sheet_settings(&storage, &sid);
        assert_eq!(settings.default_row_height, 25.0);
    }

    #[test]
    fn test_protection_settings_are_stored_in_protection_details() {
        let (mut storage, _mirror, sid) = setup();

        set_sheet_setting(&mut storage, &sid, "isProtected", "true");
        set_sheet_setting(&mut storage, &sid, "protectionPasswordHash", "hash123");
        set_sheet_setting(&mut storage, &sid, "formatCells", "true");

        let settings = get_sheet_settings(&storage, &sid);
        assert!(settings.is_protected);
        assert_eq!(
            settings.protection_password_hash,
            Some("hash123".to_string())
        );
        assert_eq!(
            settings
                .protection_options
                .as_ref()
                .map(|opts| opts.format_cells),
            Some(true)
        );

        let protection = storage
            .sheet_metadata
            .get(&sid)
            .unwrap()
            .protection
            .as_ref()
            .unwrap();
        assert!(protection.is_protected);
        assert_eq!(protection.password_hash, Some("hash123".to_string()));
        assert!(protection.format_cells);
    }
}
