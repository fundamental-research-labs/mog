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
            // Preserve auxiliary files for round-trip (stored on Chart, not ChartSpace)
            if let Some(ref mut rt) = spec.rt {
                rt.auxiliary_files = chart.auxiliary_files.clone();
                rt.chart_rels_bytes = chart.chart_rels_bytes.clone();
                enrich_chart_owned_relationships(rt);
            }

            spec
        })
        .collect()
}

fn enrich_chart_owned_relationships(rt: &mut domain_types::chart::ChartRoundTripData) {
    let Some((_, rels_xml)) = rt.chart_rels_bytes.as_ref() else {
        return;
    };
    let relationships = crate::domain::workbook::read::parse_all_rels(rels_xml);

    if let Some(external_data) = rt.external_data.as_mut()
        && let Some(rel) = relationships
            .iter()
            .find(|rel| rel.id == external_data.relationship.r_id)
    {
        external_data.relationship.relationship_type = Some(rel.rel_type.clone());
        external_data.relationship.target = Some(rel.target.clone());
        external_data.relationship.target_mode = rel.target_mode.clone();
    }

    if let Some(user_shapes) = rt.user_shapes.as_mut()
        && let Some(rel) = relationships.iter().find(|rel| rel.id == user_shapes.r_id)
    {
        user_shapes.relationship_type = Some(rel.rel_type.clone());
        user_shapes.target = Some(rel.target.clone());
        user_shapes.target_mode = rel.target_mode.clone();
    }
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
    let (position, content, extent_emu, edit_as, client_data) = match anchor {
        DrawingAnchor::TwoCell(tc) => (
            AnchorPosition {
                anchor_row: tc.from.row,
                anchor_col: tc.from.col,
                anchor_row_offset: tc.from.row_off,
                anchor_col_offset: tc.from.col_off,
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
        ),
        DrawingAnchor::OneCell(oc) => (
            AnchorPosition {
                anchor_row: oc.from.row,
                anchor_col: oc.from.col,
                anchor_row_offset: oc.from.row_off,
                anchor_col_offset: oc.from.col_off,
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
        ),
        DrawingAnchor::Absolute(_) => return None,
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
        data_table: None,
        display_blanks_as: None,
        plot_visible_only: None,
        gap_width: None,
        overlap: None,
        doughnut_hole_size: None,
        first_slice_angle: None,
        bubble_scale: None,
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
        view_3d: None,
        floor_format: None,
        side_wall_format: None,
        back_wall_format: None,
        rt: None,
        chart_frame: None,
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

    sheet
        .parsed_chart_ex
        .iter()
        .enumerate()
        .map(|(idx, cx)| {
            // Wrap ChartExSpace directly — no JSON serialization needed.
            let definition = Some(ChartDefinition::ChartEx(cx.chart_space.clone()));

            // Extract title from cx:title > cx:tx > cx:txData > cx:v.
            let title = cx
                .chart_space
                .chart
                .title
                .as_ref()
                .and_then(|t| t.tx.as_ref())
                .and_then(|tx| tx.tx_data.as_ref())
                .and_then(|td| td.value.clone());

            // Extract chart type from first series layout_id.
            let chart_type = cx
                .chart_space
                .chart
                .plot_area
                .plot_area_region
                .series
                .first()
                .map(|s| format!("chartEx:{}", s.layout_id.to_ooxml()))
                .unwrap_or_else(|| "chartEx:unknown".to_string());

            // Position from matched drawing anchor, or default.
            let position = chartex_frames
                .get(idx)
                .map(|(position, _)| position.clone())
                .unwrap_or_default();

            let mut spec = ChartSpec {
                chart_type: domain_types::ChartType::from_str(&chart_type),
                title,
                position,
                size: ObjectSize {
                    width: 400.0,
                    height: 300.0,
                    ..Default::default()
                },
                z_index: 0,
                definition,
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
                data_table: None,
                display_blanks_as: None,
                plot_visible_only: None,
                gap_width: None,
                overlap: None,
                doughnut_hole_size: None,
                first_slice_angle: None,
                bubble_scale: None,
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
                view_3d: None,
                floor_format: None,
                side_wall_format: None,
                back_wall_format: None,
                rt: Some(domain_types::chart::ChartRoundTripData {
                    auxiliary_files: cx.auxiliary_files.clone(),
                    chart_rels_bytes: cx.chart_rels_bytes.clone(),
                    ..Default::default()
                }),
                chart_frame: None,
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
                import_status: None,
            };
            if let Some((_, frame)) = chartex_frames.get(idx) {
                apply_chart_frame_to_spec(&mut spec, frame);
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
