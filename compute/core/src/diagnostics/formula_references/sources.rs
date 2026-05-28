use cell_types::{CellId, SheetId};
use formula_types::Scope;

use crate::mirror::{CellMirror, SheetMirror};
use crate::scheduler::ComputeCore;

use super::types::FormulaReferenceSourceKind;

#[derive(Clone)]
pub(super) struct SourceFormula {
    pub(super) source_kind: FormulaReferenceSourceKind,
    pub(super) source_stable_id: String,
    pub(super) sheet_id: Option<SheetId>,
    pub(super) cell_id: Option<CellId>,
    pub(super) row: Option<u32>,
    pub(super) col: Option<u32>,
    pub(super) name: Option<String>,
    pub(super) name_id: Option<String>,
    pub(super) formula: String,
    pub(super) order: SourceOrder,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) struct SourceOrder {
    sheet_index: usize,
    row: u32,
    col: u32,
    source_rank: u8,
}

pub(super) fn collect_sources(
    mirror: &CellMirror,
    compute: &ComputeCore,
    document_id: &str,
    sheet_filter: Option<SheetId>,
) -> Vec<SourceFormula> {
    let mut sources = Vec::new();
    let ordered: Vec<SheetId> = compute.ordered_sheets_for_diagnostics().to_vec();
    for (sheet_index, sheet_id) in ordered.iter().enumerate() {
        if sheet_filter.is_some_and(|filter| filter != *sheet_id) {
            continue;
        }
        let Some(sheet) = mirror.get_sheet(sheet_id) else {
            continue;
        };
        collect_sheet_sources(sheet, compute, document_id, sheet_index, &mut sources);
    }

    if sheet_filter.is_none() {
        for (scope, name, def) in mirror.all_named_ranges_for_diagnostics() {
            let formula = def.raw_expression.as_ref().map_or_else(
                || render_identity_template(&def.refers_to.template),
                Clone::clone,
            );
            if formula.trim().is_empty() {
                continue;
            }
            sources.push(SourceFormula {
                source_kind: FormulaReferenceSourceKind::NamedRangeFormula,
                source_stable_id: format!("{document_id}:{scope:?}:{name}"),
                sheet_id: match scope {
                    Scope::Sheet(sid) => Some(*sid),
                    Scope::Workbook => None,
                },
                cell_id: None,
                row: None,
                col: None,
                name: Some(name.clone()),
                name_id: Some(format!("{document_id}:{scope:?}:{name}")),
                formula,
                order: SourceOrder {
                    sheet_index: usize::MAX - 1,
                    row: u32::MAX,
                    col: u32::MAX,
                    source_rank: 1,
                },
            });
        }
    }
    sources
}

fn collect_sheet_sources(
    sheet: &SheetMirror,
    compute: &ComputeCore,
    document_id: &str,
    sheet_index: usize,
    sources: &mut Vec<SourceFormula>,
) {
    let mut cells: Vec<_> = sheet.cells_iter().collect();
    cells.sort_by_key(|(cell_id, _)| {
        sheet
            .position_for_diagnostics(cell_id)
            .map_or((u32::MAX, u32::MAX), |p| (p.row(), p.col()))
    });
    for (cell_id, entry) in cells {
        if entry.formula.is_none() {
            continue;
        }
        let Some(pos) = sheet.position_for_diagnostics(cell_id) else {
            continue;
        };
        let Some(formula) = compute.get_formula(cell_id) else {
            continue;
        };
        sources.push(SourceFormula {
            source_kind: FormulaReferenceSourceKind::CellFormula,
            source_stable_id: format!("{document_id}:{}", cell_id.to_uuid_string()),
            sheet_id: Some(sheet.id),
            cell_id: Some(*cell_id),
            row: Some(pos.row()),
            col: Some(pos.col()),
            name: None,
            name_id: None,
            formula: normalize_display_formula(formula),
            order: SourceOrder {
                sheet_index,
                row: pos.row(),
                col: pos.col(),
                source_rank: 0,
            },
        });
    }
}

fn render_identity_template(template: &str) -> String {
    normalize_display_formula(template)
}

pub(super) fn normalize_display_formula(formula: &str) -> String {
    if formula.starts_with('=') {
        formula.to_string()
    } else {
        format!("={formula}")
    }
}
