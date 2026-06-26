use super::chart_ex_projection::project_chart_ex_space;
use super::*;

mod chart_frames;
mod chart_specs;
pub(crate) use chart_frames::chart_frames_by_relationship_target;
use chart_frames::{
    apply_chart_frame_to_spec, build_chart_ref_info_from_frame, build_chart_ref_info_from_spec,
    chart_drawing_frames,
};
#[cfg(test)]
pub(crate) use chart_frames::{chart_ex_anchor_position, chart_ref_extent_from_spec};
pub(crate) use chart_specs::build_fallback_chart_spec;

// =============================================================================
// Domain conversions: Charts and Pivots
// =============================================================================
/// Build `ChartSpec` list from `parsed_charts` using lossless `ChartSpace` serialization.
///
/// The parser produces two chart representations per sheet:
/// - `charts`: `Vec<ChartSpec>` with custom JSON definition (lossy — loses ChartSpace structure)
/// - `parsed_charts`: `Vec<Chart>` with `chart_space: Option<ChartSpace>` (lossless)
///
/// For round-trip fidelity, we use `parsed_charts` and serialize the canonical `ChartSpace`
/// to JSON. Position/size data comes from the lossy `charts` field (which extracts it from
/// the drawing anchors during parsing).
pub(crate) fn convert_parsed_charts_to_chart_specs(sheet: &FullParsedSheet) -> Vec<ChartSpec> {
    use crate::domain::charts::read::extract_chart_spec_from_chart_space;

    let chart_frames = chart_drawing_frames(sheet, false);
    let chart_frames_by_target = chart_frames_by_relationship_target(&chart_frames);

    sheet
        .parsed_charts
        .iter()
        .enumerate()
        .map(|(idx, chart)| {
            let chart_space = match &chart.chart_space {
                Some(cs) => cs,
                None => {
                    // No ChartSpace — build minimal spec from flat fields
                    // (fallback, shouldn't normally happen)
                    return build_fallback_chart_spec(chart, idx, sheet);
                }
            };

            let matched_frame = chart
                .original_path
                .as_deref()
                .and_then(|path| chart_frames_by_target.get(path).copied());

            // Build ChartRefInfo from the identity-matched drawing frame when
            // available. Falling back to index preserves legacy behavior for
            // generated or malformed workbooks that lack relationship metadata.
            let old_spec = sheet.charts.get(idx);
            let ref_info = if let Some((position, frame)) = matched_frame {
                build_chart_ref_info_from_frame(position, frame)
            } else {
                build_chart_ref_info_from_spec(old_spec, chart)
            };

            // Extract complete ChartSpec from ChartSpace + anchor info
            let mut spec = extract_chart_spec_from_chart_space(chart_space, &ref_info);
            spec.display_blanks_as = chart
                .display_options
                .disp_blanks_as
                .map(|value| value.to_ooxml().to_string());
            if let Some((position, frame)) = matched_frame.or_else(|| chart_frames.get(idx)) {
                spec.position = position.clone();
                apply_chart_frame_to_spec(&mut spec, frame);
            }

            // Also store the ChartSpace blob in definition for backward compatibility
            // during the transition. This can be removed once all consumers use typed fields.
            spec.definition = Some(ChartDefinition::Chart(chart_space.clone()));
            normalize_local_chart_source_references(&mut spec, &sheet.name);
            spec.chart_auxiliary_files = chart.auxiliary_files.clone();
            spec.chart_relationships = chart
                .chart_rels_bytes
                .as_ref()
                .map(|(_, rels_xml)| chart_owned_relationships(rels_xml))
                .unwrap_or_default();
            spec.chart_auxiliary_parts =
                chart_auxiliary_parts(&spec.chart_relationships, &spec.chart_auxiliary_files);
            apply_chart_color_style_projection(&mut spec);
            let projection_fingerprint = standard_chart_projection_fingerprint(&spec);
            let relationship_closure = standard_chart_relationship_closure(
                chart.original_path.as_deref(),
                chart_space,
                &spec.chart_relationships,
                &spec.chart_auxiliary_files,
                spec.title.as_deref(),
            );
            if !relationship_closure.diagnostics.is_empty() {
                append_chart_import_status_diagnostics(
                    &mut spec.import_status,
                    relationship_closure.diagnostics.clone(),
                );
            }
            append_chart_import_status_diagnostics(
                &mut spec.import_status,
                standard_chart_pivot_format_diagnostics(
                    chart_space,
                    chart.original_path.as_deref(),
                    spec.title.as_deref(),
                ),
            );
            let relationship_closure_current = relationship_closure.current;
            let source_replay_readiness =
                standard_chart_source_replay_readiness(chart_space, &spec);
            let chart_export_authority_current =
                relationship_closure_current && source_replay_readiness.current;
            spec.standard_chart_provenance = Some(domain_types::chart::StandardChartProvenance {
                original_path: chart.original_path.clone(),
                rels_path: chart
                    .chart_rels_bytes
                    .as_ref()
                    .map(|(path, _)| path.clone()),
                projection_schema_version: STANDARD_CHART_PROJECTION_SCHEMA_VERSION,
                projection_fingerprint: Some(projection_fingerprint.clone()),
                relationships: spec.chart_relationships.clone(),
                auxiliary_paths: spec
                    .chart_auxiliary_files
                    .iter()
                    .map(|(path, _)| path.clone())
                    .collect(),
            });
            spec.standard_chart_export_authority =
                Some(domain_types::chart::StandardChartExportAuthority {
                    schema_version: STANDARD_CHART_PROJECTION_SCHEMA_VERSION,
                    validity: if chart_export_authority_current {
                        domain_types::chart::StandardChartAuthorityValidity::Current
                    } else {
                        domain_types::chart::StandardChartAuthorityValidity::Unsafe
                    },
                    chart_part_revision: 0,
                    package_owner: chart.original_path.clone(),
                    relationship_closure_current,
                    projection_fingerprint: Some(projection_fingerprint),
                    invalidated_owner_ids: Vec::new(),
                    stale_reason: (!chart_export_authority_current).then(|| {
                        if !relationship_closure_current {
                            relationship_closure
                                .diagnostics
                                .first()
                                .and_then(|diagnostic| diagnostic.message.clone())
                                .unwrap_or_else(|| {
                                    "chart relationship graph is not closed".to_string()
                                })
                        } else {
                            source_replay_readiness.reason.unwrap_or_else(|| {
                                "chart source references are not safe to replay".to_string()
                            })
                        }
                    }),
                });

            spec
        })
        .collect()
}

const REL_CHART_STYLE: &str = "http://schemas.microsoft.com/office/2011/relationships/chartStyle";
const REL_CHART_COLOR_STYLE: &str =
    "http://schemas.microsoft.com/office/2011/relationships/chartColorStyle";
const REL_CHART_USER_SHAPES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartUserShapes";

#[derive(Debug, Clone)]
struct ChartRelationshipClosure {
    current: bool,
    diagnostics: Vec<domain_types::ImportDiagnosticRef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ChartSourceReplayReadiness {
    current: bool,
    reason: Option<String>,
}

fn standard_chart_source_replay_readiness(
    chart_space: &ooxml_types::charts::ChartSpace,
    spec: &ChartSpec,
) -> ChartSourceReplayReadiness {
    if !standard_chart_has_live_source_refs(spec) {
        return ChartSourceReplayReadiness {
            current: true,
            reason: None,
        };
    }

    let chart_xml = crate::domain::charts::write_canonical::serialize_chart_space(chart_space);
    let chart_xml = String::from_utf8_lossy(&chart_xml);
    chart_xml_source_replay_readiness(&chart_xml)
}

fn chart_xml_source_replay_readiness(chart_xml: &str) -> ChartSourceReplayReadiness {
    let formulas = chart_formula_refs(chart_xml);
    if formulas.is_empty() {
        return ChartSourceReplayReadiness {
            current: false,
            reason: Some(
                "chart XML has live source references but no chart source formulas".to_string(),
            ),
        };
    }

    let unqualified_local_refs = formulas
        .iter()
        .filter(|formula| is_unqualified_local_a1_reference(formula))
        .map(|formula| formula.trim().to_string())
        .collect::<Vec<_>>();
    if !unqualified_local_refs.is_empty() {
        return ChartSourceReplayReadiness {
            current: false,
            reason: Some(format!(
                "chart XML has unqualified local source references: {}",
                unqualified_local_refs.join(", ")
            )),
        };
    }

    ChartSourceReplayReadiness {
        current: true,
        reason: None,
    }
}

fn standard_chart_has_live_source_refs(spec: &ChartSpec) -> bool {
    spec.data_range
        .as_deref()
        .is_some_and(|range| !range.trim().is_empty())
        || spec.series.iter().any(series_has_live_source_refs)
}

fn series_has_live_source_refs(series: &domain_types::chart::ChartSeriesData) -> bool {
    live_source_ref(series.values.as_deref(), series.value_source_kind)
        || live_source_ref(series.categories.as_deref(), series.category_source_kind)
        || live_source_ref(
            series.bubble_size.as_deref(),
            series.bubble_size_source_kind,
        )
}

fn live_source_ref(
    formula: Option<&str>,
    source_kind: Option<domain_types::chart::ChartSeriesDimensionSourceKindData>,
) -> bool {
    formula.is_some_and(|formula| !formula.trim().is_empty())
        && matches!(
            source_kind,
            None | Some(domain_types::chart::ChartSeriesDimensionSourceKindData::Ref)
        )
}

fn chart_formula_refs(chart_xml: &str) -> Vec<&str> {
    let mut refs = Vec::new();
    let mut rest = chart_xml;
    while let Some(start) = rest.find("<c:f>") {
        let value_start = start + "<c:f>".len();
        let Some(end) = rest[value_start..].find("</c:f>") else {
            break;
        };
        refs.push(&rest[value_start..value_start + end]);
        rest = &rest[value_start + end + "</c:f>".len()..];
    }
    refs
}

fn is_unqualified_local_a1_reference(formula: &str) -> bool {
    let trimmed = formula.trim().trim_start_matches('=').trim();
    if trimmed.is_empty() || compute_parser::split_sheet_prefix(trimmed).0.is_some() {
        return false;
    }
    compute_parser::parse_a1_range(trimmed)
        .is_some_and(|range| range.range_type == formula_types::RangeType::CellRange)
}

fn standard_chart_relationship_closure(
    chart_path: Option<&str>,
    chart_space: &ooxml_types::charts::ChartSpace,
    relationships: &[domain_types::chart::ChartRelationshipData],
    auxiliary_files: &[(String, Vec<u8>)],
    object_name: Option<&str>,
) -> ChartRelationshipClosure {
    let external_data_r_id = chart_space
        .external_data
        .as_ref()
        .map(|external_data| external_data.r_id.as_str());
    let user_shapes_r_id = chart_space.user_shapes.as_deref();
    let mut diagnostics = Vec::new();

    if let Some(r_id) = external_data_r_id
        && !relationships.iter().any(|rel| rel.r_id == r_id)
    {
        diagnostics.push(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::MissingRelationshipTarget,
            format!("Chart externalData references missing relationship `{r_id}`"),
            chart_path,
            object_name,
            Some(r_id),
        ));
    }
    if let Some(r_id) = user_shapes_r_id
        && !relationships.iter().any(|rel| rel.r_id == r_id)
    {
        diagnostics.push(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::MissingRelationshipTarget,
            format!("Chart userShapes references missing relationship `{r_id}`"),
            chart_path,
            object_name,
            Some(r_id),
        ));
    }

    for rel in relationships {
        if let Some(diagnostic) = validate_standard_chart_relationship(
            rel,
            chart_path,
            external_data_r_id,
            user_shapes_r_id,
            auxiliary_files,
            object_name,
        ) {
            diagnostics.push(diagnostic);
        }
    }

    ChartRelationshipClosure {
        current: diagnostics.is_empty(),
        diagnostics,
    }
}

fn validate_standard_chart_relationship(
    rel: &domain_types::chart::ChartRelationshipData,
    chart_path: Option<&str>,
    external_data_r_id: Option<&str>,
    user_shapes_r_id: Option<&str>,
    auxiliary_files: &[(String, Vec<u8>)],
    object_name: Option<&str>,
) -> Option<domain_types::ImportDiagnosticRef> {
    let r_id = rel.r_id.as_str();
    let Some(rel_type) = rel.relationship_type.as_deref() else {
        return Some(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::InvalidRelationship,
            format!("Chart relationship `{r_id}` is missing a relationship type"),
            chart_path,
            object_name,
            Some(r_id),
        ));
    };
    let Some(target) = rel.target.as_deref() else {
        return Some(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::MissingRelationshipTarget,
            format!("Chart relationship `{r_id}` is missing a target"),
            chart_path,
            object_name,
            Some(r_id),
        ));
    };

    if crate::write::package_graph::is_external_target_mode(rel.target_mode.as_deref()) {
        if external_data_r_id == Some(r_id)
            && rel_type == crate::infra::opc::REL_EXTERNAL_LINK
            && !target.trim().is_empty()
        {
            return None;
        }
        return Some(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::ExternalReference,
            format!(
                "Chart relationship `{r_id}` uses unsupported external target mode for `{rel_type}`"
            ),
            chart_path,
            object_name,
            Some(r_id),
        ));
    }

    let Some(chart_path) = chart_path else {
        return Some(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::MalformedRelationshipTarget,
            format!("Chart relationship `{r_id}` cannot be resolved without a chart part path"),
            None,
            object_name,
            Some(r_id),
        ));
    };
    let Some(target_path) =
        crate::infra::opc::resolve_relationship_target(Some(chart_path), target)
            .ok()
            .map(|path| path.trim_start_matches('/').to_string())
    else {
        return Some(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::MalformedRelationshipTarget,
            format!("Chart relationship `{r_id}` has malformed target `{target}`"),
            Some(chart_path),
            object_name,
            Some(r_id),
        ));
    };

    if supported_chart_auxiliary_relationship(rel_type, &target_path) {
        if rel_type == REL_CHART_USER_SHAPES && user_shapes_r_id != Some(r_id) {
            return Some(chart_relationship_diagnostic(
                domain_types::ImportDiagnosticCode::InvalidRelationship,
                format!("Chart userShapes relationship `{r_id}` is not referenced by c:userShapes"),
                Some(chart_path),
                object_name,
                Some(r_id),
            ));
        }
        if auxiliary_files
            .iter()
            .any(|(path, _)| path.trim_start_matches('/') == target_path)
        {
            return None;
        }
        return Some(chart_relationship_diagnostic(
            domain_types::ImportDiagnosticCode::MissingRelationshipTarget,
            format!("Chart relationship `{r_id}` targets missing part `{target_path}`"),
            Some(chart_path),
            object_name,
            Some(r_id),
        ));
    }

    Some(chart_relationship_diagnostic(
        domain_types::ImportDiagnosticCode::UnsupportedFeature,
        format!("Chart relationship `{r_id}` has unsupported type `{rel_type}`"),
        Some(chart_path),
        object_name,
        Some(r_id),
    ))
}

fn standard_chart_pivot_format_diagnostics(
    chart_space: &ooxml_types::charts::ChartSpace,
    chart_path: Option<&str>,
    object_name: Option<&str>,
) -> Vec<domain_types::ImportDiagnosticRef> {
    let count = chart_space
        .chart
        .pivot_fmts
        .iter()
        .filter(|format| {
            format.sp_pr.is_some()
                || format.tx_pr.is_some()
                || format.marker.is_some()
                || format.d_lbl.is_some()
                || !format.extensions.is_empty()
        })
        .count();
    if count == 0 {
        return Vec::new();
    }

    vec![chart_relationship_diagnostic(
        domain_types::ImportDiagnosticCode::UnsupportedFeature,
        format!(
            "Pivot chart formatting (c:pivotFmts, {count} entries) is preserved for export but not rendered; semantic style resolution is owned by the chart style plan"
        ),
        chart_path,
        object_name,
        Some("pivotFmts"),
    )]
}

fn chart_relationship_diagnostic(
    code: domain_types::ImportDiagnosticCode,
    message: String,
    part_path: Option<&str>,
    object_name: Option<&str>,
    object_id: Option<&str>,
) -> domain_types::ImportDiagnosticRef {
    crate::domain::charts::chart_import_status_with_diagnostic(
        crate::domain::charts::ChartImportDiagnosticInput {
            code,
            message,
            recoverability: domain_types::ImportRecoverability::PartiallySupported,
            renderability: domain_types::ImportRenderability::Renderable,
            editability: domain_types::ImportEditability::PartiallyEditable,
            part_path,
            object_name,
            object_id,
        },
    )
    .reference
    .expect("chart import diagnostic helper always sets reference")
}

fn append_chart_import_status_diagnostics(
    status: &mut Option<domain_types::ImportObjectStatus>,
    mut diagnostics: Vec<domain_types::ImportDiagnosticRef>,
) {
    if diagnostics.is_empty() {
        return;
    }
    if let Some(status) = status {
        if status.reference.is_none() {
            status.reference = diagnostics.first().cloned();
        }
        status.diagnostics.append(&mut diagnostics);
        return;
    }

    *status = Some(domain_types::ImportObjectStatus {
        source: domain_types::ImportSource::Xlsx,
        feature_kind: domain_types::ImportFeatureKind::Chart,
        recoverability: domain_types::ImportRecoverability::PartiallySupported,
        renderability: domain_types::ImportRenderability::Renderable,
        editability: domain_types::ImportEditability::PartiallyEditable,
        reference: diagnostics.first().cloned(),
        diagnostics,
    });
}

fn supported_chart_auxiliary_relationship(rel_type: &str, target_path: &str) -> bool {
    let file_name = target_path.rsplit('/').next().unwrap_or(target_path);
    if target_path.starts_with("xl/charts/")
        && file_name.starts_with("style")
        && file_name.ends_with(".xml")
    {
        rel_type == REL_CHART_STYLE
    } else if target_path.starts_with("xl/charts/")
        && (file_name.starts_with("color") || file_name.starts_with("colors"))
        && file_name.ends_with(".xml")
    {
        rel_type == REL_CHART_COLOR_STYLE
    } else if target_path.starts_with("xl/drawings/") && file_name.ends_with(".xml") {
        rel_type == REL_CHART_USER_SHAPES
    } else {
        false
    }
}

const STANDARD_CHART_PROJECTION_SCHEMA_VERSION: u32 = 6;

fn normalize_local_chart_source_references(spec: &mut ChartSpec, sheet_name: &str) {
    strip_local_sheet_prefix(&mut spec.data_range, sheet_name);
    strip_local_sheet_prefix(&mut spec.series_range, sheet_name);
    strip_local_sheet_prefix(&mut spec.category_range, sheet_name);
    for series in &mut spec.series {
        strip_local_sheet_prefix(&mut series.name_ref, sheet_name);
        strip_local_sheet_prefix(&mut series.categories, sheet_name);
        strip_local_sheet_prefix(&mut series.values, sheet_name);
        strip_local_sheet_prefix(&mut series.bubble_size, sheet_name);
    }
}

fn strip_local_sheet_prefix(reference: &mut Option<String>, sheet_name: &str) {
    let Some(value) = reference.as_deref() else {
        return;
    };
    let Some((sheet, body)) = split_sheet_reference(value.trim()) else {
        return;
    };
    if sheet == sheet_name {
        *reference = Some(body.to_string());
    }
}

fn split_sheet_reference(value: &str) -> Option<(String, &str)> {
    if value.starts_with('=') {
        return None;
    }
    if let Some(rest) = value.strip_prefix('\'') {
        let mut sheet = String::new();
        let mut chars = rest.char_indices().peekable();
        while let Some((idx, ch)) = chars.next() {
            if ch == '\'' {
                if matches!(chars.peek(), Some((_, '\''))) {
                    sheet.push('\'');
                    chars.next();
                    continue;
                }
                let body = rest.get(idx + 1..)?.strip_prefix('!')?;
                return Some((sheet, body));
            }
            sheet.push(ch);
        }
        return None;
    }
    let (sheet, body) = value.rsplit_once('!')?;
    (!sheet.is_empty() && !body.is_empty()).then(|| (sheet.to_string(), body))
}

fn standard_chart_projection_fingerprint(spec: &ChartSpec) -> String {
    let mut fingerprint = Fnv1a64::default();
    fingerprint.write_str(spec.chart_type.as_str());
    fingerprint.write_json(&spec.title);
    fingerprint.write_json(&spec.series);
    fingerprint.write_json(&spec.sub_type);
    fingerprint.write_json(&spec.legend);
    fingerprint.write_json(&spec.axes);
    fingerprint.write_json(&spec.data_labels);
    fingerprint.write_json(&spec.data_range);
    fingerprint.write_json(&spec.series_range);
    fingerprint.write_json(&spec.category_range);
    fingerprint.write_json(&spec.colors);
    fingerprint.write_json(&spec.style);
    fingerprint.write_json(&spec.rounded_corners);
    fingerprint.write_json(&spec.auto_title_deleted);
    fingerprint.write_json(&spec.show_data_labels_over_max);
    fingerprint.write_json(&spec.chart_format);
    fingerprint.write_json(&spec.plot_format);
    fingerprint.write_json(&spec.title_format);
    fingerprint.write_json(&spec.title_rich_text);
    fingerprint.write_json(&spec.title_formula);
    fingerprint.write_json(&spec.plot_layout);
    fingerprint.write_json(&spec.title_layout);
    fingerprint.write_json(&spec.data_table);
    fingerprint.write_json(&spec.drop_lines);
    fingerprint.write_json(&spec.high_low_lines);
    fingerprint.write_json(&spec.series_lines);
    fingerprint.write_json(&spec.up_down_bars);
    fingerprint.write_json(&spec.waterfall);
    fingerprint.write_json(&spec.histogram);
    fingerprint.write_json(&spec.boxplot);
    fingerprint.write_json(&spec.hierarchy);
    fingerprint.write_json(&spec.region_map);
    fingerprint.write_json(&spec.display_blanks_as);
    fingerprint.write_json(&spec.plot_visible_only);
    fingerprint.write_json(&spec.gap_width);
    fingerprint.write_json(&spec.gap_depth);
    fingerprint.write_json(&spec.overlap);
    fingerprint.write_json(&spec.doughnut_hole_size);
    fingerprint.write_json(&spec.first_slice_angle);
    fingerprint.write_json(&spec.bubble_scale);
    fingerprint.write_json(&spec.show_neg_bubbles);
    fingerprint.write_json(&spec.size_represents);
    fingerprint.write_json(&spec.split_type);
    fingerprint.write_json(&spec.split_value);
    fingerprint.write_json(&spec.category_label_level);
    fingerprint.write_json(&spec.series_name_level);
    fingerprint.write_json(&spec.show_all_field_buttons);
    fingerprint.write_json(&spec.second_plot_size);
    fingerprint.write_json(&spec.vary_by_categories);
    fingerprint.write_json(&spec.title_h_align);
    fingerprint.write_json(&spec.title_v_align);
    fingerprint.write_json(&spec.title_show_shadow);
    fingerprint.write_json(&spec.pivot_options);
    fingerprint.write_json(&spec.bar_shape);
    fingerprint.write_json(&spec.bubble_3d_effect);
    fingerprint.write_json(&spec.wireframe);
    fingerprint.write_json(&spec.surface_top_view);
    fingerprint.write_json(&spec.color_scheme);
    fingerprint.write_json(&spec.chart_style_context);
    fingerprint.write_json(&spec.view_3d);
    fingerprint.write_json(&spec.floor_format);
    fingerprint.write_json(&spec.side_wall_format);
    fingerprint.write_json(&spec.back_wall_format);
    format!("{:016x}", fingerprint.finish())
}

#[derive(Clone, Copy)]
struct Fnv1a64(u64);

impl Default for Fnv1a64 {
    fn default() -> Self {
        Self(0xcbf29ce484222325)
    }
}

impl Fnv1a64 {
    fn write_json<T: serde::Serialize>(&mut self, value: &T) {
        match serde_json::to_vec(value) {
            Ok(bytes) => self.write_bytes(&bytes),
            Err(_) => self.write_bytes(b"<serde-error>"),
        }
        self.write_bytes(&[0xff]);
    }

    fn write_str(&mut self, value: &str) {
        self.write_bytes(value.as_bytes());
        self.write_bytes(&[0xff]);
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }

    fn finish(self) -> u64 {
        self.0
    }
}

fn chart_owned_relationships(rels_xml: &[u8]) -> Vec<domain_types::chart::ChartRelationshipData> {
    crate::domain::workbook::read::parse_all_rels(rels_xml)
        .into_iter()
        .map(|rel| domain_types::chart::ChartRelationshipData {
            r_id: rel.id,
            relationship_type: Some(rel.rel_type),
            target: Some(rel.target),
            target_mode: rel.target_mode,
        })
        .collect()
}

fn chart_auxiliary_parts(
    relationships: &[domain_types::chart::ChartRelationshipData],
    files: &[(String, Vec<u8>)],
) -> Vec<domain_types::chart::ChartAuxiliaryPart> {
    relationships
        .iter()
        .filter_map(|rel| {
            let rel_type = rel.relationship_type.as_deref()?;
            let target = rel.target.as_deref()?;
            let file_name = target.rsplit('/').next().unwrap_or(target);
            let (_, bytes) = files
                .iter()
                .find(|(path, _)| path.rsplit('/').next().unwrap_or(path) == file_name)?;
            let xml = String::from_utf8(bytes.clone()).ok()?;
            let content = match rel_type {
                REL_CHART_STYLE => domain_types::chart::ChartAuxiliaryContent::Style { xml },
                REL_CHART_COLOR_STYLE => {
                    domain_types::chart::ChartAuxiliaryContent::ColorStyle { xml }
                }
                REL_CHART_USER_SHAPES => {
                    domain_types::chart::ChartAuxiliaryContent::UserShapes { xml }
                }
                _ => return None,
            };
            Some(domain_types::chart::ChartAuxiliaryPart {
                path: files
                    .iter()
                    .find(|(path, _)| path.rsplit('/').next().unwrap_or(path) == file_name)?
                    .0
                    .clone(),
                relationship: rel.clone(),
                content,
            })
        })
        .collect()
}

fn apply_chart_color_style_projection(spec: &mut ChartSpec) {
    for part in &spec.chart_auxiliary_parts {
        let domain_types::chart::ChartAuxiliaryContent::ColorStyle { xml } = &part.content else {
            continue;
        };
        let projection =
            crate::domain::charts::color_style::parse_chart_color_style_xml(xml.as_bytes());
        if spec.colors.is_none() {
            spec.colors = projection.colors;
        }
        if spec.color_scheme.is_none() {
            spec.color_scheme = projection.color_scheme;
        }
    }
}

/// Build `ChartSpec` list from `parsed_chart_ex` (ChartEx modern chart types).
///
/// ChartEx charts use the `cx:` namespace and cover Waterfall, Treemap, Sunburst, etc.
/// Position data is extracted from matching drawing anchors (GraphicFrame entries whose
/// `graphic_xml` contains the ChartEx namespace URI).
pub(crate) fn convert_parsed_chart_ex_to_chart_specs(sheet: &FullParsedSheet) -> Vec<ChartSpec> {
    if sheet.parsed_chart_ex.is_empty() {
        return Vec::new();
    }

    let chartex_frames = chart_drawing_frames(sheet, true);
    let chartex_frames_by_target = chart_frames_by_relationship_target(&chartex_frames);

    sheet
        .parsed_chart_ex
        .iter()
        .enumerate()
        .map(|(idx, cx)| {
            // Wrap ChartExSpace directly — no JSON serialization needed.
            let definition = Some(ChartDefinition::ChartEx(cx.chart_space.clone()));
            let projection = project_chart_ex_space(&cx.chart_space, sheet, &cx.original_path);

            // Position from matched drawing anchor, or default.
            let matched_frame = chartex_frames_by_target
                .get(cx.original_path.as_str())
                .copied()
                .or_else(|| chartex_frames.get(idx));
            let position = matched_frame
                .map(|(position, _)| position.clone())
                .unwrap_or_default();
            let chart_relationships = cx
                .chart_rels_bytes
                .as_ref()
                .map(|(_, rels_xml)| chart_owned_relationships(rels_xml))
                .unwrap_or_default();
            let chart_auxiliary_parts =
                chart_auxiliary_parts(&chart_relationships, &cx.auxiliary_files);

            let mut spec = ChartSpec {
                chart_type: projection.chart_type,
                title: projection.title,
                position: position.clone(),
                size: ObjectSize {
                    width: 400.0,
                    height: 300.0,
                    ..Default::default()
                },
                z_index: 0,
                definition,
                series: projection.series,
                sub_type: None,
                legend: projection.legend,
                axes: projection.axes,
                data_labels: projection.data_labels,
                data_range: projection.data_range,
                series_range: None,
                category_range: None,
                colors: None,
                style: None,
                rounded_corners: None,
                auto_title_deleted: None,
                show_data_labels_over_max: None,
                chart_format: projection.chart_format,
                plot_format: projection.plot_format,
                title_format: projection.title_format,
                title_rich_text: projection.title_rich_text,
                title_formula: projection.title_formula,
                plot_layout: None,
                title_layout: None,
                data_table: None,
                drop_lines: None,
                high_low_lines: None,
                series_lines: None,
                up_down_bars: None,
                waterfall: projection.waterfall,
                histogram: projection.histogram,
                boxplot: projection.boxplot,
                hierarchy: projection.hierarchy,
                region_map: projection.region_map,
                display_blanks_as: None,
                plot_visible_only: None,
                gap_width: None,
                gap_depth: None,
                overlap: None,
                doughnut_hole_size: None,
                first_slice_angle: None,
                bubble_scale: None,
                show_neg_bubbles: None,
                size_represents: None,
                split_type: None,
                split_value: None,
                show_lines: None,
                smooth_lines: None,
                category_label_level: None,
                series_name_level: None,
                show_all_field_buttons: None,
                second_plot_size: None,
                vary_by_categories: None,
                title_h_align: projection.title_h_align,
                title_v_align: projection.title_v_align,
                title_show_shadow: None,
                pivot_options: None,
                pivot_projection: None,
                bar_shape: None,
                bubble_3d_effect: None,
                wireframe: None,
                surface_top_view: None,
                color_scheme: None,
                chart_style_context: projection.chart_style_context,
                view_3d: None,
                floor_format: None,
                side_wall_format: None,
                back_wall_format: None,
                chart_frame: None,
                chart_relationships,
                chart_auxiliary_files: cx.auxiliary_files.clone(),
                chart_auxiliary_parts,
                chart_ex_replay: Some(domain_types::chart::ChartExReplayData {
                    original_path: cx.original_path.clone(),
                    original_xml: cx.original_xml.clone(),
                    original_position: position.clone(),
                    projection_fingerprint: None,
                    rels_path: cx.chart_rels_bytes.as_ref().map(|(path, _)| path.clone()),
                    rels_xml: cx.chart_rels_bytes.as_ref().map(|(_, xml)| xml.clone()),
                    relationships: cx
                        .chart_rels_bytes
                        .as_ref()
                        .map(|(_, rels_xml)| chart_owned_relationships(rels_xml))
                        .unwrap_or_default(),
                    auxiliary_files: cx.auxiliary_files.clone(),
                }),
                standard_chart_provenance: None,
                standard_chart_export_authority: None,
                is_chart_ex: true,
                cnv_pr_name: None,
                cnv_pr_id: None,
                cnv_pr_descr: None,
                cnv_pr_title: None,
                cnv_pr_hidden: false,
                no_change_aspect: None,
                has_graphic_frame_locks: false,
                xfrm_off_x: 0,
                xfrm_off_y: 0,
                xfrm_ext_cx: 0,
                xfrm_ext_cy: 0,
                cnv_pr_ext_lst: None,
                anchor_edit_as: None,
                macro_name: None,
                client_data_locks_with_sheet: None,
                client_data_prints_with_sheet: None,
                anchor_index: None,
                import_status: projection.import_status,
            };
            normalize_local_chart_source_references(&mut spec, &sheet.name);
            if let Some((_, frame)) = matched_frame {
                apply_chart_frame_to_spec(&mut spec, frame);
            }
            let projection_fingerprint = standard_chart_projection_fingerprint(&spec);
            if let Some(replay) = spec.chart_ex_replay.as_mut() {
                replay.projection_fingerprint = Some(projection_fingerprint);
            }
            spec
        })
        .collect()
}

#[cfg(test)]
mod tests;
