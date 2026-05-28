use std::sync::Arc;

use compute_document::hex::SmallHex;
use domain_types::SheetData;
use yrs::{Any, Map, MapRef};

use crate::storage::infra::hydration::features::{
    hydrate_col_widths, hydrate_hidden_rows_cols, hydrate_row_heights,
};

pub(crate) struct DimensionMaps<'a> {
    pub meta_map: &'a MapRef,
    pub row_heights_map: &'a MapRef,
    pub col_widths_map: &'a MapRef,
    pub hidden_rows_map: &'a MapRef,
    pub manual_hidden_rows_map: &'a MapRef,
    pub hidden_cols_map: &'a MapRef,
}

pub(crate) fn hydrate_dimensions(
    txn: &mut yrs::TransactionMut,
    maps: DimensionMaps<'_>,
    row_id_hexes: &[SmallHex],
    col_id_hexes: &[SmallHex],
    sheet: &SheetData,
) {
    let sheet_default_row_height_pt = sheet.dimensions.default_row_height.unwrap_or(15.0);
    let default_col_width_cw = sheet.dimensions.default_col_width.unwrap_or(8.43);

    hydrate_row_heights(
        txn,
        maps.row_heights_map,
        row_id_hexes,
        &sheet.dimensions.row_heights,
        sheet_default_row_height_pt,
    );
    hydrate_col_widths(
        txn,
        maps.col_widths_map,
        col_id_hexes,
        &sheet.dimensions.col_widths,
        default_col_width_cw,
    );

    if (sheet_default_row_height_pt - 15.0).abs() > 0.01 {
        maps.meta_map.insert(
            txn,
            "defaultRowHeight",
            Any::Number(sheet_default_row_height_pt),
        );
    }
    if sheet.dimensions.default_col_width.is_some() {
        maps.meta_map
            .insert(txn, "defaultColWidth", Any::Number(default_col_width_cw));
    }
    if let Some(bcw) = sheet.dimensions.base_col_width {
        maps.meta_map
            .insert(txn, "baseColWidth", Any::Number(bcw as f64));
    }
    if let Some(descent) = sheet.dimensions.default_row_descent {
        maps.meta_map
            .insert(txn, "defaultRowDescent", Any::Number(descent));
    }
    if sheet.dimensions.custom_height {
        maps.meta_map.insert(txn, "customHeight", Any::Bool(true));
    }
    if sheet.dimensions.zero_height {
        maps.meta_map.insert(txn, "zeroHeight", Any::Bool(true));
    }
    if sheet.dimensions.thick_top {
        maps.meta_map.insert(txn, "thickTop", Any::Bool(true));
    }
    if sheet.dimensions.thick_bottom {
        maps.meta_map.insert(txn, "thickBottom", Any::Bool(true));
    }
    if let Some(olr) = sheet.dimensions.outline_level_row {
        maps.meta_map
            .insert(txn, "outlineLevelRow", Any::Number(olr as f64));
    }
    if let Some(olc) = sheet.dimensions.outline_level_col {
        maps.meta_map
            .insert(txn, "outlineLevelCol", Any::Number(olc as f64));
    }

    let best_fit_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.best_fit)
        .map(|c| c.col)
        .collect();
    if !best_fit_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&best_fit_cols)
    {
        maps.meta_map
            .insert(txn, "colBestFit", Any::String(Arc::from(json)));
    }

    let custom_width_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.custom_width)
        .map(|c| c.col)
        .collect();
    if !custom_width_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_width_cols)
    {
        maps.meta_map
            .insert(txn, "colCustomWidth", Any::String(Arc::from(json)));
    }

    let collapsed_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.collapsed)
        .map(|c| c.col)
        .collect();
    if !collapsed_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&collapsed_cols)
    {
        maps.meta_map
            .insert(txn, "colCollapsed", Any::String(Arc::from(json)));
    }

    let phonetic_cols: Vec<u32> = sheet
        .dimensions
        .col_widths
        .iter()
        .filter(|c| c.phonetic)
        .map(|c| c.col)
        .collect();
    if !phonetic_cols.is_empty()
        && let Ok(json) = serde_json::to_string(&phonetic_cols)
    {
        maps.meta_map
            .insert(txn, "colPhonetic", Any::String(Arc::from(json)));
    }

    if !sheet.dimensions.trailing_col_ranges.is_empty()
        && let Ok(json) = serde_json::to_string(&sheet.dimensions.trailing_col_ranges)
    {
        maps.meta_map
            .insert(txn, "trailingColRanges", Any::String(Arc::from(json)));
    }

    let custom_height_rows: Vec<u32> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| r.custom_height)
        .map(|r| r.row)
        .collect();
    if !custom_height_rows.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_height_rows)
    {
        maps.meta_map
            .insert(txn, "rowCustomHeight", Any::String(Arc::from(json)));
    }

    let custom_format_rows: Vec<u32> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| r.custom_format)
        .map(|r| r.row)
        .collect();
    if !custom_format_rows.is_empty()
        && let Ok(json) = serde_json::to_string(&custom_format_rows)
    {
        maps.meta_map
            .insert(txn, "rowCustomFormat", Any::String(Arc::from(json)));
    }

    let row_descents: Vec<(u32, f64)> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter_map(|r| r.descent.map(|d| (r.row, d)))
        .collect();
    if !row_descents.is_empty()
        && let Ok(json) = serde_json::to_string(&row_descents)
    {
        maps.meta_map
            .insert(txn, "rowDescents", Any::String(Arc::from(json)));
    }

    hydrate_row_metadata(txn, maps.meta_map, sheet);

    hydrate_hidden_rows_cols(
        txn,
        maps.hidden_rows_map,
        maps.manual_hidden_rows_map,
        maps.hidden_cols_map,
        row_id_hexes,
        &sheet.dimensions.row_heights,
        &sheet.dimensions.col_widths,
    );
}

fn hydrate_row_metadata(txn: &mut yrs::TransactionMut, meta_map: &MapRef, sheet: &SheetData) {
    let row_metadata: Vec<&domain_types::RowDimension> = sheet
        .dimensions
        .row_heights
        .iter()
        .filter(|r| {
            r.explicit_hidden
                || r.outline_level.is_some()
                || r.explicit_outline_level_zero
                || r.collapsed.is_some()
                || r.thick_top
                || r.thick_bot
                || r.phonetic
                || !r.xml_hints.is_empty()
        })
        .collect();
    if row_metadata.is_empty() {
        return;
    }

    let row_outline_levels: Vec<(u32, u8)> = row_metadata
        .iter()
        .filter_map(|r| r.outline_level.map(|level| (r.row, level)))
        .collect();
    if !row_outline_levels.is_empty()
        && let Ok(json) = serde_json::to_string(&row_outline_levels)
    {
        meta_map.insert(txn, "rowOutlineLevels", Any::String(Arc::from(json)));
    }
    let row_explicit_hidden: Vec<u32> = row_metadata
        .iter()
        .filter(|r| r.explicit_hidden)
        .map(|r| r.row)
        .collect();
    if !row_explicit_hidden.is_empty()
        && let Ok(json) = serde_json::to_string(&row_explicit_hidden)
    {
        meta_map.insert(txn, "rowExplicitHidden", Any::String(Arc::from(json)));
    }
    let row_explicit_outline_zero: Vec<u32> = row_metadata
        .iter()
        .filter(|r| r.explicit_outline_level_zero)
        .map(|r| r.row)
        .collect();
    if !row_explicit_outline_zero.is_empty()
        && let Ok(json) = serde_json::to_string(&row_explicit_outline_zero)
    {
        meta_map.insert(
            txn,
            "rowExplicitOutlineLevelZero",
            Any::String(Arc::from(json)),
        );
    }
    let row_collapsed: Vec<(u32, bool)> = row_metadata
        .iter()
        .filter_map(|r| r.collapsed.map(|collapsed| (r.row, collapsed)))
        .collect();
    if !row_collapsed.is_empty()
        && let Ok(json) = serde_json::to_string(&row_collapsed)
    {
        meta_map.insert(txn, "rowCollapsed", Any::String(Arc::from(json)));
    }
    let row_thick_top: Vec<u32> = row_metadata
        .iter()
        .filter(|r| r.thick_top)
        .map(|r| r.row)
        .collect();
    if !row_thick_top.is_empty()
        && let Ok(json) = serde_json::to_string(&row_thick_top)
    {
        meta_map.insert(txn, "rowThickTop", Any::String(Arc::from(json)));
    }
    let row_thick_bot: Vec<u32> = row_metadata
        .iter()
        .filter(|r| r.thick_bot)
        .map(|r| r.row)
        .collect();
    if !row_thick_bot.is_empty()
        && let Ok(json) = serde_json::to_string(&row_thick_bot)
    {
        meta_map.insert(txn, "rowThickBot", Any::String(Arc::from(json)));
    }
    let row_phonetic: Vec<u32> = row_metadata
        .iter()
        .filter(|r| r.phonetic)
        .map(|r| r.row)
        .collect();
    if !row_phonetic.is_empty()
        && let Ok(json) = serde_json::to_string(&row_phonetic)
    {
        meta_map.insert(txn, "rowPhonetic", Any::String(Arc::from(json)));
    }
    let row_spans: Vec<(u32, String)> = row_metadata
        .iter()
        .filter_map(|r| {
            r.xml_hints
                .spans
                .as_ref()
                .map(|spans| (r.row, spans.clone()))
        })
        .collect();
    if !row_spans.is_empty()
        && let Ok(json) = serde_json::to_string(&row_spans)
    {
        meta_map.insert(txn, "rowSpans", Any::String(Arc::from(json)));
    }
    let bare_empty_rows: Vec<u32> = row_metadata
        .iter()
        .filter(|r| r.xml_hints.bare_empty)
        .map(|r| r.row)
        .collect();
    if !bare_empty_rows.is_empty()
        && let Ok(json) = serde_json::to_string(&bare_empty_rows)
    {
        meta_map.insert(txn, "bareEmptyRows", Any::String(Arc::from(json)));
    }
}
