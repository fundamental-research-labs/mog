use super::chart_ex_projection::project_chart_ex_space;
use super::*;

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
            if let Some((position, frame)) = matched_frame.or_else(|| chart_frames.get(idx)) {
                spec.position = position.clone();
                apply_chart_frame_to_spec(&mut spec, frame);
            }

            // Also store the ChartSpace blob in definition for backward compatibility
            // during the transition. This can be removed once all consumers use typed fields.
            spec.definition = Some(ChartDefinition::Chart(chart_space.clone()));
            spec.chart_auxiliary_files = chart.auxiliary_files.clone();
            spec.chart_relationships = chart
                .chart_rels_bytes
                .as_ref()
                .map(|(_, rels_xml)| chart_owned_relationships(rels_xml))
                .unwrap_or_default();
            spec.chart_auxiliary_parts =
                chart_auxiliary_parts(&spec.chart_relationships, &spec.chart_auxiliary_files);
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
                    validity: if relationship_closure_current {
                        domain_types::chart::StandardChartAuthorityValidity::Current
                    } else {
                        domain_types::chart::StandardChartAuthorityValidity::Unsafe
                    },
                    chart_part_revision: 0,
                    package_owner: chart.original_path.clone(),
                    relationship_closure_current,
                    projection_fingerprint: Some(projection_fingerprint),
                    invalidated_owner_ids: Vec::new(),
                    stale_reason: (!relationship_closure_current).then(|| {
                        relationship_closure
                            .diagnostics
                            .first()
                            .and_then(|diagnostic| diagnostic.message.clone())
                            .unwrap_or_else(|| "chart relationship graph is not closed".to_string())
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

const STANDARD_CHART_PROJECTION_SCHEMA_VERSION: u32 = 4;

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

pub(crate) fn chart_frames_by_relationship_target(
    frames: &[(AnchorPosition, ChartDrawingFrameOoxmlProps)],
) -> HashMap<String, &(AnchorPosition, ChartDrawingFrameOoxmlProps)> {
    frames
        .iter()
        .filter_map(|entry| {
            let target = entry.1.relationship_target.as_deref()?;
            Some((normalize_drawing_relationship_target(target), entry))
        })
        .collect()
}

fn normalize_drawing_relationship_target(target: &str) -> String {
    opc_target_to_zip_path(target, "xl/drawings")
}

/// Build a ChartRefInfo from position data in an old ChartSpec (or from Chart flat fields).
fn build_chart_ref_info_from_spec(
    old_spec: Option<&ChartSpec>,
    _chart: &crate::domain::charts::Chart,
) -> crate::domain::charts::read::ChartRefInfo {
    use crate::domain::charts::read::ChartRefInfo;

    if let Some(spec) = old_spec {
        let (cx, cy) = chart_ref_extent_from_spec(spec);
        ChartRefInfo {
            target: String::new(), // not needed for extraction
            from_row: spec.position.anchor_row,
            from_col: spec.position.anchor_col,
            from_row_off: spec.position.anchor_row_offset,
            from_col_off: spec.position.anchor_col_offset,
            absolute_x: spec.position.absolute_x,
            absolute_y: spec.position.absolute_y,
            to_row: spec.position.end_row,
            to_col: spec.position.end_col,
            to_row_off: spec.position.end_row_offset,
            to_col_off: spec.position.end_col_offset,
            cx,
            cy,
            xfrm_off_x: spec.xfrm_off_x,
            xfrm_off_y: spec.xfrm_off_y,
            xfrm_ext_cx: spec.xfrm_ext_cx,
            xfrm_ext_cy: spec.xfrm_ext_cy,
            cnv_pr_name: spec.cnv_pr_name.clone(),
            cnv_pr_id: spec.cnv_pr_id,
            cnv_pr_descr: spec.cnv_pr_descr.clone(),
            cnv_pr_title: spec.cnv_pr_title.clone(),
            cnv_pr_hidden: spec.cnv_pr_hidden,
            no_change_aspect: spec.no_change_aspect,
            has_graphic_frame_locks: spec.has_graphic_frame_locks,
            cnv_pr_ext_lst: spec.cnv_pr_ext_lst.clone(),
            anchor_edit_as: spec.anchor_edit_as.clone(),
            macro_name: spec.macro_name.clone(),
            client_data_locks_with_sheet: spec.client_data_locks_with_sheet,
            client_data_prints_with_sheet: spec.client_data_prints_with_sheet,
            anchor_index: spec.anchor_index,
        }
    } else {
        // Fallback: minimal ref info
        ChartRefInfo {
            target: String::new(),
            from_row: 0,
            from_col: 0,
            from_row_off: 0,
            from_col_off: 0,
            absolute_x: None,
            absolute_y: None,
            to_row: None,
            to_col: None,
            to_row_off: None,
            to_col_off: None,
            cx: 4572000, // default 480px
            cy: 2743200, // default 288px
            xfrm_off_x: 0,
            xfrm_off_y: 0,
            xfrm_ext_cx: 0,
            xfrm_ext_cy: 0,
            cnv_pr_name: None,
            cnv_pr_id: None,
            cnv_pr_descr: None,
            cnv_pr_title: None,
            cnv_pr_hidden: false,
            no_change_aspect: None,
            has_graphic_frame_locks: false,
            cnv_pr_ext_lst: None,
            anchor_edit_as: None,
            macro_name: None,
            client_data_locks_with_sheet: None,
            client_data_prints_with_sheet: None,
            anchor_index: None,
        }
    }
}

fn build_chart_ref_info_from_frame(
    position: &AnchorPosition,
    frame: &ChartDrawingFrameOoxmlProps,
) -> crate::domain::charts::read::ChartRefInfo {
    use crate::domain::charts::read::ChartRefInfo;

    let gf = &frame.graphic_frame;
    let nv = &gf.nv_graphic_frame_pr;
    let cnv = &nv.c_nv_pr;
    let (cx, cy) = if position.end_row.is_none() && position.end_col.is_none() {
        (
            position
                .extent_cx
                .unwrap_or_else(|| gf.xfrm.ext_cx() as i64),
            position
                .extent_cy
                .unwrap_or_else(|| gf.xfrm.ext_cy() as i64),
        )
    } else {
        (gf.xfrm.ext_cx() as i64, gf.xfrm.ext_cy() as i64)
    };

    ChartRefInfo {
        target: frame
            .relationship_target
            .as_deref()
            .map(normalize_drawing_relationship_target)
            .unwrap_or_default(),
        from_row: position.anchor_row,
        from_col: position.anchor_col,
        from_row_off: position.anchor_row_offset,
        from_col_off: position.anchor_col_offset,
        absolute_x: position.absolute_x,
        absolute_y: position.absolute_y,
        to_row: position.end_row,
        to_col: position.end_col,
        to_row_off: position.end_row_offset,
        to_col_off: position.end_col_offset,
        cx,
        cy,
        xfrm_off_x: gf.xfrm.off_x(),
        xfrm_off_y: gf.xfrm.off_y(),
        xfrm_ext_cx: gf.xfrm.ext_cx() as i64,
        xfrm_ext_cy: gf.xfrm.ext_cy() as i64,
        cnv_pr_name: (!cnv.name.is_empty()).then(|| cnv.name.clone()),
        cnv_pr_id: (cnv.id.value() != 0).then_some(cnv.id.value()),
        cnv_pr_descr: cnv.descr.clone(),
        cnv_pr_title: cnv.title.clone(),
        cnv_pr_hidden: cnv.hidden,
        no_change_aspect: nv
            .no_change_aspect_explicit
            .or_else(|| nv.c_nv_graphic_frame_pr.no_change_aspect.then_some(true)),
        has_graphic_frame_locks: nv.has_graphic_frame_locks,
        cnv_pr_ext_lst: cnv.ext_lst.clone(),
        anchor_edit_as: frame.edit_as.clone(),
        macro_name: gf.macro_name.clone(),
        client_data_locks_with_sheet: frame.client_data_locks_with_sheet,
        client_data_prints_with_sheet: frame.client_data_prints_with_sheet,
        anchor_index: frame.anchor_index.and_then(|idx| usize::try_from(idx).ok()),
    }
}

/// Choose the dimensions that represent the drawing anchor, not the inner
/// graphicFrame transform. For one-cell anchors the real size lives on
/// `xdr:oneCellAnchor/xdr:ext`; `graphicFrame/xfrm/a:ext` is often `0,0`.
pub(crate) fn chart_ref_extent_from_spec(spec: &ChartSpec) -> (i64, i64) {
    if spec.position.end_row.is_none() && spec.position.end_col.is_none() {
        (
            spec.position.extent_cx.unwrap_or(spec.xfrm_ext_cx),
            spec.position.extent_cy.unwrap_or(spec.xfrm_ext_cy),
        )
    } else {
        (spec.xfrm_ext_cx, spec.xfrm_ext_cy)
    }
}

fn chart_drawing_frames(
    sheet: &FullParsedSheet,
    chart_ex: bool,
) -> Vec<(AnchorPosition, ChartDrawingFrameOoxmlProps)> {
    let Some(drawing) = sheet.parsed_drawing.as_ref() else {
        return Vec::new();
    };

    drawing
        .anchors
        .iter()
        .enumerate()
        .filter_map(|(idx, anchor)| chart_drawing_frame_from_anchor(drawing, anchor, idx, chart_ex))
        .collect()
}

fn chart_drawing_frame_from_anchor(
    drawing: &Drawing,
    anchor: &DrawingAnchor,
    anchor_index: usize,
    chart_ex: bool,
) -> Option<(AnchorPosition, ChartDrawingFrameOoxmlProps)> {
    let (position, content, extent_emu, edit_as, client_data, raw_alternate_content) = match anchor
    {
        DrawingAnchor::TwoCell(tc) => (
            AnchorPosition {
                anchor_row: tc.from.row,
                anchor_col: tc.from.col,
                anchor_row_offset: tc.from.row_off,
                anchor_col_offset: tc.from.col_off,
                absolute_x: None,
                absolute_y: None,
                end_row: Some(tc.to.row),
                end_col: Some(tc.to.col),
                end_row_offset: Some(tc.to.row_off),
                end_col_offset: Some(tc.to.col_off),
                extent_cx: None,
                extent_cy: None,
            },
            &tc.content,
            None,
            tc.edit_as.as_ref().map(|e| e.to_ooxml().to_string()),
            &tc.client_data,
            tc.mc_alternate_content
                .as_ref()
                .map(|mc| mc.raw_xml.clone()),
        ),
        DrawingAnchor::OneCell(oc) => (
            AnchorPosition {
                anchor_row: oc.from.row,
                anchor_col: oc.from.col,
                anchor_row_offset: oc.from.row_off,
                anchor_col_offset: oc.from.col_off,
                absolute_x: None,
                absolute_y: None,
                end_row: None,
                end_col: None,
                end_row_offset: None,
                end_col_offset: None,
                extent_cx: Some(oc.extent.cx),
                extent_cy: Some(oc.extent.cy),
            },
            &oc.content,
            Some((oc.extent.cx, oc.extent.cy)),
            None,
            &oc.client_data,
            oc.mc_alternate_content
                .as_ref()
                .map(|mc| mc.raw_xml.clone()),
        ),
        DrawingAnchor::Absolute(abs) => (
            AnchorPosition {
                anchor_row: 0,
                anchor_col: 0,
                anchor_row_offset: 0,
                anchor_col_offset: 0,
                absolute_x: Some(abs.pos.x),
                absolute_y: Some(abs.pos.y),
                end_row: None,
                end_col: None,
                end_row_offset: None,
                end_col_offset: None,
                extent_cx: Some(abs.extent.cx),
                extent_cy: Some(abs.extent.cy),
            },
            &abs.content,
            Some((abs.extent.cx, abs.extent.cy)),
            Some("absolute".to_string()),
            &abs.client_data,
            None,
        ),
    };

    let DrawingContent::GraphicFrame(gf) = content else {
        return None;
    };
    let graphic_xml = gf.graphic_xml.as_deref().unwrap_or_default();
    let is_chart_ex = graphic_xml.contains("2014/chartex") || graphic_xml.contains("chartEx");
    let is_standard_chart = graphic_xml.contains("schemas.openxmlformats.org/drawingml/2006/chart");
    if chart_ex != is_chart_ex || (!chart_ex && !is_standard_chart) {
        return None;
    }

    let relationship_id = extract_chart_relationship_id(graphic_xml);
    let relationship_target = relationship_id.as_ref().and_then(|rid| {
        drawing
            .opc_rels
            .iter()
            .find(|rel| rel.id == *rid)
            .map(|rel| rel.target.clone())
    });
    let client_data_locks_with_sheet = (!client_data.locks_with_sheet).then_some(false);
    let client_data_prints_with_sheet = (!client_data.prints_with_sheet).then_some(false);

    Some((
        position,
        ChartDrawingFrameOoxmlProps {
            graphic_frame: gf.clone(),
            anchor_index: i32::try_from(anchor_index).ok(),
            extent_emu_cx: extent_emu.map(|(cx, _)| cx),
            extent_emu_cy: extent_emu.map(|(_, cy)| cy),
            edit_as,
            client_data_locks_with_sheet,
            client_data_prints_with_sheet,
            relationship_id,
            relationship_target,
            raw_alternate_content,
        },
    ))
}

fn extract_chart_relationship_id(graphic_xml: &str) -> Option<String> {
    let chart_pos = graphic_xml
        .find("<c:chart")
        .or_else(|| graphic_xml.find("<chart"))
        .or_else(|| graphic_xml.find("<cx:chart"))?;
    let tag = &graphic_xml[chart_pos..];
    let tag = tag.split_once('>').map(|(t, _)| t).unwrap_or(tag);
    extract_xml_attr(tag, "r:id").or_else(|| extract_xml_attr(tag, "id"))
}

fn extract_xml_attr(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let start = tag.find(&needle)? + needle.len();
    let rest = &tag[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn apply_chart_frame_to_spec(spec: &mut ChartSpec, frame: &ChartDrawingFrameOoxmlProps) {
    let gf = &frame.graphic_frame;
    let nv = &gf.nv_graphic_frame_pr;
    let cnv = &nv.c_nv_pr;

    spec.chart_frame = Some(frame.clone());
    spec.cnv_pr_name = (!cnv.name.is_empty()).then(|| cnv.name.clone());
    spec.cnv_pr_id = (cnv.id.value() != 0).then_some(cnv.id.value());
    spec.cnv_pr_descr = cnv.descr.clone();
    spec.cnv_pr_title = cnv.title.clone();
    spec.cnv_pr_hidden = cnv.hidden;
    spec.no_change_aspect = nv
        .no_change_aspect_explicit
        .or_else(|| nv.c_nv_graphic_frame_pr.no_change_aspect.then_some(true));
    spec.has_graphic_frame_locks = nv.has_graphic_frame_locks;
    spec.xfrm_off_x = gf.xfrm.off_x();
    spec.xfrm_off_y = gf.xfrm.off_y();
    spec.xfrm_ext_cx = gf.xfrm.ext_cx() as i64;
    spec.xfrm_ext_cy = gf.xfrm.ext_cy() as i64;
    spec.cnv_pr_ext_lst = cnv.ext_lst.clone();
    spec.anchor_edit_as = frame.edit_as.clone();
    spec.macro_name = gf.macro_name.clone();
    spec.client_data_locks_with_sheet = frame.client_data_locks_with_sheet;
    spec.client_data_prints_with_sheet = frame.client_data_prints_with_sheet;
    spec.anchor_index = frame.anchor_index.and_then(|idx| usize::try_from(idx).ok());
}

/// Build a fallback ChartSpec when no ChartSpace is available.
pub(crate) fn build_fallback_chart_spec(
    chart: &crate::domain::charts::Chart,
    _idx: usize,
    _sheet: &FullParsedSheet,
) -> ChartSpec {
    let title = chart
        .title
        .as_ref()
        .and_then(|t| crate::domain::charts::extract_chart_title_text(t));
    ChartSpec {
        chart_type: domain_types::ChartType::Unknown("unknown".to_string()),
        title,
        position: AnchorPosition::default(),
        size: ObjectSize {
            width: 400.0,
            height: 300.0,
            ..Default::default()
        },
        z_index: 0,
        definition: Some(ChartDefinition::Chart(
            ooxml_types::charts::ChartSpace::default(),
        )),
        series: vec![],
        sub_type: None,
        legend: None,
        axes: None,
        data_labels: None,
        data_range: None,
        style: None,
        rounded_corners: None,
        auto_title_deleted: None,
        show_data_labels_over_max: None,
        chart_format: None,
        plot_format: None,
        title_format: None,
        title_rich_text: None,
        title_formula: None,
        plot_layout: None,
        title_layout: None,
        data_table: None,
        drop_lines: None,
        high_low_lines: None,
        series_lines: None,
        up_down_bars: None,
        waterfall: None,
        histogram: None,
        boxplot: None,
        hierarchy: None,
        region_map: None,
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
        category_label_level: None,
        series_name_level: None,
        show_all_field_buttons: None,
        second_plot_size: None,
        vary_by_categories: None,
        title_h_align: None,
        title_v_align: None,
        title_show_shadow: None,
        pivot_options: None,
        bar_shape: None,
        bubble_3d_effect: None,
        wireframe: None,
        surface_top_view: None,
        color_scheme: None,
        chart_style_context: None,
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        chart_frame: None,
        chart_relationships: Vec::new(),
        chart_auxiliary_files: Vec::new(),
        chart_auxiliary_parts: Vec::new(),
        chart_ex_replay: None,
        standard_chart_provenance: None,
        standard_chart_export_authority: None,
        is_chart_ex: false,
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
        import_status: None,
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
                category_label_level: None,
                series_name_level: None,
                show_all_field_buttons: None,
                second_plot_size: None,
                vary_by_categories: None,
                title_h_align: projection.title_h_align,
                title_v_align: projection.title_v_align,
                title_show_shadow: None,
                pivot_options: None,
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
pub(crate) fn chart_ex_anchor_position(anchor: &DrawingAnchor) -> Option<AnchorPosition> {
    let content = match anchor {
        DrawingAnchor::TwoCell(tc) => &tc.content,
        DrawingAnchor::OneCell(oc) => &oc.content,
        DrawingAnchor::Absolute(_) => return None,
    };

    let DrawingContent::GraphicFrame(gf) = content else {
        return None;
    };
    let is_chartex = gf
        .graphic_xml
        .as_ref()
        .map(|xml| xml.contains("2014/chartex") || xml.contains("chartEx"))
        .unwrap_or(false);
    if !is_chartex {
        return None;
    }

    match anchor {
        DrawingAnchor::TwoCell(tc) => Some(AnchorPosition {
            anchor_row: tc.from.row,
            anchor_col: tc.from.col,
            anchor_row_offset: tc.from.row_off,
            anchor_col_offset: tc.from.col_off,
            absolute_x: None,
            absolute_y: None,
            end_row: Some(tc.to.row),
            end_col: Some(tc.to.col),
            end_row_offset: Some(tc.to.row_off),
            end_col_offset: Some(tc.to.col_off),
            extent_cx: None,
            extent_cy: None,
        }),
        DrawingAnchor::OneCell(oc) => Some(AnchorPosition {
            anchor_row: oc.from.row,
            anchor_col: oc.from.col,
            anchor_row_offset: oc.from.row_off,
            anchor_col_offset: oc.from.col_off,
            absolute_x: None,
            absolute_y: None,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: Some(oc.extent.cx),
            extent_cy: Some(oc.extent.cy),
        }),
        DrawingAnchor::Absolute(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::chart_ex_projection::{
        chart_ex_import_status, chart_type_from_chart_ex_layout_id,
    };
    use super::*;
    use ooxml_types::chart_ex::ChartExLayoutId;

    #[test]
    fn chart_ex_layout_ids_map_to_public_chart_types_without_prefixes() {
        for (layout_id, expected) in [
            (
                ChartExLayoutId::Waterfall,
                domain_types::ChartType::Waterfall,
            ),
            (ChartExLayoutId::Treemap, domain_types::ChartType::Treemap),
            (ChartExLayoutId::Sunburst, domain_types::ChartType::Sunburst),
            (ChartExLayoutId::Funnel, domain_types::ChartType::Funnel),
            (
                ChartExLayoutId::RegionMap,
                domain_types::ChartType::RegionMap,
            ),
            (
                ChartExLayoutId::Histogram,
                domain_types::ChartType::Histogram,
            ),
            (ChartExLayoutId::Pareto, domain_types::ChartType::Pareto),
            (
                ChartExLayoutId::BoxWhisker,
                domain_types::ChartType::Boxplot,
            ),
        ] {
            let chart_type = chart_type_from_chart_ex_layout_id(&layout_id);
            assert_eq!(chart_type, expected);
            assert!(!chart_type.as_str().starts_with("chartEx:"));
        }
    }

    #[test]
    fn chart_ex_unknown_layout_ids_remain_unsupported_chart_types() {
        assert_eq!(
            chart_type_from_chart_ex_layout_id(&ChartExLayoutId::ClusteredBar),
            domain_types::ChartType::Unknown("clusteredBar".to_string())
        );
        assert_eq!(
            chart_type_from_chart_ex_layout_id(&ChartExLayoutId::Other("futureLayout".to_string())),
            domain_types::ChartType::Unknown("futureLayout".to_string())
        );
    }

    #[test]
    fn chart_ex_status_distinguishes_preserved_not_renderable_from_unknown_family() {
        let not_renderable = chart_ex_import_status(
            &domain_types::ChartType::RegionMap,
            &[],
            None,
            "xl/charts/chartEx1.xml",
            Some("Map"),
        )
        .expect("region maps are preserved but not renderable yet");
        assert_eq!(
            not_renderable.recoverability,
            domain_types::ImportRecoverability::PreservedNotRenderable
        );
        assert_eq!(
            not_renderable.renderability,
            domain_types::ImportRenderability::NotRenderable
        );
        assert_eq!(
            not_renderable.diagnostics[0].code,
            Some(domain_types::ImportDiagnosticCode::UnsupportedFeature)
        );

        let unknown = chart_ex_import_status(
            &domain_types::ChartType::Unknown("futureLayout".to_string()),
            &[],
            None,
            "xl/charts/chartEx2.xml",
            None,
        )
        .expect("unknown ChartEx layouts are unsupported");
        assert_eq!(
            unknown.diagnostics[0].code,
            Some(domain_types::ImportDiagnosticCode::UnsupportedChartType)
        );
    }

    #[test]
    fn standard_chart_relationship_closure_allows_referenced_external_data() {
        let chart_space = ooxml_types::charts::ChartSpace {
            external_data: Some(ooxml_types::charts::ExternalData {
                r_id: "rIdExternalData".to_string(),
                auto_update: Some(false),
            }),
            ..Default::default()
        };
        let relationships = vec![domain_types::chart::ChartRelationshipData {
            r_id: "rIdExternalData".to_string(),
            relationship_type: Some(crate::infra::opc::REL_EXTERNAL_LINK.to_string()),
            target: Some("externalLinks/externalLink1.xml".to_string()),
            target_mode: Some("External".to_string()),
        }];

        let closure = standard_chart_relationship_closure(
            Some("xl/charts/chart1.xml"),
            &chart_space,
            &relationships,
            &[],
            Some("Revenue"),
        );

        assert!(closure.current);
        assert!(closure.diagnostics.is_empty());
    }

    #[test]
    fn standard_chart_relationship_closure_reports_unsupported_relationships() {
        let chart_space = ooxml_types::charts::ChartSpace {
            user_shapes: Some("rIdUserShapes".to_string()),
            ..Default::default()
        };
        let relationships = vec![
            domain_types::chart::ChartRelationshipData {
                r_id: "rIdUserShapes".to_string(),
                relationship_type: Some(crate::infra::opc::REL_CHART_USER_SHAPES.to_string()),
                target: Some("../drawings/userShapeDrawing1.xml".to_string()),
                target_mode: None,
            },
            domain_types::chart::ChartRelationshipData {
                r_id: "rIdVendor".to_string(),
                relationship_type: Some("http://example.com/vendorChartSidecar".to_string()),
                target: Some("vendor1.xml".to_string()),
                target_mode: None,
            },
        ];

        let closure = standard_chart_relationship_closure(
            Some("xl/charts/chart1.xml"),
            &chart_space,
            &relationships,
            &[],
            Some("Revenue"),
        );
        let codes = closure
            .diagnostics
            .iter()
            .filter_map(|diagnostic| diagnostic.code.clone())
            .collect::<Vec<_>>();

        assert!(!closure.current);
        assert!(codes.contains(&domain_types::ImportDiagnosticCode::MissingRelationshipTarget));
        assert!(codes.contains(&domain_types::ImportDiagnosticCode::UnsupportedFeature));
    }

    #[test]
    fn standard_chart_pivot_fmts_emit_import_diagnostic_for_style_semantics() {
        let chart_space = ooxml_types::charts::ChartSpace {
            chart: ooxml_types::charts::Chart {
                pivot_fmts: vec![ooxml_types::charts::PivotFmt {
                    idx: 2,
                    sp_pr: Some(Default::default()),
                    ..Default::default()
                }],
                ..Default::default()
            },
            ..Default::default()
        };

        let diagnostics = standard_chart_pivot_format_diagnostics(
            &chart_space,
            Some("xl/charts/chart1.xml"),
            Some("Revenue"),
        );

        assert_eq!(diagnostics.len(), 1);
        let diagnostic = &diagnostics[0];
        assert_eq!(
            diagnostic.code,
            Some(domain_types::ImportDiagnosticCode::UnsupportedFeature)
        );
        assert!(
            diagnostic
                .message
                .as_deref()
                .is_some_and(|message| message.contains("c:pivotFmts"))
        );
        assert_eq!(diagnostic.object_id.as_deref(), Some("pivotFmts"));
    }
}
