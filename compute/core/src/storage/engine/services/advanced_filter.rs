use crate::mirror::CellMirror;
use crate::snapshot::{ChangeKind, FilterChange, MutationResult};
use crate::storage::engine::mutation_coordinator::MutationCoordinator;
use crate::storage::engine::stores::EngineStores;
use crate::storage::sheet::{dimensions, filters};
use cell_types::{CellId, SheetId, SheetPos};
use compute_document::hex::{hex_to_id, id_to_hex};
use compute_table::advanced_filter::{
    AdvancedFilterCriteria, AdvancedFilterCriteriaCell, AdvancedFilterOptions, AdvancedFilterTable,
    evaluate_advanced_filter,
};
use value_types::{CellValue, ComputeError};

#[derive(Clone, Debug)]
struct ResolvedUserRange {
    sheet_id: SheetId,
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
    normalized_ref: String,
}

fn normalize_range_text(raw: &str) -> &str {
    raw.trim().strip_prefix('=').unwrap_or(raw.trim())
}

fn normalize_bounds(range: crate::range_manager::A1RangeRef) -> (u32, u32, u32, u32) {
    (
        range.start.row.min(range.end.row),
        range.start.col.min(range.end.col),
        range.start.row.max(range.end.row),
        range.start.col.max(range.end.col),
    )
}

fn range_to_a1(start_row: u32, start_col: u32, end_row: u32, end_col: u32) -> String {
    let start = crate::range_manager::pos_to_a1(start_row, start_col);
    let end = crate::range_manager::pos_to_a1(end_row, end_col);
    if start == end {
        start
    } else {
        format!("{start}:{end}")
    }
}

fn parse_same_sheet_range(
    mirror: &CellMirror,
    active_sheet_id: &SheetId,
    raw: &str,
    label: &str,
) -> Result<ResolvedUserRange, ComputeError> {
    let normalized = normalize_range_text(raw);
    let parsed = crate::range_manager::parse_range(normalized).ok_or_else(|| {
        ComputeError::InvalidInput {
            message: format!("Invalid {label} range: {raw}"),
        }
    })?;
    let resolved_sheet_id = match parsed.sheet_name.as_deref() {
        Some(sheet_name) => {
            mirror
                .sheet_by_name(sheet_name)
                .ok_or_else(|| ComputeError::InvalidInput {
                    message: format!("Invalid {label} range: sheet '{sheet_name}' not found"),
                })?
        }
        None => *active_sheet_id,
    };
    if resolved_sheet_id != *active_sheet_id {
        return Err(ComputeError::InvalidInput {
            message: format!("Unsupported cross-sheet Advanced Filter {label} range: {raw}"),
        });
    }
    let (start_row, start_col, end_row, end_col) = normalize_bounds(parsed);
    Ok(ResolvedUserRange {
        sheet_id: resolved_sheet_id,
        start_row,
        start_col,
        end_row,
        end_col,
        normalized_ref: range_to_a1(start_row, start_col, end_row, end_col),
    })
}

fn ensure_cell_id_hex(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Result<String, ComputeError> {
    let grid =
        stores
            .grid_indexes
            .get_mut(sheet_id)
            .ok_or_else(|| ComputeError::SheetNotFound {
                sheet_id: sheet_id.to_uuid_string(),
            })?;
    let cell_id = grid.ensure_cell_id(row, col);
    mirror.register_identity_only(sheet_id, SheetPos::new(row, col), cell_id);
    Ok(id_to_hex(cell_id.as_u128()).to_string())
}

fn cell_value_at(mirror: &CellMirror, sheet_id: &SheetId, row: u32, col: u32) -> CellValue {
    mirror
        .get_cell_value_at(sheet_id, SheetPos::new(row, col))
        .cloned()
        .unwrap_or(CellValue::Null)
}

fn header_value_at(mirror: &CellMirror, sheet_id: &SheetId, row: u32, col: u32) -> String {
    match cell_value_at(mirror, sheet_id, row, col) {
        CellValue::Text(text) => text.to_string(),
        CellValue::Null => String::new(),
        other => format!("{other}"),
    }
}

fn build_advanced_table(mirror: &CellMirror, list: &ResolvedUserRange) -> AdvancedFilterTable {
    let headers = (list.start_col..=list.end_col)
        .map(|col| header_value_at(mirror, &list.sheet_id, list.start_row, col))
        .collect();
    let rows = if list.start_row >= list.end_row {
        Vec::new()
    } else {
        ((list.start_row + 1)..=list.end_row)
            .map(|row| {
                (list.start_col..=list.end_col)
                    .map(|col| cell_value_at(mirror, &list.sheet_id, row, col))
                    .collect()
            })
            .collect()
    };
    AdvancedFilterTable::new(headers, rows)
}

fn is_formula_cell(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    let Some(cell_id) = stores
        .grid_indexes
        .get(sheet_id)
        .and_then(|grid| grid.cell_id_at(row, col))
    else {
        return false;
    };
    stores.compute.get_formula(&cell_id).is_some() || mirror.get_formula(&cell_id).is_some()
}

fn build_advanced_criteria(
    stores: &EngineStores,
    mirror: &CellMirror,
    criteria: &ResolvedUserRange,
) -> AdvancedFilterCriteria {
    let headers = (criteria.start_col..=criteria.end_col)
        .map(|col| header_value_at(mirror, &criteria.sheet_id, criteria.start_row, col))
        .collect();
    let rows = if criteria.start_row >= criteria.end_row {
        Vec::new()
    } else {
        ((criteria.start_row + 1)..=criteria.end_row)
            .map(|row| {
                (criteria.start_col..=criteria.end_col)
                    .map(|col| AdvancedFilterCriteriaCell {
                        value: cell_value_at(mirror, &criteria.sheet_id, row, col),
                        is_formula: is_formula_cell(stores, mirror, &criteria.sheet_id, row, col),
                    })
                    .collect()
            })
            .collect()
    };
    AdvancedFilterCriteria::new(headers, rows)
}

fn ranges_intersect(a: &ResolvedUserRange, b: (u32, u32, u32, u32)) -> bool {
    !(a.end_row < b.0 || a.start_row > b.2 || a.end_col < b.1 || a.start_col > b.3)
}

fn resolve_filter_bounds(
    mirror: &CellMirror,
    filter: &filters::FilterState,
) -> Option<(u32, u32, u32, u32)> {
    let start_id = CellId::from_raw(hex_to_id(&filter.header_start_cell_id)?);
    let end_id = CellId::from_raw(hex_to_id(&filter.data_end_cell_id)?);
    let start = mirror.resolve_position(&start_id)?;
    let end = mirror.resolve_position(&end_id)?;
    Some((
        start.row().min(end.row()),
        start.col().min(end.col()),
        start.row().max(end.row()),
        start.col().max(end.col()),
    ))
}

fn resolve_advanced_filter_target(
    stores: &EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    request_filter_id: Option<&str>,
    list: &ResolvedUserRange,
) -> Result<Option<filters::FilterState>, ComputeError> {
    let filters_in_sheet =
        filters::get_filters_in_sheet(stores.storage.doc(), stores.storage.sheets(), sheet_id);
    if let Some(filter_id) = request_filter_id {
        let filter = filters_in_sheet
            .into_iter()
            .find(|filter| filter.id == filter_id)
            .ok_or_else(|| ComputeError::InvalidInput {
                message: format!("Advanced Filter '{filter_id}' was not found"),
            })?;
        if filter.filter_kind != filters::FilterKind::AdvancedFilter {
            return Err(ComputeError::InvalidInput {
                message: format!("Invalid filter kind for Advanced Filter id '{filter_id}'"),
            });
        }
        return Ok(Some(filter));
    }

    let requested_bounds = (list.start_row, list.start_col, list.end_row, list.end_col);
    let mut matching = None;
    for filter in filters_in_sheet
        .into_iter()
        .filter(|filter| filter.filter_kind == filters::FilterKind::AdvancedFilter)
    {
        let Some(bounds) = resolve_filter_bounds(mirror, &filter) else {
            continue;
        };
        if bounds == requested_bounds {
            matching = Some(filter);
        } else if ranges_intersect(list, bounds) {
            return Err(ComputeError::InvalidInput {
                message: format!(
                    "FILTER_RANGE_OVERLAP_UNSUPPORTED: Advanced Filter '{}' overlaps {}",
                    filter.id,
                    range_to_a1(bounds.0, bounds.1, bounds.2, bounds.3)
                ),
            });
        }
    }
    Ok(matching)
}

fn copy_projection_columns(
    mirror: &CellMirror,
    list: &ResolvedUserRange,
    destination: &ResolvedUserRange,
) -> Result<Vec<u32>, ComputeError> {
    if destination.start_row == destination.end_row && destination.start_col == destination.end_col
    {
        return Ok((list.start_col..=list.end_col).collect());
    }
    if destination.start_row != destination.end_row {
        return Err(ComputeError::InvalidInput {
            message: "Unsupported Advanced Filter copy-to range shape".to_string(),
        });
    }
    let mut cols = Vec::new();
    for dest_col in destination.start_col..=destination.end_col {
        let requested_header = header_value_at(
            mirror,
            &destination.sheet_id,
            destination.start_row,
            dest_col,
        );
        let Some(source_col) = (list.start_col..=list.end_col).find(|source_col| {
            header_value_at(mirror, &list.sheet_id, list.start_row, *source_col)
                .eq_ignore_ascii_case(&requested_header)
        }) else {
            return Err(ComputeError::InvalidInput {
                message: format!(
                    "Advanced Filter copy-to header '{}' was not found in list range",
                    requested_header
                ),
            });
        };
        cols.push(source_col);
    }
    Ok(cols)
}

pub(in crate::storage::engine) fn apply_advanced_filter(
    stores: &mut EngineStores,
    mirror: &mut CellMirror,
    mutation_coord: &mut MutationCoordinator,
    sheet_id: &SheetId,
    request: filters::AdvancedFilterRequest,
) -> Result<MutationResult, ComputeError> {
    let list = parse_same_sheet_range(mirror, sheet_id, &request.list_range, "list")?;
    if list.start_row >= list.end_row {
        return Err(ComputeError::InvalidInput {
            message:
                "Advanced Filter list range must include a header row and at least one data row"
                    .to_string(),
        });
    }
    let criteria = match request.criteria_range.as_deref().map(str::trim) {
        Some("") | None => None,
        Some(raw) => Some(parse_same_sheet_range(mirror, sheet_id, raw, "criteria")?),
    };
    let criteria_model = criteria
        .as_ref()
        .map(|criteria| build_advanced_criteria(stores, mirror, criteria));
    let table = build_advanced_table(mirror, &list);
    let evaluation = evaluate_advanced_filter(
        &table,
        criteria_model.as_ref(),
        &AdvancedFilterOptions {
            unique_records_only: request.unique_records_only,
        },
    )
    .map_err(|err| ComputeError::InvalidInput {
        message: err.to_string(),
    })?;
    let rows_matched = evaluation.iter().filter(|row| row.included).count();

    match request.mode {
        filters::AdvancedFilterMode::InPlace => {
            if request.copy_to_range.is_some() {
                return Err(ComputeError::InvalidInput {
                    message: "copyToRange is invalid for in-place Advanced Filter".to_string(),
                });
            }
            let existing = resolve_advanced_filter_target(
                stores,
                mirror,
                sheet_id,
                request.filter_id.as_deref(),
                &list,
            )?;
            let filter_id = existing
                .as_ref()
                .map(|filter| filter.id.clone())
                .unwrap_or_else(|| format!("{:032x}", stores.id_alloc.next_u128()));
            let header_start_cell_id =
                ensure_cell_id_hex(stores, mirror, sheet_id, list.start_row, list.start_col)?;
            let header_end_cell_id =
                ensure_cell_id_hex(stores, mirror, sheet_id, list.start_row, list.end_col)?;
            let data_end_cell_id =
                ensure_cell_id_hex(stores, mirror, sheet_id, list.end_row, list.end_col)?;
            let advanced_filter = filters::AdvancedFilterState {
                criteria_range: match &criteria {
                    Some(criteria) => Some(filters::AdvancedFilterCriteriaRange {
                        sheet_id: criteria.sheet_id.to_uuid_string(),
                        start_cell_id: ensure_cell_id_hex(
                            stores,
                            mirror,
                            &criteria.sheet_id,
                            criteria.start_row,
                            criteria.start_col,
                        )?,
                        end_cell_id: ensure_cell_id_hex(
                            stores,
                            mirror,
                            &criteria.sheet_id,
                            criteria.end_row,
                            criteria.end_col,
                        )?,
                    }),
                    None => None,
                },
                unique_records_only: request.unique_records_only,
            };
            let now = crate::storage::infra::yrs_helpers::now_millis();
            let state = filters::FilterState {
                id: filter_id.clone(),
                filter_kind: filters::FilterKind::AdvancedFilter,
                header_start_cell_id,
                header_end_cell_id,
                data_end_cell_id,
                column_filters: std::collections::HashMap::new(),
                advanced_filter: Some(advanced_filter),
                sort_state: None,
                table_id: None,
                created_at: existing
                    .as_ref()
                    .and_then(|filter| filter.created_at)
                    .or(Some(now)),
                updated_at: Some(now),
                start_row: None,
                start_col: None,
                end_row: None,
                end_col: None,
            };

            let prior_transitions = dimensions::clear_filter_hidden_rows(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                &filter_id,
                stores.grid_indexes.get(sheet_id),
            );
            filters::upsert_filter_state(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                &state,
            )?;

            let mut rows_to_hide = Vec::new();
            let mut rows_to_release = Vec::new();
            for row in &evaluation {
                let source_row = list.start_row + 1 + row.source_row_index as u32;
                if row.included {
                    rows_to_release.push(source_row);
                } else {
                    rows_to_hide.push(source_row);
                }
            }
            let transitions = dimensions::set_filter_hidden_rows(
                stores.storage.doc(),
                stores.storage.sheets(),
                sheet_id,
                &filter_id,
                &rows_to_hide,
                &rows_to_release,
                stores.grid_indexes.get(sheet_id),
            );
            if let Some(layout) = stores.layout_indexes.get_mut(sheet_id) {
                for &(row, hidden) in prior_transitions.iter().chain(transitions.iter()) {
                    if hidden {
                        layout.hide_row(row as usize);
                    } else {
                        layout.unhide_row(row as usize);
                    }
                    mirror.set_row_hidden(sheet_id, row, hidden);
                }
            } else {
                for &(row, hidden) in prior_transitions.iter().chain(transitions.iter()) {
                    mirror.set_row_hidden(sheet_id, row, hidden);
                }
            }

            let receipt = filters::AdvancedFilterResult {
                mode: filters::AdvancedFilterMode::InPlace,
                list_range: list.normalized_ref,
                criteria_range: criteria.as_ref().map(|range| range.normalized_ref.clone()),
                filter_id: Some(filter_id.clone()),
                rows_matched,
                rows_hidden: Some(rows_to_hide.len()),
                rows_copied: None,
                columns_copied: None,
                destination_range: None,
            };
            let mut result = MutationResult::empty().with_data(&receipt)?;
            result.filter_changes.push(FilterChange {
                sheet_id: sheet_id.to_uuid_string(),
                filter_id,
                filter_kind: Some("advancedFilter".to_string()),
                table_id: None,
                capability: None,
                unsupported_reasons: Vec::new(),
                has_active_filter: Some(true),
                clearable: Some(false),
                diagnostics: Vec::new(),
                action: Some("applied".to_string()),
                hidden_row_count: Some(rows_to_hide.len() as u32),
                visible_row_count: Some(rows_matched as u32),
                kind: ChangeKind::Set,
            });
            Ok(result)
        }
        filters::AdvancedFilterMode::CopyTo => {
            if request.filter_id.is_some() {
                return Err(ComputeError::InvalidInput {
                    message: "filterId is invalid for copy-to Advanced Filter".to_string(),
                });
            }
            let copy_to_raw =
                request
                    .copy_to_range
                    .as_deref()
                    .ok_or_else(|| ComputeError::InvalidInput {
                        message: "copyToRange is required for copy-to Advanced Filter".to_string(),
                    })?;
            let destination = parse_same_sheet_range(mirror, sheet_id, copy_to_raw, "copy-to")?;
            let projection = copy_projection_columns(mirror, &list, &destination)?;
            let mut edits = Vec::new();
            for (offset, source_col) in projection.iter().enumerate() {
                edits.push((
                    *sheet_id,
                    destination.start_row,
                    destination.start_col + offset as u32,
                    cell_value_at(mirror, sheet_id, list.start_row, *source_col),
                    None,
                ));
            }
            let mut dest_row = destination.start_row + 1;
            for row in evaluation.iter().filter(|row| row.included) {
                let source_row = list.start_row + 1 + row.source_row_index as u32;
                for (offset, source_col) in projection.iter().enumerate() {
                    edits.push((
                        *sheet_id,
                        dest_row,
                        destination.start_col + offset as u32,
                        cell_value_at(mirror, sheet_id, source_row, *source_col),
                        None,
                    ));
                }
                dest_row += 1;
            }
            let recalc = super::mutation_handlers::mutation_set_cells_by_position_raw(
                stores,
                mirror,
                mutation_coord,
                edits,
                true,
            )?;
            let copied_rows = rows_matched + 1;
            let destination_range = range_to_a1(
                destination.start_row,
                destination.start_col,
                destination.start_row + copied_rows.saturating_sub(1) as u32,
                destination.start_col + projection.len().saturating_sub(1) as u32,
            );
            let receipt = filters::AdvancedFilterResult {
                mode: filters::AdvancedFilterMode::CopyTo,
                list_range: list.normalized_ref,
                criteria_range: criteria.as_ref().map(|range| range.normalized_ref.clone()),
                filter_id: None,
                rows_matched,
                rows_hidden: None,
                rows_copied: Some(rows_matched),
                columns_copied: Some(projection.len()),
                destination_range: Some(destination_range),
            };
            MutationResult::from_recalc(recalc)
                .with_data(&receipt)
                .map_err(|err| ComputeError::InvalidInput {
                    message: err.to_string(),
                })
        }
    }
}
