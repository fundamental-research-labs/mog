use serde::{Deserialize, Serialize};

use domain_types::{ChartDefinition, ChartSpec, FormulaCacheState, ParseOutput};

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
    ChartSpaceReplaySuppressed,
    ChartAuxiliaryReplaySuppressed,
    ChartAuxiliaryPartDropped,
    ChartExternalDataRelationshipDropped,
    ChartUserShapesRelationshipDropped,
    ChartRelationshipRawXmlDropped,
    ChartSourceCacheOmitted,
    ChartExOpaqueReplaySuppressed,
    ChartExRawAnchorReplaySuppressed,
    ChartPrintSettingsDropped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExportSemanticImpact {
    None,
    RequiresConsumerRecalc,
    PackagePreservationDropped,
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

    append_chart_export_diagnostics(output, &mut diagnostics);

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

fn append_chart_export_diagnostics(output: &ParseOutput, diagnostics: &mut Vec<ExportDiagnostic>) {
    let mut standard_chart_idx = 0usize;
    let mut chart_ex_idx = 0usize;

    for sheet in &output.sheets {
        for chart in &sheet.charts {
            if chart.is_chart_ex || !matches!(chart.definition, Some(ChartDefinition::Chart(_))) {
                continue;
            }

            let original_idx =
                super::chart_replay::standard_chart_original_number_with_current_auxiliary_replay(
                    chart,
                );
            let idx = match original_idx {
                Some(original) => {
                    standard_chart_idx = standard_chart_idx.max(original);
                    original
                }
                None => {
                    standard_chart_idx += 1;
                    standard_chart_idx
                }
            };
            let chart_path = format!("xl/charts/chart{idx}.xml");
            append_standard_chart_export_diagnostics(chart, &chart_path, diagnostics);
        }

        for chart in &sheet.charts {
            if !chart.is_chart_ex || !matches!(chart.definition, Some(ChartDefinition::ChartEx(_)))
            {
                continue;
            }

            let original_idx =
                super::chart_replay::chart_ex_original_number_with_current_replay(chart);
            let idx = match original_idx {
                Some(original) => {
                    chart_ex_idx = chart_ex_idx.max(original);
                    original
                }
                None => {
                    chart_ex_idx += 1;
                    chart_ex_idx
                }
            };
            let chart_path = format!("xl/charts/chartEx{idx}.xml");
            append_chart_ex_export_diagnostics(chart, &chart_path, diagnostics);
        }
    }
}

fn append_standard_chart_export_diagnostics(
    chart: &ChartSpec,
    chart_path: &str,
    diagnostics: &mut Vec<ExportDiagnostic>,
) {
    let export_plan = super::chart_replay::standard_chart_export_plan(chart);
    if (chart.standard_chart_provenance.is_some()
        || chart.standard_chart_export_authority.is_some())
        && matches!(
            export_plan,
            super::chart_replay::StandardChartExportPlan::ReconstructFromModel
        )
    {
        let reason = chart
            .standard_chart_export_authority
            .as_ref()
            .and_then(|authority| authority.stale_reason.as_deref())
            .unwrap_or("standard chart-space authority is not current");
        push_chart_diagnostic(
            diagnostics,
            ExportDiagnosticCode::ChartSpaceReplaySuppressed,
            "chartSpace",
            Some(chart_path),
            ExportSemanticImpact::None,
            format!("Imported chart XML replay was suppressed: {reason}."),
        );
    }

    append_standard_chart_source_cache_diagnostics(chart, chart_path, diagnostics);
    if let Some(aux) = super::chart_auxiliary::chart_auxiliary_data(chart) {
        if !super::chart_replay::chart_allows_current_auxiliary_replay(chart, &aux.original_path) {
            push_chart_diagnostic(
                diagnostics,
                ExportDiagnosticCode::ChartAuxiliaryReplaySuppressed,
                "chartAuxiliary",
                Some(&aux.original_path),
                ExportSemanticImpact::PackagePreservationDropped,
                "Imported chart auxiliary package replay was suppressed because authority is not current."
                    .to_string(),
            );
        }

        let supported_paths =
            super::chart_auxiliary::supported_auxiliary_file_paths(&aux, &aux.original_path);
        for (path, _) in aux.auxiliary_files {
            let normalized = path.trim_start_matches('/');
            if !supported_paths.contains(normalized) {
                push_chart_diagnostic(
                    diagnostics,
                    ExportDiagnosticCode::ChartAuxiliaryPartDropped,
                    "chartAuxiliaryPart",
                    Some(normalized),
                    ExportSemanticImpact::PackagePreservationDropped,
                    format!(
                        "Imported chart auxiliary part `{normalized}` was not exported because no current supported chart relationship references it."
                    ),
                );
            }
        }
    }

    append_standard_chart_relationship_diagnostics(chart, chart_path, diagnostics);
    append_standard_chart_print_settings_diagnostics(chart, chart_path, diagnostics);
    append_standard_chart_raw_xml_drop_diagnostics(chart, chart_path, diagnostics);
}

fn append_standard_chart_source_cache_diagnostics(
    chart: &ChartSpec,
    chart_path: &str,
    diagnostics: &mut Vec<ExportDiagnostic>,
) {
    if !matches!(
        super::chart_replay::standard_chart_export_plan(chart),
        super::chart_replay::StandardChartExportPlan::ReconstructFromModel
    ) {
        return;
    }

    let omitted_dimensions: Vec<String> = chart
        .series
        .iter()
        .enumerate()
        .flat_map(|(series_idx, series)| {
            let series_number = series_idx + 1;
            [
                source_cache_omitted(
                    series.values.as_deref(),
                    series.value_cache.as_ref(),
                    series.value_source_kind,
                )
                .then(|| format!("series {series_number} values")),
                source_cache_omitted(
                    series.categories.as_deref(),
                    series.category_cache.as_ref(),
                    series.category_source_kind,
                )
                .then(|| format!("series {series_number} categories")),
                source_levels_cache_omitted(
                    series.categories.as_deref(),
                    series.category_levels.as_ref(),
                    series.category_source_kind,
                )
                .then(|| format!("series {series_number} categoryLevels")),
                source_cache_omitted(
                    series.bubble_size.as_deref(),
                    series.bubble_size_cache.as_ref(),
                    series.bubble_size_source_kind,
                )
                .then(|| format!("series {series_number} bubbleSize")),
            ]
            .into_iter()
            .flatten()
        })
        .collect();

    if omitted_dimensions.is_empty() {
        return;
    }

    push_chart_diagnostic(
        diagnostics,
        ExportDiagnosticCode::ChartSourceCacheOmitted,
        "chartSourceCache",
        Some(chart_path),
        ExportSemanticImpact::None,
        format!(
            "Modeled chart export did not preserve imported source caches for reconstructed live references: {}.",
            omitted_dimensions.join(", ")
        ),
    );
}

fn source_cache_omitted(
    formula: Option<&str>,
    cache: Option<&domain_types::chart::ChartSeriesPointCacheData>,
    source_kind: Option<domain_types::chart::ChartSeriesDimensionSourceKindData>,
) -> bool {
    formula.is_some_and(|formula| !formula.trim().is_empty())
        && point_cache_has_payload(cache)
        && !matches!(
            source_kind,
            Some(domain_types::chart::ChartSeriesDimensionSourceKindData::CacheFallback)
                | Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Literal)
        )
}

fn source_levels_cache_omitted(
    formula: Option<&str>,
    cache: Option<&domain_types::chart::ChartSeriesCategoryLevelsCacheData>,
    source_kind: Option<domain_types::chart::ChartSeriesDimensionSourceKindData>,
) -> bool {
    formula.is_some_and(|formula| !formula.trim().is_empty())
        && category_levels_cache_has_payload(cache)
        && !matches!(
            source_kind,
            Some(domain_types::chart::ChartSeriesDimensionSourceKindData::CacheFallback)
                | Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Literal)
        )
}

fn point_cache_has_payload(cache: Option<&domain_types::chart::ChartSeriesPointCacheData>) -> bool {
    cache.is_some_and(|cache| {
        cache.point_count.is_some() || cache.format_code.is_some() || !cache.points.is_empty()
    })
}

fn category_levels_cache_has_payload(
    cache: Option<&domain_types::chart::ChartSeriesCategoryLevelsCacheData>,
) -> bool {
    cache.is_some_and(|cache| {
        cache.point_count.is_some()
            || cache
                .levels
                .iter()
                .any(|level| level.point_count.is_some() || !level.points.is_empty())
    })
}

fn append_standard_chart_relationship_diagnostics(
    chart: &ChartSpec,
    chart_path: &str,
    diagnostics: &mut Vec<ExportDiagnostic>,
) {
    let Some(ChartDefinition::Chart(chart_space)) = chart.definition.as_ref() else {
        return;
    };

    if let Some(external_data) = chart_space.external_data.as_ref() {
        let relationship = chart
            .chart_relationships
            .iter()
            .find(|rel| rel.r_id == external_data.r_id);
        if !relationship
            .is_some_and(super::chart_auxiliary::chart_external_data_relationship_is_supported)
        {
            push_chart_diagnostic(
                diagnostics,
                ExportDiagnosticCode::ChartExternalDataRelationshipDropped,
                "chartExternalData",
                Some(chart_path),
                ExportSemanticImpact::PackagePreservationDropped,
                format!(
                    "Imported chart externalData relationship `{}` was not exported because the relationship target policy is unsupported or missing.",
                    external_data.r_id
                ),
            );
        }
    }

    if let Some(r_id) = chart_space.user_shapes.as_deref()
        && super::chart_auxiliary::chart_user_shapes_data(chart, chart_path).is_none()
    {
        push_chart_diagnostic(
            diagnostics,
            ExportDiagnosticCode::ChartUserShapesRelationshipDropped,
            "chartUserShapes",
            Some(chart_path),
            ExportSemanticImpact::PackagePreservationDropped,
            format!(
                "Imported chart userShapes relationship `{r_id}` was not exported because the target part is unsupported or missing."
            ),
        );
    }
}

fn append_standard_chart_print_settings_diagnostics(
    chart: &ChartSpec,
    chart_path: &str,
    diagnostics: &mut Vec<ExportDiagnostic>,
) {
    let Some(ChartDefinition::Chart(chart_space)) = chart.definition.as_ref() else {
        return;
    };
    let Some(print_settings) = chart_space.print_settings.as_ref() else {
        return;
    };
    let Some(r_id) = print_settings.legacy_drawing_hf.as_deref() else {
        return;
    };

    if super::chart_replay::should_reconstruct_chart_space(chart) {
        push_chart_diagnostic(
            diagnostics,
            ExportDiagnosticCode::ChartPrintSettingsDropped,
            "chartPrintSettings",
            Some(chart_path),
            ExportSemanticImpact::PackagePreservationDropped,
            format!(
                "Imported chart printSettings legacyDrawingHF relationship `{r_id}` was not exported because chart print VML relationships are not modeled."
            ),
        );
    }
}

fn append_standard_chart_raw_xml_drop_diagnostics(
    chart: &ChartSpec,
    chart_path: &str,
    diagnostics: &mut Vec<ExportDiagnostic>,
) {
    let Some(ChartDefinition::Chart(chart_space)) = chart.definition.as_ref() else {
        return;
    };

    if chart_space
        .extensions
        .iter()
        .chain(chart_space.chart.extensions.iter())
        .chain(chart_space.chart.plot_area.extensions.iter())
        .any(|extension| crate::infra::xml::raw_xml_contains_relationship_attr(&extension.xml))
    {
        push_chart_diagnostic(
            diagnostics,
            ExportDiagnosticCode::ChartRelationshipRawXmlDropped,
            "chartRawExtension",
            Some(chart_path),
            ExportSemanticImpact::PackagePreservationDropped,
            "Imported chart raw extension XML containing relationship attributes was not exported."
                .to_string(),
        );
    }
}

fn append_chart_ex_export_diagnostics(
    chart: &ChartSpec,
    chart_path: &str,
    diagnostics: &mut Vec<ExportDiagnostic>,
) {
    if let Some(replay) = chart.chart_ex_replay.as_ref() {
        let original_path = replay.original_path.trim_start_matches('/');
        if !super::chart_replay::chart_ex_allows_opaque_replay(chart, original_path) {
            push_chart_diagnostic(
                diagnostics,
                ExportDiagnosticCode::ChartExOpaqueReplaySuppressed,
                "chartExSpace",
                Some(original_path),
                ExportSemanticImpact::PackagePreservationDropped,
                "Imported ChartEx opaque XML replay was suppressed because authority is not current."
                    .to_string(),
            );
        }

        if let Some(frame) = chart.chart_frame.as_ref()
            && frame.raw_alternate_content.is_some()
        {
            let relationship_id = frame.relationship_id.as_deref().unwrap_or_default();
            if !super::chart_replay::chart_ex_allows_raw_anchor_replay(
                chart,
                chart_path,
                relationship_id,
            ) {
                push_chart_diagnostic(
                    diagnostics,
                    ExportDiagnosticCode::ChartExRawAnchorReplaySuppressed,
                    "chartExAnchor",
                    Some(chart_path),
                    ExportSemanticImpact::PackagePreservationDropped,
                    "Imported ChartEx raw drawing anchor replay was suppressed because frame authority is not current."
                        .to_string(),
                );
            }
        }
    }

    let Some(ChartDefinition::ChartEx(chart_ex_space)) = chart.definition.as_ref() else {
        return;
    };
    if !super::chart_replay::chart_ex_allows_opaque_replay(chart, chart_path)
        && chart_ex_space
            .print_settings
            .as_ref()
            .and_then(|print_settings| print_settings.raw_xml.as_deref())
            .is_some_and(crate::infra::xml::raw_xml_contains_relationship_attr)
    {
        push_chart_diagnostic(
            diagnostics,
            ExportDiagnosticCode::ChartPrintSettingsDropped,
            "chartPrintSettings",
            Some(chart_path),
            ExportSemanticImpact::PackagePreservationDropped,
            "Imported ChartEx printSettings XML was not exported because it contains unresolved relationship attributes."
                .to_string(),
        );
    }
}

fn push_chart_diagnostic(
    diagnostics: &mut Vec<ExportDiagnostic>,
    code: ExportDiagnosticCode,
    artifact: &str,
    part: Option<&str>,
    semantic_impact: ExportSemanticImpact,
    message: String,
) {
    diagnostics.push(ExportDiagnostic {
        code,
        artifact: artifact.to_string(),
        part: part.map(ToString::to_string),
        cell: None,
        semantic_impact,
        message,
    });
}
