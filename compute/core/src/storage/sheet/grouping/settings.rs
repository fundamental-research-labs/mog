use cell_types::SheetId;
use yrs::{Doc, MapRef};

use super::types::OutlineSettingsUpdate;
use super::yrs_io::{get_sheet_grouping_config, set_sheet_grouping_config};

pub fn set_outline_settings(
    doc: &Doc,
    sheets: &MapRef,
    sheet_id: &SheetId,
    settings: &OutlineSettingsUpdate,
) {
    let mut config = get_sheet_grouping_config(doc, sheets, sheet_id);
    if let Some(v) = settings.summary_rows_below {
        config.summary_rows_below = v;
    }
    if let Some(v) = settings.summary_columns_right {
        config.summary_columns_right = v;
    }
    if let Some(v) = settings.show_outline_symbols {
        config.show_outline_symbols = v;
    }
    if let Some(v) = settings.show_outline_level_buttons {
        config.show_outline_level_buttons = v;
    }
    set_sheet_grouping_config(doc, sheets, sheet_id, &config);
}

// =============================================================================
// Rendering
// =============================================================================
