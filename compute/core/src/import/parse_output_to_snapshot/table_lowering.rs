//! Table lowering — boundaries 1.10–1.12.
//!
//! Convert `domain_types::TableSpec` → `formula_types::TableDef`.
//!
//! Collect tables from per-sheet `SheetData.tables` into flat `TableDef` list.
//!
//! Each table's sheet is determined by its position in the `sheet_data` array,
//! mapped to the corresponding `SheetSnapshot`'s ID. This eliminates the need
//! for fragile sheet-name resolution from `range_ref` prefixes.
//!
//! # Typed range refs: — typed pass
//!
//! `TableSpec.range_ref` is still a `String` at the `domain_types` layer
//! (that field doubles as the on-disk Yrs form — see
//! [`domain_types::yrs_schema::table`] — and the plan's "external-format
//! boundary" carve-out keeps it stringly at the persistence edge). Inside
//! the lowering step we route *once* through
//! [`compute_parser::parse_a1_range`] to obtain a typed
//! [`compute_parser::RangeRef`], then pattern-match the positional corners
//! directly into snapshot coordinates — no regex / `rfind('!')` shadow
//! parsing for the sheet prefix. The `split_sheet_prefix` entry point from
//! W1 handles sheet-qualified forms uniformly.

use domain_types::SheetData;
use formula_types::TableDef;

use super::SheetResolver;

pub(crate) fn convert_tables_from_sheets(
    sheet_data: &[SheetData],
    resolver: &SheetResolver<'_>,
) -> Vec<TableDef> {
    sheet_data
        .iter()
        .enumerate()
        .flat_map(|(sheet_idx, sd)| {
            let sheet_id = resolver
                .by_index(sheet_idx)
                .and_then(|uuid| cell_types::SheetId::from_uuid_str(uuid).ok())
                .unwrap_or_else(|| cell_types::SheetId::from_raw(0));

            sd.tables.iter().filter_map(move |table| {
                // Typed range refs: typed pass. Strip optional sheet prefix via
                // `split_sheet_prefix` (the W1-consolidated A1 entry point,
                // UTF-8-safe and handling `'Quoted Sheet'!` forms correctly),
                // then parse once into a typed `RangeRef`.
                let (_sheet, rest) = compute_parser::split_sheet_prefix(&table.range_ref);
                let range = compute_parser::parse_a1_range(rest)?;

                let (start_row, start_col) = match range.start {
                    formula_types::CellRef::Positional { row, col, .. } => (row, col),
                    formula_types::CellRef::Resolved(_) => return None,
                };
                let (end_row, end_col) = match range.end {
                    formula_types::CellRef::Positional { row, col, .. } => (row, col),
                    formula_types::CellRef::Resolved(_) => return None,
                };

                Some(TableDef {
                    name: table.name.clone(),
                    sheet: sheet_id,
                    start_row,
                    start_col,
                    end_row,
                    end_col,
                    columns: table.columns.iter().map(|c| c.name.clone()).collect(),
                    has_headers: table.has_headers,
                    has_totals: table.has_totals,
                })
            })
        })
        .collect()
}
