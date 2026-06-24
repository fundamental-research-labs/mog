use cell_types::SheetId;
use compute_wire::flags as render_flags;
use value_types::CellValue;

use super::cf_format::{apply_cf_to_format, apply_number_format_color};
use super::render_cells::{RenderCellMaterial, apply_pivot_display_format};
use crate::mirror::CellMirror;
use crate::storage::engine::settings::EngineSettings;
use crate::storage::engine::stores::{CFCacheEntry, EngineStores};
use crate::storage::properties;

pub(super) fn build_materialized_cell_material(
    stores: &EngineStores,
    mirror: &CellMirror,
    settings: &EngineSettings,
    cf_cache_entry: Option<&CFCacheEntry>,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &CellValue,
    sparkline_flag: u16,
    hyperlink_flag: u16,
    resolve_table_format: &dyn Fn(&SheetId, u32, u32) -> Option<domain_types::CellFormat>,
) -> RenderCellMaterial {
    let table_fmt = resolve_table_format(sheet_id, row, col);
    let empty_cell_id_hex = String::new();
    let mut effective = properties::get_effective_format(
        &stores.storage,
        sheet_id,
        &empty_cell_id_hex,
        row,
        col,
        table_fmt.as_ref(),
        stores.grid_indexes.get(sheet_id),
        mirror.get_sheet(sheet_id),
    );
    domain_types::theme_color::resolve_theme_refs(&mut effective, &settings.theme_palette);
    apply_pivot_display_format(mirror, sheet_id, row, col, &mut effective);
    apply_cf_to_format(cf_cache_entry, &mut effective, row, col);

    let format_code = effective.number_format.as_deref().unwrap_or("General");
    let format_result = compute_formats::format_value(value, format_code, &settings.locale);
    if let Some(ref color) = format_result.color {
        apply_number_format_color(&mut effective, color, cf_cache_entry, row, col);
    }

    let error = match value {
        CellValue::Error(e, _) => Some(e.as_str().to_string()),
        CellValue::Image(image) => serde_json::to_string(image).ok(),
        _ => None,
    };

    let mut flags: u16 = match value {
        CellValue::Null => render_flags::VALUE_TYPE_NULL,
        CellValue::Number(_) => render_flags::VALUE_TYPE_NUMBER,
        CellValue::Text(_) => render_flags::VALUE_TYPE_TEXT,
        CellValue::Boolean(_) => render_flags::VALUE_TYPE_BOOL,
        CellValue::Error(..) => render_flags::VALUE_TYPE_ERROR,
        CellValue::Array(_) => render_flags::VALUE_TYPE_NUMBER,
        CellValue::Control(_) => render_flags::VALUE_TYPE_BOOL,
        CellValue::Image(_) => render_flags::VALUE_TYPE_IMAGE,
    };
    if matches!(value, CellValue::Image(_)) {
        flags |= render_flags::HAS_CELL_IMAGE;
    }
    flags |= sparkline_flag | hyperlink_flag;

    let number_value = match value {
        CellValue::Number(n) => n.get(),
        CellValue::Boolean(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        _ => f64::NAN,
    };

    RenderCellMaterial {
        format: effective,
        row,
        col,
        flags,
        number_value,
        formatted: Some(format_result.text),
        error,
    }
}
