//! Formula text synthesis for Excel Data Table regions.
//!
//! XLSX Data Tables are region-owned formulas: the region definition carries
//! the input refs, while body cells may only have cached values. Readback
//! surfaces still need to show Excel's synthesized `{=TABLE(r2,r1)}` text.

use cell_types::SheetId;
use formula_types::CellRef;
use snapshot_types::DataTableRegionDef;

use crate::mirror::CellMirror;
use crate::range_manager::{A1CellRef, stringify_cell};

/// Return the Excel formula-bar text for the Data Table containing `(row, col)`.
///
/// The returned string includes the leading `=`. Returns `None` outside a Data
/// Table region or when the region has neither input ref.
pub(crate) fn formula_at(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    row: u32,
    col: u32,
) -> Option<String> {
    let region = mirror.find_data_table_at(sheet_id, row, col)?;
    formula_for_region(mirror, sheet_id, region)
}

pub(super) fn formula_for_region(
    mirror: &CellMirror,
    sheet_id: &SheetId,
    region: &DataTableRegionDef,
) -> Option<String> {
    if region.row_input_ref.is_none() && region.col_input_ref.is_none() {
        return None;
    }

    let row_arg = region
        .row_input_ref
        .as_ref()
        .and_then(|r| ref_to_a1(mirror, sheet_id, r))
        .unwrap_or_default();
    let col_arg = region
        .col_input_ref
        .as_ref()
        .and_then(|r| ref_to_a1(mirror, sheet_id, r))
        .unwrap_or_default();

    Some(format!("=TABLE({row_arg},{col_arg})"))
}

fn ref_to_a1(mirror: &CellMirror, current_sheet: &SheetId, cell_ref: &CellRef) -> Option<String> {
    let (sheet_id, row, col) = match cell_ref {
        CellRef::Positional { sheet, row, col } => {
            let sheet_id = if *sheet == SheetId::from_raw(0) {
                *current_sheet
            } else {
                *sheet
            };
            (sheet_id, *row, *col)
        }
        CellRef::Resolved(cell_id) => {
            let sheet_id = mirror.sheet_for_cell(cell_id)?;
            let pos = mirror.resolve_position(cell_id)?;
            (sheet_id, pos.row(), pos.col())
        }
    };

    let cell = stringify_cell(&A1CellRef {
        row,
        col,
        row_absolute: true,
        col_absolute: true,
    });

    if sheet_id == *current_sheet {
        return Some(cell);
    }

    let sheet_name = mirror
        .get_sheet(&sheet_id)
        .map(|s| s.name.as_str())
        .unwrap_or("");
    Some(format!("{}!{cell}", quote_sheet_name(sheet_name)))
}

fn quote_sheet_name(name: &str) -> String {
    if compute_parser::needs_quoting(name) {
        format!("'{}'", name.replace('\'', "''"))
    } else {
        name.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cell_types::SheetId;

    #[test]
    fn quote_sheet_name_matches_formula_reference_rules() {
        assert_eq!(quote_sheet_name("Sheet1"), "Sheet1");
        assert_eq!(quote_sheet_name("Revenue Data"), "'Revenue Data'");
        assert_eq!(quote_sheet_name("Dept's"), "'Dept''s'");
        assert_eq!(quote_sheet_name(""), "''");
    }

    #[test]
    fn positional_ref_formats_as_absolute_a1() {
        let sheet = SheetId::from_uuid_str("000000000000000000000000000000aa").unwrap();
        let mirror = CellMirror::new();
        let cell_ref = CellRef::Positional {
            sheet,
            row: 4,
            col: 27,
        };

        assert_eq!(
            ref_to_a1(&mirror, &sheet, &cell_ref).as_deref(),
            Some("$AB$5")
        );
    }
}
