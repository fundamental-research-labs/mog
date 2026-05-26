//! Resolution functions for structured references.

use super::super::types::{
    SpecialItem, StructuredRef, StructuredRefSpecifier, Table, TableColumn, TableRange,
};
use super::ResolvedRange;
use super::RowBound;

/// Resolve a structured reference to concrete grid ranges.
///
/// May produce multiple ranges for union refs (e.g., headers + totals with a gap).
/// Returns empty vec if the reference cannot be resolved.
///
/// **BUG FIX**: When resolving `#Data` on a table with header + totals but no data rows,
/// checks for inverted range (`data_start_row > data_end_row`) and returns empty instead
/// of pushing an inverted range.
pub fn resolve_structured_ref(
    ref_: &StructuredRef,
    tables: &[Table],
    current_row: Option<u32>,
) -> Vec<TableRange> {
    // Find table by name (case-insensitive)
    let table = match tables
        .iter()
        .find(|t| t.name.eq_ignore_ascii_case(&ref_.table_name))
    {
        Some(t) => t,
        None => return Vec::new(),
    };

    if ref_.specifiers.is_empty() {
        return Vec::new();
    }

    // Separate specifiers into special items / thisRow and column refs
    let mut special_items: Vec<SpecialItem> = Vec::new();
    let mut has_this_row = false;
    let mut column_specs: Vec<&StructuredRefSpecifier> = Vec::new();

    for spec in &ref_.specifiers {
        match spec {
            StructuredRefSpecifier::Special { item } => {
                special_items.push(*item);
            }
            StructuredRefSpecifier::ThisRow => {
                has_this_row = true;
            }
            StructuredRefSpecifier::Column { .. } | StructuredRefSpecifier::ColumnRange { .. } => {
                column_specs.push(spec);
            }
        }
    }

    // Resolve row boundaries
    let row_bounds = match resolve_row_bounds(
        &table.range,
        table.has_header_row,
        table.has_totals_row,
        &special_items,
        has_this_row,
        current_row,
    ) {
        Some(bounds) => bounds,
        None => return Vec::new(),
    };
    if row_bounds.is_empty() {
        return Vec::new();
    }

    // Resolve column boundaries
    let col_bounds = match resolve_column_bounds(table, &column_specs) {
        Some(bounds) => bounds,
        None => return Vec::new(),
    };

    // Build ranges — for each row range, cross with each column range
    let mut ranges: Vec<TableRange> = Vec::new();
    for rb in &row_bounds {
        for &(start_col, end_col) in &col_bounds {
            ranges.push(TableRange::new(
                rb.start_row,
                start_col,
                rb.end_row,
                end_col,
            ));
        }
    }

    ranges
}

/// Resolve row boundaries from special items.
///
/// Takes the table range and structural flags directly, avoiding the need to
/// construct a full `Table`. This is used by both `resolve_structured_ref` (which
/// has a `Table`) and `resolve_ranges_from_table_def` (which has a `TableDef`).
///
/// Returns `None` if resolution fails (e.g., `#This Row` without `current_row`).
/// Returns `Some(empty vec)` if no rows match (e.g., `#Totals` on table without totals).
pub(crate) fn resolve_row_bounds(
    range: &TableRange,
    has_header_row: bool,
    has_totals_row: bool,
    special_items: &[SpecialItem],
    has_this_row: bool,
    current_row: Option<u32>,
) -> Option<Vec<RowBound>> {
    let data_start_row = range.start_row() + if has_header_row { 1 } else { 0 };
    let data_end_row = if has_totals_row {
        range.end_row().saturating_sub(1)
    } else {
        range.end_row()
    };

    // #This Row (from @ shorthand or explicit specifier)
    if has_this_row {
        let row = current_row?;
        return Some(vec![RowBound {
            start_row: row,
            end_row: row,
        }]);
    }

    // If there are special items, handle them
    if !special_items.is_empty() {
        // #All — entire table
        if special_items.contains(&SpecialItem::All) {
            return Some(vec![RowBound {
                start_row: range.start_row(),
                end_row: range.end_row(),
            }]);
        }

        // Collect individual row ranges from each special item
        let mut row_ranges: Vec<RowBound> = Vec::new();

        for item in special_items {
            match item {
                SpecialItem::Headers => {
                    if has_header_row {
                        row_ranges.push(RowBound {
                            start_row: range.start_row(),
                            end_row: range.start_row(),
                        });
                    }
                }
                SpecialItem::Data => {
                    // BUG FIX: check for inverted range (no data rows)
                    if data_start_row <= data_end_row {
                        row_ranges.push(RowBound {
                            start_row: data_start_row,
                            end_row: data_end_row,
                        });
                    }
                }
                SpecialItem::Totals => {
                    if has_totals_row {
                        row_ranges.push(RowBound {
                            start_row: range.end_row(),
                            end_row: range.end_row(),
                        });
                    }
                }
                SpecialItem::ThisRow => {
                    let row = current_row?;
                    row_ranges.push(RowBound {
                        start_row: row,
                        end_row: row,
                    });
                }
                SpecialItem::All => {
                    // Already handled above
                    unreachable!();
                }
            }
        }

        if row_ranges.is_empty() {
            return Some(Vec::new()); // No valid rows (e.g., #Totals on table without totals)
        }

        // Sort by start_row and merge only adjacent/overlapping ranges
        row_ranges.sort_by_key(|r| r.start_row);
        let mut merged: Vec<RowBound> = vec![row_ranges[0].clone()];
        for item in row_ranges.iter().skip(1) {
            let curr = item;
            let prev = merged.last_mut().unwrap();
            if curr.start_row <= prev.end_row + 1 {
                // Adjacent or overlapping — merge
                prev.end_row = prev.end_row.max(curr.end_row);
            } else {
                // Disjoint — keep separate
                merged.push(curr.clone());
            }
        }

        return Some(merged);
    }

    // Default (no special items, no @ shorthand): data rows
    // BUG FIX: check for inverted range (no data rows)
    if data_start_row > data_end_row {
        return Some(Vec::new());
    }
    Some(vec![RowBound {
        start_row: data_start_row,
        end_row: data_end_row,
    }])
}

/// Resolve column boundaries from column specifiers.
///
/// Returns `None` if a column is not found.
/// Returns full table width if no column specifiers.
pub(crate) fn resolve_column_bounds(
    table: &Table,
    column_specs: &[&StructuredRefSpecifier],
) -> Option<Vec<(u32, u32)>> {
    let range = &table.range;

    // No column specifiers — full table width
    if column_specs.is_empty() {
        return Some(vec![(range.start_col(), range.end_col())]);
    }

    let mut results: Vec<(u32, u32)> = Vec::new();

    for spec in column_specs {
        match spec {
            StructuredRefSpecifier::Column { name } => {
                let (_, col) = find_column(&table.columns, name)?;
                let grid_col = range.start_col() + col.index;
                results.push((grid_col, grid_col));
            }
            StructuredRefSpecifier::ColumnRange { start, end } => {
                let (_, start_col) = find_column(&table.columns, start)?;
                let (_, end_col) = find_column(&table.columns, end)?;
                let start_grid_col = range.start_col() + start_col.index.min(end_col.index);
                let end_grid_col = range.start_col() + start_col.index.max(end_col.index);
                results.push((start_grid_col, end_grid_col));
            }
            _ => {}
        }
    }

    if results.is_empty() {
        Some(vec![(range.start_col(), range.end_col())])
    } else {
        Some(results)
    }
}

/// Find a column by name (case-insensitive, zero-allocation).
pub(crate) fn find_column<'a>(
    table_columns: &'a [TableColumn],
    name: &str,
) -> Option<(usize, &'a TableColumn)> {
    table_columns
        .iter()
        .enumerate()
        .find(|(_, c)| c.name.eq_ignore_ascii_case(name))
}

// ============================================================================
// Bridge: resolve against TableDef (evaluator type)
// ============================================================================

/// Resolve a structured reference against a `TableDef` (used by the formula evaluator).
///
/// Returns a list of [`ResolvedRange`] structs representing the resolved cell ranges.
/// The column indices are absolute grid columns.
///
/// Returns `None` if resolution fails (e.g., column not found, `#This Row` without `current_row`).
pub fn resolve_ranges_from_table_def(
    ref_: &StructuredRef,
    table_def: &formula_types::TableDef,
    current_row: Option<u32>,
) -> Option<Vec<ResolvedRange>> {
    if ref_.specifiers.is_empty() {
        return None;
    }

    // Separate specifiers into special items / thisRow and column refs
    let mut special_items: Vec<SpecialItem> = Vec::new();
    let mut has_this_row = false;
    let mut column_specs: Vec<&StructuredRefSpecifier> = Vec::new();

    for spec in &ref_.specifiers {
        match spec {
            StructuredRefSpecifier::Special { item } => {
                special_items.push(*item);
            }
            StructuredRefSpecifier::ThisRow => {
                has_this_row = true;
            }
            StructuredRefSpecifier::Column { .. } | StructuredRefSpecifier::ColumnRange { .. } => {
                column_specs.push(spec);
            }
        }
    }

    // Resolve row bounds directly from TableDef fields (no Table allocation needed)
    let range = TableRange::new(
        table_def.start_row,
        table_def.start_col,
        table_def.end_row,
        table_def.end_col,
    );
    let row_bounds = resolve_row_bounds(
        &range,
        table_def.has_headers,
        table_def.has_totals,
        &special_items,
        has_this_row,
        current_row,
    )?;
    if row_bounds.is_empty() {
        return Some(Vec::new());
    }

    // Resolve column indices
    let col_indices = resolve_column_indices_from_table_def(table_def, &column_specs)?;

    // Combine row bounds with column indices
    let mut results: Vec<ResolvedRange> = Vec::new();
    for rb in &row_bounds {
        results.push(ResolvedRange {
            start_row: rb.start_row,
            end_row: rb.end_row,
            columns: col_indices.clone(),
        });
    }

    Some(results)
}

/// Resolve column specifiers to absolute grid column indices using a `TableDef`.
///
/// Returns `None` if a referenced column is not found.
/// Returns all columns if no column specifiers are present.
fn resolve_column_indices_from_table_def(
    table_def: &formula_types::TableDef,
    column_specs: &[&StructuredRefSpecifier],
) -> Option<Vec<u32>> {
    // No column specifiers — all columns
    if column_specs.is_empty() {
        return Some((table_def.start_col..=table_def.end_col).collect());
    }

    let mut indices: Vec<u32> = Vec::new();

    for spec in column_specs {
        match spec {
            StructuredRefSpecifier::Column { name } => {
                let idx = find_column_index_in_table_def(table_def, name)?;
                indices.push(table_def.start_col + idx);
            }
            StructuredRefSpecifier::ColumnRange { start, end } => {
                let start_idx = find_column_index_in_table_def(table_def, start)?;
                let end_idx = find_column_index_in_table_def(table_def, end)?;
                let lo = start_idx.min(end_idx);
                let hi = start_idx.max(end_idx);
                for i in lo..=hi {
                    indices.push(table_def.start_col + i);
                }
            }
            _ => {}
        }
    }

    // Deduplicate while preserving order
    let mut seen = std::collections::HashSet::new();
    indices.retain(|col| seen.insert(*col));

    if indices.is_empty() {
        // No column specs resolved — fall back to all columns
        Some((table_def.start_col..=table_def.end_col).collect())
    } else {
        Some(indices)
    }
}

/// Find a column index by name (case-insensitive, zero-allocation) in a `TableDef`.
fn find_column_index_in_table_def(table_def: &formula_types::TableDef, name: &str) -> Option<u32> {
    table_def
        .columns
        .iter()
        .position(|col_name| col_name.eq_ignore_ascii_case(name))
        .map(|i| i as u32)
}
