use crate::border_patch::BorderPatchField;
use crate::cells::CellStore;
use crate::snapshot::{CellPosition, ChangeKind, MutationResult, PropertyChange};
use crate::storage::engine::stores::EngineStores;
use crate::storage::properties;
use cell_types::SheetId;
use compute_document::hex::{SmallHex, id_to_hex};
use domain_types::{CellBorders, CellFormat};
use value_types::ComputeError;

use super::super::resolve_structured_format_at_cell;

const LARGE_RANGE_THRESHOLD: u64 = 100_000;

enum RangeFormatPatch<'a> {
    Format {
        format: &'a CellFormat,
        clear_fields: &'a [String],
    },
    Borders {
        borders: &'a CellBorders,
        clear_fields: &'a [BorderPatchField],
    },
}

impl RangeFormatPatch<'_> {
    fn apply(
        &self,
        stores: &mut EngineStores,
        sheet_id: &SheetId,
        cell_ids: &[&str],
    ) -> Result<(), ComputeError> {
        match self {
            Self::Format {
                format,
                clear_fields,
            } => properties::patch_cell_formats(
                &mut stores.storage,
                sheet_id,
                cell_ids,
                format,
                clear_fields,
            ),
            Self::Borders {
                borders,
                clear_fields,
            } => properties::patch_cell_borders(
                &mut stores.storage,
                sheet_id,
                cell_ids,
                borders,
                clear_fields,
            ),
        }
    }

    fn clear_overlay_fields(&self, format: &CellFormat) -> Result<CellFormat, ComputeError> {
        match self {
            Self::Format { clear_fields, .. } => {
                properties::apply_format_patch(format, &CellFormat::default(), clear_fields)
            }
            Self::Borders { clear_fields, .. } => {
                let mut format = format.clone();
                format.borders = properties::apply_borders_patch(
                    format.borders.as_ref(),
                    &CellBorders::default(),
                    clear_fields,
                );
                Ok(format)
            }
        }
    }
    fn direct_overlay(&self) -> CellFormat {
        match self {
            Self::Format { format, .. } => (*format).clone(),
            Self::Borders { borders, .. } => CellFormat {
                borders: (**borders != CellBorders::default()).then(|| (*borders).clone()),
                ..Default::default()
            },
        }
    }

    fn mutation_json(&self) -> Option<serde_json::Value> {
        match self {
            Self::Format {
                format,
                clear_fields,
            } => serde_json::to_value(format).ok().map(|mut value| {
                if let Some(object) = value.as_object_mut() {
                    for field in *clear_fields {
                        object.insert(field.clone(), serde_json::Value::Null);
                    }
                }
                value
            }),
            Self::Borders {
                borders,
                clear_fields,
            } => serde_json::to_value(borders).ok().map(|mut borders_value| {
                if let Some(object) = borders_value.as_object_mut() {
                    for field in *clear_fields {
                        object.insert(field.as_str().to_owned(), serde_json::Value::Null);
                    }
                }
                serde_json::json!({ "borders": borders_value })
            }),
        }
    }

    fn operation_name(&self) -> &'static str {
        match self {
            Self::Format { .. } => "patch_format_for_ranges",
            Self::Borders { .. } => "patch_borders_for_ranges",
        }
    }
}

pub(in crate::storage::engine) fn toggle_format_property(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    property: &str,
    active_row: u32,
    active_col: u32,
) -> Result<MutationResult, ComputeError> {
    let grid = stores
        .grid_indexes
        .get(sheet_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    let active_id =
        cell_store.resolve_cell_id(sheet_id, cell_types::SheetPos::new(active_row, active_col));
    let active_props = active_id.and_then(|id| {
        properties::get_properties(&stores.storage, sheet_id, &id_to_hex(id.as_u128()))
    });
    let table_fmt = resolve_structured_format_at_cell(cell_store, sheet_id, active_row, active_col);
    let effective = properties::get_effective_format_preloaded(
        &stores.storage,
        sheet_id,
        active_row,
        active_col,
        table_fmt.as_ref(),
        active_props.as_ref(),
        Some(grid),
        cell_store.get_sheet(sheet_id),
    );

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
    patch_format_for_ranges(stores, cell_store, sheet_id, ranges, &patch, &[])
}

pub(in crate::storage::engine) fn set_format_for_ranges(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    patch_format_for_ranges(stores, cell_store, sheet_id, ranges, format, &[])
}

pub(in crate::storage::engine) fn patch_format_for_ranges(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
    clear_fields: &[String],
) -> Result<MutationResult, ComputeError> {
    let format = properties::normalize_format_patch(format);
    patch_ranges(
        stores,
        cell_store,
        sheet_id,
        ranges,
        RangeFormatPatch::Format {
            format: &format,
            clear_fields,
        },
    )
}

pub(in crate::storage::engine) fn patch_borders_for_ranges(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    borders: &CellBorders,
    clear_fields: &[BorderPatchField],
) -> Result<MutationResult, ComputeError> {
    patch_ranges(
        stores,
        cell_store,
        sheet_id,
        ranges,
        RangeFormatPatch::Borders {
            borders,
            clear_fields,
        },
    )
}

fn patch_ranges(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    patch: RangeFormatPatch<'_>,
) -> Result<MutationResult, ComputeError> {
    if !stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    }

    for &(sr, sc, er, ec) in ranges {
        crate::storage::engine::validation::range::validate_range_bounds(sr, sc, er, ec)?;
        if er >= cell_types::MAX_ROWS || ec >= cell_types::MAX_COLS {
            return Err(ComputeError::InvalidInput {
                message: "Format range exceeds sheet bounds".into(),
            });
        }
    }

    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let format_json = patch.mutation_json();
    let mut result = MutationResult::empty();

    for &(start_row, start_col, end_row, end_col) in ranges {
        let range_size = (end_row - start_row + 1) as u64 * (end_col - start_col + 1) as u64;

        if let Some(sheet) = cell_store.get_sheet_mut(sheet_id) {
            let direct = (range_size >= LARGE_RANGE_THRESHOLD).then(|| patch.direct_overlay());
            properties::patch_native_format_ranges(
                sheet,
                cell_types::SheetRange::new(start_row, start_col, end_row, end_col),
                |format| patch.clear_overlay_fields(format),
                direct.as_ref(),
                &stores.id_alloc,
            )?;
        }

        if range_size >= LARGE_RANGE_THRESHOLD {
            eprintln!(
                "[formatting] {}: large range ({} cells), using bulk mode",
                patch.operation_name(),
                range_size
            );

            let existing = formatted_cells_in_range(
                stores,
                cell_store,
                sheet_id,
                cell_types::SheetRange::new(start_row, start_col, end_row, end_col),
            );

            let cell_hexes: Vec<SmallHex> = existing
                .iter()
                .map(|(cell_id, _, _)| id_to_hex(cell_id.as_u128()))
                .collect();
            let cell_hex_refs: Vec<&str> = cell_hexes.iter().map(|s| s.as_str()).collect();
            patch.apply(stores, sheet_id, &cell_hex_refs)?;

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
            let mut cell_data: Vec<(SmallHex, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) = super::super::cell_editing::ensure_cell_id(
                        stores, cell_store, sheet_id, row, col,
                    ) else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, row, col));
                }
            }

            let cell_hex_refs: Vec<&str> =
                cell_data.iter().map(|(hex, _, _)| hex.as_str()).collect();
            patch.apply(stores, sheet_id, &cell_hex_refs)?;

            for (cell_hex, row, col) in &cell_data {
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

    Ok(result)
}

pub(in crate::storage::engine) fn clear_format_for_ranges(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
) -> Result<MutationResult, ComputeError> {
    if !stores.grid_indexes.contains_key(sheet_id) {
        return Err(ComputeError::Eval {
            message: format!("Sheet not found: {:?}", sheet_id),
        });
    }

    for &(sr, sc, er, ec) in ranges {
        crate::storage::engine::validation::range::validate_range_bounds(sr, sc, er, ec)?;
        if er >= cell_types::MAX_ROWS || ec >= cell_types::MAX_COLS {
            return Err(ComputeError::InvalidInput {
                message: "Format range exceeds sheet bounds".into(),
            });
        }
    }

    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let mut result = MutationResult::empty();

    for &(start_row, start_col, end_row, end_col) in ranges {
        let range_size = (end_row - start_row + 1) as u64 * (end_col - start_col + 1) as u64;

        if let Some(sheet) = cell_store.get_sheet_mut(sheet_id) {
            properties::patch_native_format_ranges(
                sheet,
                cell_types::SheetRange::new(start_row, start_col, end_row, end_col),
                |_| Ok(CellFormat::default()),
                None,
                &stores.id_alloc,
            )?;
        }
        if range_size >= LARGE_RANGE_THRESHOLD {
            eprintln!(
                "[formatting] clear_format_for_ranges: large range ({} cells), using bulk mode",
                range_size
            );

            let existing = formatted_cells_in_range(
                stores,
                cell_store,
                sheet_id,
                cell_types::SheetRange::new(start_row, start_col, end_row, end_col),
            );

            let cell_hexes: Vec<SmallHex> = existing
                .iter()
                .map(|(cell_id, _, _)| id_to_hex(cell_id.as_u128()))
                .collect();
            let cell_hex_refs: Vec<&str> = cell_hexes.iter().map(|s| s.as_str()).collect();
            properties::clear_cell_formats(&mut stores.storage, sheet_id, &cell_hex_refs);

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
            let mut cell_data: Vec<(SmallHex, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) =
                        super::super::cell_editing::find_cell_id_at(cell_store, sheet_id, row, col)
                    else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, row, col));
                }
            }

            let cell_hex_refs: Vec<&str> =
                cell_data.iter().map(|(hex, _, _)| hex.as_str()).collect();
            properties::clear_cell_formats(&mut stores.storage, sheet_id, &cell_hex_refs);

            for (cell_hex, row, col) in &cell_data {
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

    Ok(result)
}

/// Direct overlays already style value-only cells; visit only stronger authored
/// cell formats that must receive the same patch. This remains sparse even when
/// the values themselves use eager native identities.
fn formatted_cells_in_range(
    stores: &EngineStores,
    cell_store: &CellStore,
    sheet_id: &SheetId,
    bounds: cell_types::SheetRange,
) -> Vec<(cell_types::CellId, u32, u32)> {
    let sheet = cell_store.get_sheet(sheet_id);
    stores
        .storage
        .sheet_metadata
        .get(sheet_id)
        .into_iter()
        .flat_map(|metadata| metadata.cell_properties.iter())
        .filter(|(_, properties)| properties.has_format())
        .filter_map(|(id, _)| {
            let (row, col) = sheet.and_then(|sheet| sheet.cell_position(id))?;
            bounds.contains(row, col).then_some((*id, row, col))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_overlay_does_not_create_properties_for_eager_unformatted_values() {
        let mut engine = crate::storage::engine::ComputeEngine::from_snapshot(
            crate::snapshot::WorkbookSnapshot::default(),
        )
        .unwrap()
        .0;
        let (hex, _) = engine.create_sheet("Formats").unwrap();
        let id = SheetId::from_raw(u128::from_str_radix(&hex, 16).unwrap());
        for row in 0..8 {
            engine.set_cell_value_parsed(&id, row, 0, "1").unwrap();
        }
        let before = engine.stores.storage.sheet_metadata[&id]
            .cell_properties
            .len();
        engine
            .set_format_for_ranges(
                &id,
                &[(0, 0, 599, 199)],
                &CellFormat {
                    bold: Some(true),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            engine.stores.storage.sheet_metadata[&id]
                .cell_properties
                .len(),
            before
        );
        assert_eq!(engine.get_resolved_format(&id, 7, 0).bold, Some(true));
        engine
            .patch_format_for_ranges(
                &id,
                &[(0, 0, 599, 199)],
                &CellFormat::default(),
                &["bold".into()],
            )
            .unwrap();
        assert_eq!(engine.get_resolved_format(&id, 7, 0).bold, Some(false));
        assert_eq!(
            engine.stores.storage.sheet_metadata[&id]
                .cell_properties
                .len(),
            before
        );
    }
}
