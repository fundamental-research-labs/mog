use crate::mirror::CellMirror;
use crate::snapshot::{CellPosition, ChangeKind, MutationResult, PropertyChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use cell_types::SheetId;
use compute_document::hex::{SmallHex, id_to_hex};
use compute_document::undo::ORIGIN_USER_EDIT;
use domain_types::CellFormat;
use value_types::ComputeError;

use super::super::resolve_structured_format_at_cell;

type FormatResult = Result<(Vec<(u128, u32, u32)>, MutationResult), ComputeError>;

const LARGE_RANGE_THRESHOLD: u64 = 100_000;

pub(in crate::storage::engine) fn toggle_format_property(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    property: &str,
    active_row: u32,
    active_col: u32,
) -> FormatResult {
    let grid = stores
        .grid_indexes
        .get_mut(sheet_id)
        .ok_or_else(|| ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        })?;

    let active_cell_id = grid.ensure_cell_id(active_row, active_col);
    let active_cell_hex = id_to_hex(active_cell_id.as_u128());
    let table_fmt = resolve_structured_format_at_cell(mirror, sheet_id, active_row, active_col);
    let effective = properties::get_effective_format(
        &stores.storage,
        sheet_id,
        &active_cell_hex,
        active_row,
        active_col,
        table_fmt.as_ref(),
        stores.grid_indexes.get(sheet_id),
        mirror.get_sheet(sheet_id),
    );

    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let mut result = MutationResult::empty();

    let patch: CellFormat = match property {
        "bold" => {
            let new_val = !effective.bold.unwrap_or(false);
            CellFormat {
                bold: Some(new_val),
                ..Default::default()
            }
        }
        "italic" => {
            let new_val = !effective.italic.unwrap_or(false);
            CellFormat {
                italic: Some(new_val),
                ..Default::default()
            }
        }
        "strikethrough" => {
            let new_val = !effective.strikethrough.unwrap_or(false);
            CellFormat {
                strikethrough: Some(new_val),
                ..Default::default()
            }
        }
        "wrapText" => {
            let new_val = !effective.wrap_text.unwrap_or(false);
            CellFormat {
                wrap_text: Some(new_val),
                ..Default::default()
            }
        }
        "underline" => {
            use ooxml_types::styles::UnderlineStyle;
            let is_none = matches!(effective.underline_type, None | Some(UnderlineStyle::None));
            let new_val = if is_none {
                UnderlineStyle::Single
            } else {
                UnderlineStyle::None
            };
            CellFormat {
                underline_type: Some(new_val),
                ..Default::default()
            }
        }
        _ => {
            return Err(ComputeError::Eval {
                message: format!(
                    "Unknown toggle property: '{}'. Expected one of: bold, italic, strikethrough, wrapText, underline",
                    property
                ),
            });
        }
    };
    let patch = properties::normalize_format_patch(&patch);

    let format_json = serde_json::to_value(&patch).ok();
    let mut affected_cells: Vec<(u128, u32, u32)> = Vec::new();

    for &(start_row, start_col, end_row, end_col) in ranges {
        let range_size = (end_row - start_row + 1) as u64 * (end_col - start_col + 1) as u64;

        if range_size >= LARGE_RANGE_THRESHOLD {
            eprintln!(
                "[formatting] toggle_format_property: large range ({} cells), using bulk mode",
                range_size
            );

            let Some(grid) = stores.grid_indexes.get(sheet_id) else {
                continue;
            };
            let existing: Vec<_> = grid
                .cells_in_range(start_row, start_col, end_row, end_col)
                .collect();

            let cell_hexes: Vec<SmallHex> = existing
                .iter()
                .map(|(cell_id, _, _)| id_to_hex(cell_id.as_u128()))
                .collect();
            let cell_hex_refs: Vec<&str> = cell_hexes.iter().map(|s| s.as_str()).collect();
            properties::set_cell_formats(
                stores.storage.doc(),
                stores.storage.workbook_map(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex_refs,
                &patch,
            );

            for (cell_id, row, col) in existing {
                affected_cells.push((cell_id.as_u128(), row, col));
            }

            result.property_changes.push(PropertyChange {
                sheet_id: sheet_id_str.clone(),
                cell_id: String::new(),
                position: Some(CellPosition {
                    row: start_row,
                    col: start_col,
                }),
                kind: ChangeKind::Set,
                format: format_json.clone(),
            });
        } else {
            let mut cell_data: Vec<(SmallHex, u128, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) = super::super::cell_editing::ensure_cell_id_mirrored(
                        stores, mirror, sheet_id, row, col,
                    ) else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, cell_id.as_u128(), row, col));
                }
            }

            let cell_hex_refs: Vec<&str> = cell_data
                .iter()
                .map(|(hex, _, _, _)| hex.as_str())
                .collect();
            properties::set_cell_formats(
                stores.storage.doc(),
                stores.storage.workbook_map(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex_refs,
                &patch,
            );

            for (cell_hex, cell_id_u128, row, col) in &cell_data {
                affected_cells.push((*cell_id_u128, *row, *col));
                result.property_changes.push(PropertyChange {
                    sheet_id: sheet_id_str.clone(),
                    cell_id: (*cell_hex).into(),
                    position: Some(CellPosition {
                        row: *row,
                        col: *col,
                    }),
                    kind: ChangeKind::Set,
                    format: format_json.clone(),
                });
            }
        }
    }

    Ok((affected_cells, result))
}

pub(in crate::storage::engine) fn set_format_for_ranges(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
) -> FormatResult {
    set_format_for_ranges_with_origin(stores, mirror, sheet_id, ranges, format, ORIGIN_USER_EDIT)
}

pub(in crate::storage::engine) fn set_format_for_ranges_with_origin(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
    origin: &'static [u8],
) -> FormatResult {
    if !stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    }

    let format = properties::normalize_format_patch(format);
    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let format_json = serde_json::to_value(&format).ok();
    let mut result = MutationResult::empty();
    let mut affected_cells: Vec<(u128, u32, u32)> = Vec::new();

    for &(start_row, start_col, end_row, end_col) in ranges {
        let range_size = (end_row - start_row + 1) as u64 * (end_col - start_col + 1) as u64;

        if range_size >= LARGE_RANGE_THRESHOLD {
            eprintln!(
                "[formatting] set_format_for_ranges: large range ({} cells), using bulk mode",
                range_size
            );

            let Some(grid) = stores.grid_indexes.get(sheet_id) else {
                continue;
            };
            let existing: Vec<_> = grid
                .cells_in_range(start_row, start_col, end_row, end_col)
                .collect();

            let cell_hexes: Vec<SmallHex> = existing
                .iter()
                .map(|(cell_id, _, _)| id_to_hex(cell_id.as_u128()))
                .collect();
            let cell_hex_refs: Vec<&str> = cell_hexes.iter().map(|s| s.as_str()).collect();
            properties::set_cell_formats_with_origin(
                stores.storage.doc(),
                stores.storage.workbook_map(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex_refs,
                &format,
                origin,
            );

            for (cell_id, row, col) in existing {
                affected_cells.push((cell_id.as_u128(), row, col));
            }

            result.property_changes.push(PropertyChange {
                sheet_id: sheet_id_str.clone(),
                cell_id: String::new(),
                position: Some(CellPosition {
                    row: start_row,
                    col: start_col,
                }),
                kind: ChangeKind::Set,
                format: format_json.clone(),
            });
        } else {
            let mut cell_data: Vec<(SmallHex, u128, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) =
                        super::super::cell_editing::ensure_cell_id_mirrored_with_origin(
                            stores, mirror, sheet_id, row, col, origin,
                        )
                    else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, cell_id.as_u128(), row, col));
                }
            }

            let cell_hex_refs: Vec<&str> = cell_data
                .iter()
                .map(|(hex, _, _, _)| hex.as_str())
                .collect();
            properties::set_cell_formats_with_origin(
                stores.storage.doc(),
                stores.storage.workbook_map(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex_refs,
                &format,
                origin,
            );

            for (cell_hex, cell_id_u128, row, col) in &cell_data {
                affected_cells.push((*cell_id_u128, *row, *col));
                result.property_changes.push(PropertyChange {
                    sheet_id: sheet_id_str.clone(),
                    cell_id: (*cell_hex).into(),
                    position: Some(CellPosition {
                        row: *row,
                        col: *col,
                    }),
                    kind: ChangeKind::Set,
                    format: format_json.clone(),
                });
            }
        }
    }

    Ok((affected_cells, result))
}

pub(in crate::storage::engine) fn clear_format_for_ranges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
) -> FormatResult {
    if !stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    }

    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let mut result = MutationResult::empty();
    let mut affected_cells: Vec<(u128, u32, u32)> = Vec::new();

    for &(start_row, start_col, end_row, end_col) in ranges {
        let range_size = (end_row - start_row + 1) as u64 * (end_col - start_col + 1) as u64;

        if range_size >= LARGE_RANGE_THRESHOLD {
            eprintln!(
                "[formatting] clear_format_for_ranges: large range ({} cells), using bulk mode",
                range_size
            );

            let Some(grid) = stores.grid_indexes.get(sheet_id) else {
                continue;
            };
            let existing: Vec<_> = grid
                .cells_in_range(start_row, start_col, end_row, end_col)
                .collect();

            let cell_hexes: Vec<SmallHex> = existing
                .iter()
                .map(|(cell_id, _, _)| id_to_hex(cell_id.as_u128()))
                .collect();
            let cell_hex_refs: Vec<&str> = cell_hexes.iter().map(|s| s.as_str()).collect();
            properties::clear_cell_formats(
                stores.storage.doc(),
                stores.storage.workbook_map(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex_refs,
            );

            for (cell_id, row, col) in existing {
                affected_cells.push((cell_id.as_u128(), row, col));
            }

            result.property_changes.push(PropertyChange {
                sheet_id: sheet_id_str.clone(),
                cell_id: String::new(),
                position: Some(CellPosition {
                    row: start_row,
                    col: start_col,
                }),
                kind: ChangeKind::Removed,
                format: None,
            });
        } else {
            let mut cell_data: Vec<(SmallHex, u128, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) =
                        super::super::cell_editing::find_cell_id_at(stores, sheet_id, row, col)
                    else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, cell_id.as_u128(), row, col));
                }
            }

            let cell_hex_refs: Vec<&str> = cell_data
                .iter()
                .map(|(hex, _, _, _)| hex.as_str())
                .collect();
            properties::clear_cell_formats(
                stores.storage.doc(),
                stores.storage.workbook_map(),
                stores.storage.sheets(),
                sheet_id,
                &cell_hex_refs,
            );

            for (cell_hex, cell_id_u128, row, col) in &cell_data {
                affected_cells.push((*cell_id_u128, *row, *col));
                result.property_changes.push(PropertyChange {
                    sheet_id: sheet_id_str.clone(),
                    cell_id: (*cell_hex).into(),
                    position: Some(CellPosition {
                        row: *row,
                        col: *col,
                    }),
                    kind: ChangeKind::Removed,
                    format: None,
                });
            }
        }
    }

    Ok((affected_cells, result))
}
