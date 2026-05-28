//! Extracted formatting service functions.
//!
//! Each function takes explicit references to the engine sub-structs it needs
//! (e.g. `&EngineStores`, `&mut EngineStores`) instead of `&self`.  The original
//! bridge methods in `engine::formatting` delegate to these with one-line calls.

use std::sync::Arc;

use crate::mirror::CellMirror;
use crate::snapshot::{CellPosition, CfChange, ChangeKind, MutationResult, PropertyChange};
use crate::storage::properties;
use crate::storage::sheet::cf_store;
use crate::storage::sheet::cf_store::{CFCellRange, CFIconSetPreset, CFPresetCategory};
use crate::storage::sheet::schemas;
use crate::storage::sheet::schemas::{CellValidationResult, ColumnSchema, RangeSchema};
use cell_types::{IdAllocator, SheetId, SheetPos};
use compute_document::hex::{SmallHex, id_to_hex};
use domain_types::CellFormat;
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};
use value_types::ComputeError;

use crate::storage::engine::stores::EngineStores;

use super::tables::resolve_table_format_at_cell;

/// Result type for formatting operations that return affected cells and mutation info.
type FormatResult = Result<(Vec<(u128, u32, u32)>, MutationResult), ComputeError>;

/// Maximum number of cells per range before switching to bulk mode.
/// In bulk mode we skip per-cell PropertyChange emission and affected_cells
/// collection — instead emitting a single range-level notification.
/// This prevents 1M+ allocations when formatting an entire column.
const LARGE_RANGE_THRESHOLD: u64 = 100_000;

// -------------------------------------------------------------------
// Schema Map Management
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn set_schema_map(
    stores: &mut EngineStores,
    entries: Vec<crate::bridge_types::SchemaMapEntryWire>,
    version: f64,
) {
    let version = version as u64;
    let mut schemas = std::collections::HashMap::new();
    for entry in entries {
        let Ok(sheet_id) = cell_types::SheetId::from_uuid_str(&entry.sheet_id) else {
            continue;
        };
        let key = crate::schema::schema_map::SchemaKey {
            sheet_id,
            column: entry.column,
        };
        schemas.insert(key, entry.schema);
    }
    stores.compute.load_schema_map(schemas, version);
}

pub(in crate::storage::engine) fn update_schema(
    stores: &mut EngineStores,
    sheet_id: &str,
    column: u32,
    schema: crate::schema::types::ColumnSchema,
    version: f64,
) -> bool {
    let version = version as u64;
    let Ok(sid) = cell_types::SheetId::from_uuid_str(sheet_id) else {
        return false;
    };
    let key = crate::schema::schema_map::SchemaKey {
        sheet_id: sid,
        column,
    };
    stores.compute.update_schema(key, schema, version)
}

pub(in crate::storage::engine) fn remove_schema(
    stores: &mut EngineStores,
    sheet_id: &str,
    column: u32,
    version: f64,
) -> bool {
    let version = version as u64;
    let Ok(sid) = cell_types::SheetId::from_uuid_str(sheet_id) else {
        return false;
    };
    let key = crate::schema::schema_map::SchemaKey {
        sheet_id: sid,
        column,
    };
    stores.compute.remove_schema(&key, version)
}

pub(in crate::storage::engine) fn clear_schemas(
    stores: &mut EngineStores,
) -> Result<MutationResult, ComputeError> {
    stores.compute.clear_schemas();
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// Properties operations
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn set_cell_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_hex: &str,
    format: &CellFormat,
) {
    properties::set_cell_format(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        sheet_id,
        cell_hex,
        format,
    );
}

pub(in crate::storage::engine) fn clear_cell_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    cell_hex: &str,
) {
    properties::clear_cell_format(
        stores.storage.doc(),
        stores.storage.workbook_map(),
        stores.storage.sheets(),
        sheet_id,
        cell_hex,
    );
}

// -------------------------------------------------------------------
// Format property toggle + range format set/clear
// -------------------------------------------------------------------

/// Core logic for toggling a boolean format property across ranges.
///
/// Returns `(affected_cells, MutationResult)` — the caller (bridge delegator)
/// is responsible for observer suppression and viewport patch production.
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

    // 1. Read the effective format at the active cell.
    let active_cell_id = grid.ensure_cell_id(active_row, active_col);
    let active_cell_hex = id_to_hex(active_cell_id.as_u128());
    let table_fmt = resolve_table_format_at_cell(mirror, sheet_id, active_row, active_col);
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

    // 2. Determine toggle direction based on current value.
    let sheet_id_str: String = id_to_hex(sheet_id.as_u128()).into();
    let mut result = MutationResult::empty();

    // Build the CellFormat patch and compute format JSON for the property change.
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

    // 3. Apply the patch to every cell in every range.
    let mut affected_cells: Vec<(u128, u32, u32)> = Vec::new();

    for &(start_row, start_col, end_row, end_col) in ranges {
        let range_size = (end_row - start_row + 1) as u64 * (end_col - start_col + 1) as u64;

        if range_size > LARGE_RANGE_THRESHOLD {
            // Large range: iterate only existing (materialized) cells to apply
            // format, but skip per-cell PropertyChange emission to avoid
            // allocating millions of entries. Emit a single range-level change.
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

            // Batch: compute hex keys, then write all in one transaction.
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

            // Emit a single range-level PropertyChange for the entire range.
            result.property_changes.push(PropertyChange {
                sheet_id: sheet_id_str.clone(),
                cell_id: String::new(), // empty = range-level
                position: Some(CellPosition {
                    row: start_row,
                    col: start_col,
                }),
                kind: ChangeKind::Set,
                format: format_json.clone(),
            });
        } else {
            // Collect cell IDs first, then batch write. Each `ensure_cell_id_mirrored`
            // call registers the identity in both the in-memory GridIndex and the
            // yrs `gridIndex/{posToId, idToPos}` sub-maps so remote peers can
            // resolve the cell's position after CRDT sync.
            let mut cell_data: Vec<(SmallHex, u128, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) = super::cell_editing::ensure_cell_id_mirrored(
                        stores, mirror, sheet_id, row, col,
                    ) else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, cell_id.as_u128(), row, col));
                }
            }

            // Batch write all cells in one yrs transaction.
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

/// Core logic for setting a format across ranges.
///
/// Returns `(affected_cells, MutationResult)` — the caller (bridge delegator)
/// is responsible for observer suppression and viewport patch production.
pub(in crate::storage::engine) fn set_format_for_ranges(
    stores: &mut EngineStores,
    mirror: &CellMirror,
    sheet_id: &SheetId,
    ranges: &[(u32, u32, u32, u32)],
    format: &CellFormat,
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

    // Collect (cell_id_u128, row, col) for all affected cells while mutating storage.
    let mut affected_cells: Vec<(u128, u32, u32)> = Vec::new();

    for &(start_row, start_col, end_row, end_col) in ranges {
        let range_size = (end_row - start_row + 1) as u64 * (end_col - start_col + 1) as u64;

        if range_size > LARGE_RANGE_THRESHOLD {
            // Large range: iterate only existing (materialized) cells to apply
            // format, skip per-cell PropertyChange to avoid massive allocations.
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

            // Batch: compute hex keys, then write all in one transaction.
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
                &format,
            );

            for (cell_id, row, col) in existing {
                affected_cells.push((cell_id.as_u128(), row, col));
            }

            // Emit a single range-level PropertyChange.
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
            // Collect cell IDs first, then batch write. `ensure_cell_id_mirrored`
            // registers identity in both the in-memory GridIndex and the yrs
            // `gridIndex/{posToId, idToPos}` sub-maps so remote peers can resolve
            // this cell's position after CRDT sync.
            let mut cell_data: Vec<(SmallHex, u128, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) = super::cell_editing::ensure_cell_id_mirrored(
                        stores, mirror, sheet_id, row, col,
                    ) else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, cell_id.as_u128(), row, col));
                }
            }

            // Batch write all cells in one yrs transaction.
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
                &format,
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

/// Core logic for clearing format across ranges.
///
/// Returns `(affected_cells, MutationResult)` — the caller (bridge delegator)
/// is responsible for observer suppression and viewport patch production.
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

        if range_size > LARGE_RANGE_THRESHOLD {
            // Large range: iterate only existing (materialized) cells to clear
            // format, skip per-cell PropertyChange to avoid massive allocations.
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

            // Batch: compute hex keys, then clear all in one transaction.
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

            // Emit a single range-level PropertyChange.
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
            // Collect cell IDs first, then batch clear. Cells without an
            // existing CellId have no format to clear — skip them rather
            // than minting phantom marker cells.
            let mut cell_data: Vec<(SmallHex, u128, u32, u32)> = Vec::new();
            for row in start_row..=end_row {
                for col in start_col..=end_col {
                    let Some(cell_id) =
                        super::cell_editing::find_cell_id_at(stores, sheet_id, row, col)
                    else {
                        continue;
                    };
                    let cell_hex = id_to_hex(cell_id.as_u128());
                    cell_data.push((cell_hex, cell_id.as_u128(), row, col));
                }
            }

            // Batch clear all cells in one yrs transaction.
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

// -------------------------------------------------------------------
// CF CRUD Mutations
// -------------------------------------------------------------------

/// Add a conditional format (with rules) to a sheet.
///
/// The caller is responsible for resolving range identities (via
/// `resolve_cf_ranges_to_identities`), refreshing the CF cache, and
/// producing viewport patches.
pub(in crate::storage::engine) fn add_cf_rule(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule: &ConditionalFormat,
) -> MutationResult {
    cf_store::add_conditional_format(stores.storage.doc(), &stores.storage.sheets_ref(), rule);
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        rule_id: Some(rule.id.clone()),
    });
    result
}

/// Bump every existing CF rule priority on a sheet by `delta`.
///
/// Typed replacement for the prior JSON round-trip + `update_cf_rule`
/// loop in `engine::formatting::add_cf_rule` that re-serialized every
/// format and bumped each rule's `priority` field through the public
/// merge-update path. The new path mutates priorities in place via
/// [`CFRule::set_priority`] and writes back as a structured Y.Map.
///
/// filter viewport finding 13 (rust): the previous implementation discarded
/// errors via `let _ =` — silent failure. This function fails loudly:
/// any I/O failure during the typed rewrite returns a `ComputeError`.
pub(in crate::storage::engine) fn bump_cf_priorities(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    delta: i32,
) -> Result<usize, ComputeError> {
    cf_store::bump_priorities_for_sheet(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        delta,
    )
}

/// Update an existing conditional format by merging JSON updates.
///
/// Returns `Err` if the rule was not found. The caller is responsible for
/// refreshing the CF cache and producing viewport patches.
pub(in crate::storage::engine) fn update_cf_rule(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::update_conditional_format(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        rule_id,
        sheet_id,
        updates,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule not found: {}", rule_id),
        });
    }
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        rule_id: Some(rule_id.to_string()),
    });
    Ok(result)
}

/// Delete a conditional format by ID.
///
/// Returns `Err` if the rule was not found. The caller is responsible for
/// refreshing the CF cache and producing viewport patches.
pub(in crate::storage::engine) fn delete_cf_rule(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule_id: &str,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::delete_conditional_format(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        rule_id,
        sheet_id,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule not found: {}", rule_id),
        });
    }
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Removed,
        rule_id: Some(rule_id.to_string()),
    });
    Ok(result)
}

/// Reorder conditional formats for a sheet by providing the new order of format IDs.
///
/// The caller is responsible for refreshing the CF cache and producing viewport patches.
pub(in crate::storage::engine) fn reorder_cf_rules(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    rule_ids: &[String],
) -> Result<MutationResult, ComputeError> {
    cf_store::reorder_conditional_formats(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        rule_ids,
    )?;
    let mut result = MutationResult::empty();
    result.cf_changes.push(CfChange {
        sheet_id: sheet_id.to_uuid_string(),
        kind: ChangeKind::Set,
        rule_id: None,
    });
    Ok(result)
}

/// Update the ranges of a conditional format.
///
/// Returns `Err` if the format was not found. The caller is responsible for
/// refreshing the CF cache.
pub(in crate::storage::engine) fn update_cf_ranges(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    new_ranges: &[CFCellRange],
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::update_cf_ranges(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        new_ranges,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF format not found: {}", format_id),
        });
    }
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// CF Rule-level CRUD
// -------------------------------------------------------------------

/// Add a rule to an existing conditional format.
///
/// The caller is responsible for refreshing the CF cache.
pub(in crate::storage::engine) fn add_rule_to_cf(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    rule: &CFRule,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::add_cf_rule(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        rule,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF format not found: {}", format_id),
        });
    }
    Ok(MutationResult::empty())
}

/// Update a rule within a conditional format by merging JSON updates.
///
/// The caller is responsible for refreshing the CF cache.
pub(in crate::storage::engine) fn update_rule_in_cf(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    rule_id: &str,
    updates: &serde_json::Value,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::update_cf_rule(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        rule_id,
        updates,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule '{}' not found in format '{}'", rule_id, format_id),
        });
    }
    Ok(MutationResult::empty())
}

/// Delete a rule from a conditional format. If no rules remain, deletes the format.
///
/// The caller is responsible for refreshing the CF cache.
pub(in crate::storage::engine) fn delete_rule_from_cf(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
    rule_id: &str,
) -> Result<MutationResult, ComputeError> {
    let success = cf_store::delete_cf_rule(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
        rule_id,
    );
    if !success {
        return Err(ComputeError::Eval {
            message: format!("CF rule '{}' not found in format '{}'", rule_id, format_id),
        });
    }
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// CF identity resolution
// -------------------------------------------------------------------

/// Resolve position-based CF ranges to CellId-based range identities.
/// For each corner cell, looks up or allocates a CellId in the CellMirror.
pub(in crate::storage::engine) fn resolve_cf_ranges_to_identities(
    mirror: &mut CellMirror,
    id_alloc: &Arc<IdAllocator>,
    sheet_id: &SheetId,
    ranges: &[CFCellRange],
) -> Vec<domain_types::domain::conditional_format::CellIdRange> {
    let mut result = Vec::with_capacity(ranges.len());
    for range in ranges {
        let start_id = mirror.ensure_cell_id(
            sheet_id,
            SheetPos::new(range.start_row(), range.start_col()),
            id_alloc,
        );
        let end_id = mirror.ensure_cell_id(
            sheet_id,
            SheetPos::new(range.end_row(), range.end_col()),
            id_alloc,
        );
        if let (Some(start), Some(end)) = (start_id, end_id) {
            result.push(domain_types::domain::conditional_format::CellIdRange {
                top_left_cell_id: start.to_uuid_string(),
                bottom_right_cell_id: end.to_uuid_string(),
            });
        }
    }
    result
}

// -------------------------------------------------------------------
// Row/Col format
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn set_row_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    row: u32,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    properties::set_row_format(
        &mut stores.storage,
        sheet_id,
        row,
        format,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn set_col_format(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col: u32,
    format: &CellFormat,
) -> Result<MutationResult, ComputeError> {
    properties::set_col_format(
        &mut stores.storage,
        sheet_id,
        col,
        format,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// CF CRUD Reads
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_all_cf_rules(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<ConditionalFormat> {
    cf_store::get_formats_for_sheet(stores.storage.doc(), &stores.storage.sheets_ref(), sheet_id)
}

pub(in crate::storage::engine) fn get_cf_rules_for_cell(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Vec<ConditionalFormat> {
    cf_store::get_formats_for_cell(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn get_conditional_format(
    stores: &EngineStores,
    sheet_id: &SheetId,
    format_id: &str,
) -> Option<ConditionalFormat> {
    cf_store::get_conditional_format(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        format_id,
        sheet_id,
    )
}

pub(in crate::storage::engine) fn has_cf_for_cell(
    stores: &EngineStores,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> bool {
    cf_store::has_cf_for_cell(
        stores.storage.doc(),
        &stores.storage.sheets_ref(),
        sheet_id,
        row,
        col,
    )
}

pub(in crate::storage::engine) fn clear_cf_formats_for_sheet(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
) -> Result<MutationResult, ComputeError> {
    cf_store::clear_formats_for_sheet(stores.storage.doc(), &stores.storage.sheets_ref(), sheet_id);
    stores.cf_cache.remove(sheet_id);
    Ok(MutationResult::empty())
}

// -------------------------------------------------------------------
// CF Range Geometry Queries (pure — no engine state)
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn cf_ranges_overlap(a: &CFCellRange, b: &CFCellRange) -> bool {
    cf_store::cf_ranges_overlap(a, b)
}

pub(in crate::storage::engine) fn cf_range_contains(
    outer: &CFCellRange,
    inner: &CFCellRange,
) -> bool {
    cf_store::cf_range_contains(outer, inner)
}

pub(in crate::storage::engine) fn cf_subtract_range(
    original: &CFCellRange,
    subtract: &CFCellRange,
) -> Vec<CFCellRange> {
    cf_store::cf_subtract_range(original, subtract)
}

pub(in crate::storage::engine) fn cf_intersect_ranges(
    a: &CFCellRange,
    b: &CFCellRange,
) -> Option<CFCellRange> {
    cf_store::cf_intersect_ranges(a, b)
}

pub(in crate::storage::engine) fn cf_is_valid_range(range: &CFCellRange) -> bool {
    cf_store::cf_is_valid_range(range)
}

pub(in crate::storage::engine) fn get_icon_set_presets() -> Vec<CFIconSetPreset> {
    cf_store::icon_set_presets()
}

pub(in crate::storage::engine) fn get_cf_preset_by_id(id: &str) -> Option<CFPresetCategory> {
    cf_store::get_preset_by_id(id)
}

// -------------------------------------------------------------------
// Schema Storage CRUD
// -------------------------------------------------------------------

pub(in crate::storage::engine) fn get_column_schema(
    stores: &EngineStores,
    sheet_id: &SheetId,
    col_index: u32,
) -> Option<ColumnSchema> {
    schemas::get_column_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col_index,
        stores.grid_indexes.get(sheet_id),
    )
}

pub(in crate::storage::engine) fn set_column_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col_index: u32,
    schema: &ColumnSchema,
) -> Result<MutationResult, ComputeError> {
    schemas::set_column_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col_index,
        schema,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn clear_column_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    col_index: u32,
) -> Result<MutationResult, ComputeError> {
    schemas::clear_column_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        col_index,
        stores.grid_indexes.get(sheet_id),
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn get_all_column_schemas(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<(u32, ColumnSchema)> {
    schemas::get_all_column_schemas(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        stores.grid_indexes.get(sheet_id),
    )
}

pub(in crate::storage::engine) fn get_range_schema(
    stores: &EngineStores,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Option<RangeSchema> {
    schemas::get_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema_id,
    )
}

pub(in crate::storage::engine) fn get_range_schemas_for_sheet(
    stores: &EngineStores,
    sheet_id: &SheetId,
) -> Vec<RangeSchema> {
    schemas::get_range_schemas_for_sheet(stores.storage.doc(), stores.storage.sheets(), sheet_id)
}

pub(in crate::storage::engine) fn set_range_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    schema: &RangeSchema,
) -> Result<MutationResult, ComputeError> {
    schemas::set_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema,
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn update_range_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    schema_id: &str,
    updates: &RangeSchema,
) -> Result<MutationResult, ComputeError> {
    schemas::update_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema_id,
        updates,
    )?;
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn delete_range_schema(
    stores: &mut EngineStores,
    sheet_id: &SheetId,
    schema_id: &str,
) -> Result<MutationResult, ComputeError> {
    schemas::delete_range_schema(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        schema_id,
    );
    Ok(MutationResult::empty())
}

pub(in crate::storage::engine) fn validate_cell_value(
    stores: &EngineStores,
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &str,
) -> CellValidationResult {
    schemas::validate_cell_value(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        value,
        stores.grid_indexes.get(sheet_id),
        mirror,
    )
}

/// Run the sheet's data-validation rules (`dataValidations` Y.Array) against
/// `value` at `(row, col)` and return a tri-state outcome.
///
/// Used by `prepare_recalc_for_flush` to produce pass/fail annotations for
/// dirty cells covered by data-validation rules. Column schemas are handled
/// separately by `ComputeCore::validate_dirty_cells`.
pub(in crate::storage::engine) fn validate_cell_against_data_validations(
    stores: &EngineStores,
    mirror: &crate::mirror::CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
    value: &value_types::CellValue,
) -> schemas::DataValidationOutcome {
    schemas::validate_cell_value_against_data_validations(
        stores.storage.doc(),
        stores.storage.sheets(),
        sheet_id,
        row,
        col,
        value,
        stores.grid_indexes.get(sheet_id),
        mirror,
    )
}
