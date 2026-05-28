use std::collections::HashMap;

use domain_types::{CellData as DomainCellData, DataTableRegion};

pub(super) fn data_table_master_formula_map(
    regions: &[DataTableRegion],
) -> HashMap<(u32, u32), ooxml_types::worksheet::CellFormula> {
    use ooxml_types::worksheet::{CellFormula, CellFormulaType};

    regions
        .iter()
        .map(|region| {
            let flags = region.ooxml_flags.clone().unwrap_or_default();
            let cell_formula = CellFormula {
                t: CellFormulaType::DataTable,
                r#ref: Some(format!(
                    "{}:{}",
                    crate::infra::a1::to_a1(region.start_row, region.start_col),
                    crate::infra::a1::to_a1(region.end_row, region.end_col),
                )),
                // Domain DataTableRegion refs are normalized: col_input_ref
                // came from OOXML r1, row_input_ref came from OOXML r2.
                r1: flags.r1.clone().or_else(|| {
                    region
                        .col_input_ref
                        .as_ref()
                        .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
                }),
                r2: flags.r2.clone().or_else(|| {
                    region
                        .row_input_ref
                        .as_ref()
                        .and_then(crate::infra::a1::cell_ref_to_absolute_a1)
                }),
                aca: flags.aca,
                ca: flags.ca,
                bx: flags.bx,
                dt2d: flags.dt2d,
                dtr: flags.dtr,
                del1: flags.del1,
                del2: flags.del2,
                ..Default::default()
            };
            ((region.start_row, region.start_col), cell_formula)
        })
        .collect()
}

pub(super) fn data_table_formula_text(
    cell_formula: &ooxml_types::worksheet::CellFormula,
) -> String {
    let row_arg = cell_formula
        .r2
        .clone()
        .unwrap_or_else(|| "\"\"".to_string());
    let col_arg = cell_formula
        .r1
        .clone()
        .unwrap_or_else(|| "\"\"".to_string());
    format!("TABLE({row_arg},{col_arg})")
}

pub(super) fn current_formula_metadata(
    cell: &DomainCellData,
) -> Option<&ooxml_types::worksheet::CellFormula> {
    cell.cell_formula
        .as_ref()
        .filter(|formula| current_formula_metadata_matches_current_cell(cell, formula))
}

fn current_formula_metadata_matches_current_cell(
    cell: &DomainCellData,
    formula: &ooxml_types::worksheet::CellFormula,
) -> bool {
    use ooxml_types::worksheet::CellFormulaType;

    if !formula_metadata_matches_current_cell(cell, formula) {
        return false;
    }

    match formula.t {
        CellFormulaType::Shared => formula
            .r#ref
            .as_deref()
            .is_some_and(|r| single_cell_ref_matches(r, cell.row, cell.col)),
        CellFormulaType::Array => current_array_formula_ref_matches(cell, formula),
        _ => true,
    }
}

fn current_array_formula_ref_matches(
    cell: &DomainCellData,
    formula: &ooxml_types::worksheet::CellFormula,
) -> bool {
    let Some(ref_text) = formula.r#ref.as_deref() else {
        return false;
    };

    if single_cell_ref_matches(ref_text, cell.row, cell.col) {
        return true;
    }

    cell.array_ref.as_deref().is_some_and(|array_ref| {
        formulas_match(array_ref, ref_text) && range_starts_at(ref_text, cell.row, cell.col)
    })
}

fn formula_metadata_matches_current_cell(
    cell: &DomainCellData,
    formula: &ooxml_types::worksheet::CellFormula,
) -> bool {
    let Some(current_formula) = cell.formula.as_deref() else {
        return false;
    };

    use ooxml_types::worksheet::CellFormulaType;
    match formula.t {
        CellFormulaType::DataTable => formulas_match(
            current_formula,
            formula
                .text
                .is_empty()
                .then(|| data_table_formula_text(formula))
                .as_deref()
                .unwrap_or(&formula.text),
        ),
        CellFormulaType::Shared | CellFormulaType::Array if !formula.text.is_empty() => {
            formulas_match(current_formula, &formula.text)
        }
        CellFormulaType::Shared | CellFormulaType::Array => false,
        _ => true,
    }
}

fn range_starts_at(ref_text: &str, row: u32, col: u32) -> bool {
    crate::infra::a1::parse_a1_range(ref_text)
        .is_some_and(|(start_row, start_col, _, _)| start_row == row && start_col == col)
}

fn formulas_match(current: &str, imported: &str) -> bool {
    formula_identity_text(current) == formula_identity_text(imported)
}

fn formula_identity_text(formula: &str) -> &str {
    formula.strip_prefix('=').unwrap_or(formula)
}

fn single_cell_ref_matches(ref_text: &str, row: u32, col: u32) -> bool {
    if let Some((start_row, start_col, end_row, end_col)) =
        crate::infra::a1::parse_a1_range(ref_text)
    {
        start_row == row && end_row == row && start_col == col && end_col == col
    } else {
        crate::infra::a1::parse_a1_cell(ref_text)
            .is_some_and(|(ref_row, ref_col)| ref_row == row && ref_col == col)
    }
}

pub(super) fn is_data_table_body_formula(
    cell: &DomainCellData,
    is_data_table_master: bool,
) -> bool {
    if is_data_table_master {
        return false;
    }
    cell.formula
        .as_deref()
        .map(|formula| {
            let formula = formula.trim_start();
            let formula = formula.strip_prefix('=').unwrap_or(formula);
            formula
                .get(..6)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("TABLE("))
        })
        .unwrap_or(false)
}
