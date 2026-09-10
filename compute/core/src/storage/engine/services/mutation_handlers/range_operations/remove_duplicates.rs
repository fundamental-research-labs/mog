use cell_types::{SheetId, SheetPos};
use value_types::{CellValue, ComputeError};

use crate::cells::CellStore;
use crate::snapshot::RecalcResult;
use crate::storage::cells::data_ops::{RemoveDuplicatesOptions, unique_rows};
use crate::storage::engine::mutation::CellInput;
use crate::storage::engine::stores::EngineStores;

/// Compact unique rows through the normal cell mutation path.
#[allow(clippy::too_many_arguments)]
pub(in crate::storage::engine) fn mutation_remove_duplicates(
    stores: &mut EngineStores,
    cell_store: &mut CellStore,
    sheet_id: &SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    columns: &[u32],
    has_headers: bool,
) -> Result<(RecalcResult, serde_json::Value), ComputeError> {
    let sheet = cell_store
        .get_sheet(sheet_id)
        .ok_or_else(|| ComputeError::SheetNotFound {
            sheet_id: sheet_id.to_uuid_string(),
        })?;
    if !sheet.range_views_is_empty() {
        return Err(ComputeError::RangeGuardViolation {
            sheet_id: sheet_id.to_uuid_string(),
            operation: "remove_duplicates".into(),
        });
    }
    let first_row = u64::from(start_row) + u64::from(has_headers);
    let kept = unique_rows(
        cell_store,
        sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        &RemoveDuplicatesOptions {
            has_headers,
            columns_to_compare: columns.to_vec(),
            case_sensitive: false,
        },
    );
    let total = (u64::from(end_row) + 1).saturating_sub(first_row);
    let removed = total.saturating_sub(kept.len() as u64);
    let data = serde_json::json!({
        "duplicatesFound": removed,
        "duplicatesRemoved": removed,
        "uniqueValuesRemaining": kept.len(),
    });
    if removed == 0 {
        return Ok((RecalcResult::empty(), data));
    }

    let region_mutation = crate::storage::workbook::data_tables::invalidate_regions(
        cell_store, sheet_id, start_row, start_col, end_row, end_col,
    );
    let stale_recalc =
        super::relocate::reconcile_data_table_cells(stores, cell_store, &region_mutation)?;

    // Capture all source inputs before applying any overlapping destination writes.
    let mut edits = Vec::new();
    let mut payloads = Vec::new();
    for (offset, &source_row) in kept.iter().enumerate() {
        let destination_row = (first_row + offset as u64) as u32;
        if source_row == destination_row {
            continue;
        }
        for col in start_col..=end_col {
            let source_pos = SheetPos::new(source_row, col);
            let source_id = cell_store.resolve_cell_id(sheet_id, source_pos);
            let mut metadata = source_id
                .as_ref()
                .and_then(|id| stores.storage.cell_metadata(id))
                .cloned()
                .unwrap_or_default();
            if metadata
                .formula
                .as_ref()
                .is_some_and(|formula| formula.t != ooxml_types::worksheet::CellFormulaType::Normal)
            {
                metadata.formula = None;
            }
            metadata.array_ref = None;
            let properties = source_id.as_ref().and_then(|id| {
                crate::storage::properties::get_properties(
                    &stores.storage,
                    sheet_id,
                    &id.to_uuid_string(),
                )
            });
            payloads.push((destination_row, col, metadata, properties));
            let formula = source_id.as_ref().and_then(|cell_id| {
                crate::storage::engine::formula_read::formula_text_for_cell_id(
                    stores, cell_store, sheet_id, cell_id,
                )
            });
            let input = if let Some(formula) = formula {
                CellInput::Parse {
                    text: if formula.starts_with('=') {
                        formula
                    } else {
                        format!("={formula}")
                    },
                }
            } else {
                match cell_store.get_cell_value_at(sheet_id, source_pos) {
                    None | Some(CellValue::Null) => CellInput::Clear,
                    Some(value) => CellInput::Value {
                        value: value.clone(),
                    },
                }
            };
            edits.push((*sheet_id, destination_row, col, input));
        }
    }
    for row in (first_row + kept.len() as u64)..=u64::from(end_row) {
        for col in start_col..=end_col {
            edits.push((*sheet_id, row as u32, col, CellInput::Clear));
        }
    }
    let mut recalc = super::super::cell_mutations::mutation_set_cells_by_position(
        stores, cell_store, edits, false,
    )?;
    for (row, col, metadata, properties) in payloads {
        let position = SheetPos::new(row, col);
        let existing = cell_store.resolve_cell_id(sheet_id, position);
        let id = if let Some(id) = existing {
            id
        } else {
            // An authored empty formula marker or rich-string record can own a
            // blank cell. Capture its absent identity before materializing it.
            if metadata.is_empty() && properties.is_none() {
                continue;
            }
            super::super::super::cell_editing::ensure_cell_id(
                stores, cell_store, sheet_id, row, col,
            )
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?
        };
        stores.storage.set_cell_metadata(id, metadata);
        crate::storage::properties::clear_properties(
            &mut stores.storage,
            sheet_id,
            &id.to_uuid_string(),
        );
        if let Some(properties) = properties {
            crate::storage::properties::set_properties(
                &mut stores.storage,
                sheet_id,
                &id.to_uuid_string(),
                &properties,
            );
        }
        crate::storage::engine::services::mutation::reconcile_persisted_array_ref(
            cell_store, sheet_id, &id, None,
        );
    }
    for row in (first_row + kept.len() as u64)..=u64::from(end_row) {
        for col in start_col..=end_col {
            if let Some(id) = cell_store.resolve_cell_id(sheet_id, SheetPos::new(row as u32, col)) {
                crate::storage::properties::clear_properties(
                    &mut stores.storage,
                    sheet_id,
                    &id.to_uuid_string(),
                );
            }
        }
    }
    crate::storage::engine::cell_metadata::refresh(
        &stores.storage,
        cell_store,
        stores.layout_metrics,
    );
    super::patches::merge_recalc_results(&mut recalc, stale_recalc);
    Ok((recalc, data))
}
