use std::collections::HashMap;

use domain_types::{CellData as DomainCellData, DataTableRegion};
use ooxml_types::worksheet::{CellFormula, CellFormulaType};

pub(super) fn data_table_master_formula_map(
    regions: &[DataTableRegion],
) -> HashMap<(u32, u32), CellFormula> {
    regions
        .iter()
        .map(|region| {
            let flags = data_table_ooxml_flags_for_export(region);
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

fn data_table_ooxml_flags_for_export(
    region: &DataTableRegion,
) -> domain_types::DataTableOoxmlFlags {
    let mut flags = region.ooxml_flags.clone().unwrap_or_default();
    if region.row_input_ref.is_some() && region.col_input_ref.is_some() {
        flags.dt2d = true;
    }
    flags
}

pub(super) fn data_table_formula_text(cell_formula: &CellFormula) -> String {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum SharedFormulaDisposition {
    Preserved,
    Decompacted(&'static str),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SharedFormulaDiagnostic {
    pub(super) si: Option<u32>,
    pub(super) master: Option<(u32, u32)>,
    pub(super) ref_range: Option<String>,
    pub(super) disposition: SharedFormulaDisposition,
    pub(super) affected_cells: Vec<(u32, u32)>,
}

#[derive(Debug, Default)]
pub(super) struct SharedFormulaExportPlan {
    metadata_by_cell: HashMap<(u32, u32), CellFormula>,
    pub(super) diagnostics: Vec<SharedFormulaDiagnostic>,
}

impl SharedFormulaExportPlan {
    pub(super) fn metadata_for(&self, row: u32, col: u32) -> Option<&CellFormula> {
        self.metadata_by_cell.get(&(row, col))
    }
}

#[derive(Debug, Clone)]
struct SharedFormulaCandidate<'a> {
    si: u32,
    masters: Vec<&'a DomainCellData>,
    members: Vec<&'a DomainCellData>,
}

pub(super) fn shared_formula_export_plan(cells: &[DomainCellData]) -> SharedFormulaExportPlan {
    let mut cells_by_pos = HashMap::with_capacity(cells.len());
    let mut candidates: HashMap<u32, SharedFormulaCandidate<'_>> = HashMap::new();
    let mut diagnostics = Vec::new();

    for cell in cells {
        cells_by_pos.insert((cell.row, cell.col), cell);

        let Some(formula) = cell.cell_formula.as_ref() else {
            continue;
        };
        if formula.t != CellFormulaType::Shared {
            continue;
        }

        let Some(si) = formula.si else {
            diagnostics.push(shared_formula_diagnostic(
                None,
                Some((cell.row, cell.col)),
                formula.r#ref.clone(),
                SharedFormulaDisposition::Decompacted("missing_si"),
                vec![(cell.row, cell.col)],
            ));
            continue;
        };

        let candidate = candidates
            .entry(si)
            .or_insert_with(|| SharedFormulaCandidate {
                si,
                masters: Vec::new(),
                members: Vec::new(),
            });
        if is_shared_formula_master(formula) {
            candidate.masters.push(cell);
        }
        candidate.members.push(cell);
    }

    let mut metadata_by_cell = HashMap::new();
    for candidate in candidates.into_values() {
        match validate_shared_formula_candidate(&candidate, &cells_by_pos) {
            Ok(group) => {
                let ValidSharedFormulaGroup {
                    master_row,
                    master_col,
                    ref_range,
                    affected_cells,
                    metadata_by_cell: group_metadata,
                } = group;
                metadata_by_cell.extend(group_metadata);
                diagnostics.push(shared_formula_diagnostic(
                    Some(candidate.si),
                    Some((master_row, master_col)),
                    Some(ref_range),
                    SharedFormulaDisposition::Preserved,
                    affected_cells,
                ));
            }
            Err(diagnostic) => diagnostics.push(diagnostic),
        }
    }

    SharedFormulaExportPlan {
        metadata_by_cell,
        diagnostics,
    }
}

struct ValidSharedFormulaGroup {
    master_row: u32,
    master_col: u32,
    ref_range: String,
    affected_cells: Vec<(u32, u32)>,
    metadata_by_cell: HashMap<(u32, u32), CellFormula>,
}

fn validate_shared_formula_candidate(
    candidate: &SharedFormulaCandidate<'_>,
    cells_by_pos: &HashMap<(u32, u32), &DomainCellData>,
) -> Result<ValidSharedFormulaGroup, SharedFormulaDiagnostic> {
    if candidate.masters.is_empty() {
        return Err(candidate_diagnostic(candidate, "missing_master"));
    }
    if candidate.masters.len() != 1 {
        return Err(candidate_diagnostic(candidate, "duplicate_master"));
    }

    let master = candidate.masters[0];
    let master_formula = master
        .cell_formula
        .as_ref()
        .expect("shared formula master came from cell metadata");

    if has_unsupported_shared_formula_attributes(master_formula) {
        return Err(candidate_diagnostic(
            candidate,
            "unsupported_formula_attribute",
        ));
    }

    let Some(ref_range) = master_formula.r#ref.as_deref() else {
        return Err(candidate_diagnostic(candidate, "invalid_ref"));
    };
    let Some((start_row, start_col, end_row, end_col)) =
        crate::infra::a1::parse_a1_range(ref_range)
    else {
        return Err(candidate_diagnostic(candidate, "invalid_ref"));
    };

    if master.row < start_row
        || master.row > end_row
        || master.col < start_col
        || master.col > end_col
    {
        return Err(candidate_diagnostic(candidate, "invalid_ref"));
    }

    let Some(current_master_formula) = master.formula.as_deref() else {
        return Err(candidate_diagnostic(candidate, "missing_live_formula"));
    };
    if !formulas_match(current_master_formula, &master_formula.text) {
        return Err(candidate_diagnostic(candidate, "formula_mismatch"));
    }

    let mut metadata_by_cell = HashMap::new();
    let mut affected_cells = Vec::new();
    for row in start_row..=end_row {
        for col in start_col..=end_col {
            let Some(cell) = cells_by_pos.get(&(row, col)).copied() else {
                return Err(candidate_diagnostic(candidate, "missing_follower"));
            };
            let Some(current_formula) = cell.formula.as_deref() else {
                return Err(candidate_diagnostic(candidate, "missing_live_formula"));
            };
            let Some(cell_formula) = cell.cell_formula.as_ref() else {
                return Err(candidate_diagnostic(candidate, "conflicting_formula_owner"));
            };
            if cell_formula.t != CellFormulaType::Shared || cell_formula.si != Some(candidate.si) {
                return Err(candidate_diagnostic(candidate, "conflicting_formula_owner"));
            }
            if has_unsupported_shared_formula_attributes(cell_formula) {
                return Err(candidate_diagnostic(
                    candidate,
                    "unsupported_formula_attribute",
                ));
            }

            let is_master = row == master.row && col == master.col;
            if is_master {
                if !is_shared_formula_master(cell_formula) {
                    return Err(candidate_diagnostic(candidate, "missing_master"));
                }
            } else if cell_formula.r#ref.is_some() {
                return Err(candidate_diagnostic(candidate, "duplicate_master"));
            }

            let row_offset = row as i32 - master.row as i32;
            let col_offset = col as i32 - master.col as i32;
            let expected = crate::domain::cells::adjust_formula_references(
                master_formula.text.as_bytes(),
                row_offset,
                col_offset,
            );
            if !formulas_match(current_formula, &expected) {
                return Err(candidate_diagnostic(candidate, "formula_mismatch"));
            }

            let mut emitted = CellFormula {
                t: CellFormulaType::Shared,
                si: Some(candidate.si),
                ..Default::default()
            };
            if is_master {
                emitted.r#ref = Some(ref_range.to_string());
                emitted.text = master_formula.text.clone();
            }
            metadata_by_cell.insert((row, col), emitted);
            affected_cells.push((row, col));
        }
    }

    for cell in &candidate.members {
        if cell.row < start_row || cell.row > end_row || cell.col < start_col || cell.col > end_col
        {
            return Err(candidate_diagnostic(candidate, "same_si_outside_ref"));
        }
    }

    Ok(ValidSharedFormulaGroup {
        master_row: master.row,
        master_col: master.col,
        ref_range: ref_range.to_string(),
        affected_cells,
        metadata_by_cell,
    })
}

fn is_shared_formula_master(formula: &CellFormula) -> bool {
    formula.t == CellFormulaType::Shared && formula.r#ref.is_some() && !formula.text.is_empty()
}

fn has_unsupported_shared_formula_attributes(formula: &CellFormula) -> bool {
    formula.aca
        || formula.ca
        || formula.dt2d
        || formula.del1
        || formula.del2
        || formula.r1.is_some()
        || formula.r2.is_some()
        || formula.bx
        || formula.dtr
}

fn candidate_diagnostic(
    candidate: &SharedFormulaCandidate<'_>,
    reason: &'static str,
) -> SharedFormulaDiagnostic {
    let master = candidate.masters.first().copied();
    shared_formula_diagnostic(
        Some(candidate.si),
        master.map(|cell| (cell.row, cell.col)),
        master
            .and_then(|cell| cell.cell_formula.as_ref())
            .and_then(|formula| formula.r#ref.clone()),
        SharedFormulaDisposition::Decompacted(reason),
        candidate
            .members
            .iter()
            .map(|cell| (cell.row, cell.col))
            .collect(),
    )
}

fn shared_formula_diagnostic(
    si: Option<u32>,
    master: Option<(u32, u32)>,
    ref_range: Option<String>,
    disposition: SharedFormulaDisposition,
    affected_cells: Vec<(u32, u32)>,
) -> SharedFormulaDiagnostic {
    SharedFormulaDiagnostic {
        si,
        master,
        ref_range,
        disposition,
        affected_cells,
    }
}

pub(super) fn current_formula_metadata(cell: &DomainCellData) -> Option<&CellFormula> {
    cell.cell_formula
        .as_ref()
        .filter(|formula| current_formula_metadata_matches_current_cell(cell, formula))
}

fn current_formula_metadata_matches_current_cell(
    cell: &DomainCellData,
    formula: &CellFormula,
) -> bool {
    if !formula_metadata_matches_current_cell(cell, formula) {
        return false;
    }

    match formula.t {
        CellFormulaType::Shared => false,
        CellFormulaType::Array => current_array_formula_ref_matches(cell, formula),
        _ => true,
    }
}

fn current_array_formula_ref_matches(cell: &DomainCellData, formula: &CellFormula) -> bool {
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

fn formula_metadata_matches_current_cell(cell: &DomainCellData, formula: &CellFormula) -> bool {
    let Some(current_formula) = cell.formula.as_deref() else {
        return false;
    };

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

fn formula_identity_text(formula: &str) -> String {
    let normalized = compute_parser::normalize_xlsx_formula(formula);
    if let Ok(parsed) = compute_parser::parse_formula(&normalized, None) {
        return parsed.into_inner().to_string();
    }

    normalized
        .strip_prefix('=')
        .unwrap_or_else(|| formula.strip_prefix('=').unwrap_or(formula))
        .to_string()
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

#[cfg(test)]
mod tests {
    use super::{SharedFormulaDisposition, formulas_match, shared_formula_export_plan};
    use domain_types::{CellData as DomainCellData, CellValue as DomainValue};
    use ooxml_types::worksheet::{CellFormula, CellFormulaType};
    use value_types::FiniteF64;

    #[test]
    fn formula_identity_treats_optional_sheet_quotes_as_equivalent() {
        assert!(formulas_match(
            "=UNIQUE(FILTER(Time_Capture!W2:Time_Capture!W99999, Time_Capture!W2:Time_Capture!W99999<>\"\"))",
            "=UNIQUE(FILTER(Time_Capture!W2:'Time_Capture'!W99999, Time_Capture!W2:'Time_Capture'!W99999<>\"\"))",
        ));
    }

    #[test]
    fn shared_formula_plan_preserves_valid_group() {
        let cells = vec![
            shared_formula_cell(0, 0, "A1+1", 0, Some("A1:A2"), "A1+1"),
            shared_formula_cell(1, 0, "A2+1", 0, None, ""),
        ];

        let plan = shared_formula_export_plan(&cells);

        assert!(matches!(
            plan.diagnostics[0].disposition,
            SharedFormulaDisposition::Preserved
        ));
        assert_eq!(plan.diagnostics[0].si, Some(0));
        assert_eq!(plan.diagnostics[0].master, Some((0, 0)));
        assert_eq!(plan.diagnostics[0].ref_range.as_deref(), Some("A1:A2"));
        assert_eq!(plan.diagnostics[0].affected_cells, vec![(0, 0), (1, 0)]);
        assert_eq!(
            plan.metadata_for(0, 0)
                .and_then(|formula| formula.r#ref.as_deref()),
            Some("A1:A2")
        );
        assert_eq!(
            plan.metadata_for(1, 0).and_then(|formula| formula.si),
            Some(0)
        );
        assert_eq!(
            plan.metadata_for(1, 0).map(|formula| formula.text.as_str()),
            Some("")
        );
    }

    #[test]
    fn shared_formula_plan_decompacts_stale_group() {
        let cells = vec![
            shared_formula_cell(0, 0, "A1+1", 0, Some("A1:A2"), "A1+1"),
            shared_formula_cell(1, 0, "B2+1", 0, None, ""),
        ];

        let plan = shared_formula_export_plan(&cells);

        assert!(matches!(
            plan.diagnostics[0].disposition,
            SharedFormulaDisposition::Decompacted("formula_mismatch")
        ));
        assert!(plan.metadata_for(0, 0).is_none());
        assert!(plan.metadata_for(1, 0).is_none());
    }

    fn shared_formula_cell(
        row: u32,
        col: u32,
        formula: &str,
        si: u32,
        ref_range: Option<&str>,
        formula_text: &str,
    ) -> DomainCellData {
        DomainCellData {
            row,
            col,
            value: DomainValue::Number(FiniteF64::must(1.0)),
            formula: Some(formula.to_string()),
            cell_formula: Some(CellFormula {
                t: CellFormulaType::Shared,
                si: Some(si),
                r#ref: ref_range.map(str::to_string),
                text: formula_text.to_string(),
                ..Default::default()
            }),
            ..Default::default()
        }
    }
}
