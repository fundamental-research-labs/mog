use serde::{Deserialize, Serialize};

use domain_types::{FormulaCacheState, ParseOutput};

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ExportDiagnostic>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportDiagnosticCode {
    CalcIdCanonicalized,
    FormulaRecalcIntentPreserved,
    ConsumerRecalcRequired,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportSemanticImpact {
    None,
    RequiresConsumerRecalc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDiagnostic {
    pub code: ExportDiagnosticCode,
    pub artifact: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell: Option<String>,
    pub semantic_impact: ExportSemanticImpact,
    pub message: String,
}

pub(super) fn build_export_report(output: &ParseOutput) -> ExportReport {
    let mut diagnostics = Vec::new();

    let calc_decision = crate::domain::workbook::write::calc_settings_for_export(
        &output.calculation,
        Some(&output.calc_id_provenance),
        requires_consumer_recalc(output),
    );
    if output.calculation.calc_id.is_some()
        && calc_decision.calc_id_disposition
            == crate::domain::workbook::write::CalcIdExportDisposition::CanonicalizedMog
    {
        diagnostics.push(ExportDiagnostic {
            code: ExportDiagnosticCode::CalcIdCanonicalized,
            artifact: "calcPr.calcId".to_string(),
            part: Some("xl/workbook.xml".to_string()),
            cell: None,
            semantic_impact: ExportSemanticImpact::RequiresConsumerRecalc,
            message: "Imported calcId was not proven current and was canonicalized.".to_string(),
        });
    }

    let mut requires_consumer_recalc = false;
    for (sheet_idx, sheet) in output.sheets.iter().enumerate() {
        for cell in &sheet.cells {
            let provenance = &cell.formula_cache_provenance;
            if provenance.state.is_current() && provenance.force_recalc {
                diagnostics.push(ExportDiagnostic {
                    code: ExportDiagnosticCode::FormulaRecalcIntentPreserved,
                    artifact: "formula.ca".to_string(),
                    part: Some(format!("xl/worksheets/sheet{}.xml", sheet_idx + 1)),
                    cell: Some(a1_ref(cell.row, cell.col)),
                    semantic_impact: ExportSemanticImpact::RequiresConsumerRecalc,
                    message: "Current formula recalc intent was preserved.".to_string(),
                });
            } else if matches!(provenance.state, FormulaCacheState::StaleImported) {
                requires_consumer_recalc = true;
            }
        }
    }

    if requires_consumer_recalc {
        diagnostics.push(ExportDiagnostic {
            code: ExportDiagnosticCode::ConsumerRecalcRequired,
            artifact: "workbookCalculation".to_string(),
            part: Some("xl/workbook.xml".to_string()),
            cell: None,
            semantic_impact: ExportSemanticImpact::RequiresConsumerRecalc,
            message: "Exported calculation metadata requires consumer recalculation.".to_string(),
        });
    }

    ExportReport { diagnostics }
}

pub(super) fn requires_consumer_recalc(output: &ParseOutput) -> bool {
    output.sheets.iter().any(|sheet| {
        sheet.cells.iter().any(|cell| {
            let provenance = &cell.formula_cache_provenance;
            matches!(provenance.state, FormulaCacheState::StaleImported)
        })
    })
}

fn a1_ref(row: u32, col: u32) -> String {
    format!("{}{}", crate::write::sheet::col_to_letter(col), row + 1)
}
