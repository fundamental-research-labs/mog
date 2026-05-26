//! Feature conversions: tables, charts, form controls, OLE objects, connectors,
//! conditional formats, data validations, sparklines, slicers, floating objects,
//! data tables, print settings, page breaks, comment runs, outline groups.
//!
//! UTF-8 boundary guard: every `&s[n..]` / `&s[..n]` in this file slices
//! OOXML-token strings at byte offsets produced by ASCII-only
//! delimiters (`:`, `.`, digit bytes). Char-boundary by construction.
//! File-scope allow documented here.

#![allow(clippy::string_slice)]

use std::collections::HashMap;

use crate::infra::opc::opc_target_to_zip_path;
use domain_types::domain::floating_object::{
    AnchorMode, ChartDrawingFrameOoxmlProps, ConnectorBinding, ConnectorData, ConnectorOoxmlProps,
    FloatingObject, FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
    FormControlData, FormControlOoxmlProps, OleObjectData, OleObjectOoxmlProps, PictureData,
    PictureOoxmlProps, ShapeData, ShapeOoxmlProps,
};
use domain_types::{
    AxisBound, AxisBoundLabel, CFCellRange, CFColorPoint, CFColorScale, CFCustomIcon, CFDataBar,
    CFIconSet, CFIconThreshold, CFRule, CFStyle, ChartDefinition, ChartSpec, ConditionalFormat,
    DataTableRegion, EmptyCellDisplay, ErrorStyle, HeaderFooter, OutlineGroup, PageBreaks,
    PageMargins, PrintSettings, RichTextRun, Sparkline as DtSparkline, SparklineAxisSettings,
    SparklineCellAddress, SparklineDataRange, SparklineGroup as DtSparklineGroup,
    SparklineType as DtSparklineType, SparklineVisualSettings, TableColumnSpec, TableSpec,
    TotalsFunction, ValidationOperator, ValidationRule, ValidationSpec,
    chart::{AnchorPosition, ObjectSize},
};

use crate::domain::drawings::{Anchor as DrawingAnchor, Drawing, DrawingContent};
use crate::domain::sparklines::read::SparklineGroup;
use crate::output::results::{
    ColWidth, CommentRunOutput, ConnectorOutput, DataTableInfo, DvSummary, FormControlOutput,
    FullParsedSheet, OleObjectOutput, PageBreaksOutput, ParsedTable, PrintSettingsOutput,
    RowHeight,
};

use super::non_empty;

// =============================================================================
// Domain conversions: Tables
// =============================================================================

/// Convert parser `ParsedTable` items (per-sheet) into domain `TableSpec` items.
pub(super) fn convert_tables(tables: &[ParsedTable]) -> Vec<TableSpec> {
    tables
        .iter()
        .map(|t| TableSpec {
            id: t.id,
            name: t.name.clone(),
            display_name: t.display_name.clone(),
            range_ref: t.ref_range.clone(),
            has_headers: t.has_headers,
            has_totals: t.has_totals,
            style_name: t.style_name.clone(),
            row_stripes: t.show_row_stripes,
            col_stripes: t.show_column_stripes,
            first_col_highlight: t.show_first_column,
            last_col_highlight: t.show_last_column,
            auto_filter_ref: t.auto_filter_ref.clone(),
            auto_filter_xr_uid: t.auto_filter_xr_uid.clone(),
            columns: t
                .columns
                .iter()
                .map(|c| TableColumnSpec {
                    id: c.id,
                    name: c.name.clone(),
                    totals_label: c.totals_row_label.clone(),
                    totals_function: c
                        .totals_row_function
                        .as_deref()
                        .and_then(TotalsFunction::from_ooxml_str),
                    calculated_formula: c.calculated_column_formula.clone(),
                    calculated_formula_array: c.calculated_column_formula_array,
                    totals_row_formula: c.totals_row_formula.clone(),
                    totals_row_formula_array: c.totals_row_formula_array,
                    header_row_dxf_id: c.header_row_dxf_id,
                    data_dxf_id: c.data_dxf_id,
                    totals_row_dxf_id: c.totals_row_dxf_id,
                    header_row_cell_style: c.header_row_cell_style.clone(),
                    data_cell_style: c.data_cell_style.clone(),
                    totals_row_cell_style: c.totals_row_cell_style.clone(),
                    unique_name: c.unique_name.clone(),
                    query_table_field_id: c.query_table_field_id,
                    xr3_uid: c.xr3_uid.clone(),
                })
                .collect(),
            header_row_dxf_id: t.header_row_dxf_id,
            data_dxf_id: t.data_dxf_id,
            totals_row_dxf_id: t.totals_row_dxf_id,
            header_row_border_dxf_id: t.header_row_border_dxf_id,
            table_border_dxf_id: t.table_border_dxf_id,
            totals_row_border_dxf_id: t.totals_row_border_dxf_id,
            header_row_cell_style: t.header_row_cell_style.clone(),
            data_cell_style: t.data_cell_style.clone(),
            totals_row_cell_style: t.totals_row_cell_style.clone(),
            table_type: t.table_type.clone(),
            totals_row_shown: t.totals_row_shown,
            connection_id: t.connection_id,
            insert_row: t.insert_row,
            insert_row_shift: t.insert_row_shift,
            published: t.published,
            xr_uid: t.xr_uid.clone(),
            filter_columns: t.filter_columns.clone(),
            sort_state: t.sort_state.as_ref().map(|ss| {
                domain_types::domain::table::TableSortState {
                    ref_range: ss.ref_range.clone(),
                    case_sensitive: ss.case_sensitive,
                    conditions: ss
                        .conditions
                        .iter()
                        .map(|sc| domain_types::domain::table::TableSortCondition {
                            ref_range: sc.ref_range.clone(),
                            descending: sc.descending,
                        })
                        .collect(),
                }
            }),
        })
        .collect()
}

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
pub(super) fn convert_parsed_charts_to_chart_specs(sheet: &FullParsedSheet) -> Vec<ChartSpec> {
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
            spec.preserved_chart_xml = chart
                .raw_chart_xml
                .as_ref()
                .map(|xml| String::from_utf8_lossy(xml).into_owned());

            // Preserve auxiliary files for round-trip (stored on Chart, not ChartSpace)
            if let Some(ref mut rt) = spec.rt {
                rt.auxiliary_files = chart.auxiliary_files.clone();
                rt.chart_rels_bytes = chart.chart_rels_bytes.clone();
            }

            spec
        })
        .collect()
}

fn chart_frames_by_relationship_target(
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
fn chart_ref_extent_from_spec(spec: &ChartSpec) -> (i64, i64) {
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
fn build_fallback_chart_spec(
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
        preserved_chart_xml: chart
            .raw_chart_xml
            .as_ref()
            .map(|xml| String::from_utf8_lossy(xml).into_owned()),
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
pub(super) fn convert_parsed_chart_ex_to_chart_specs(sheet: &FullParsedSheet) -> Vec<ChartSpec> {
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
                preserved_chart_xml: None,
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
fn chart_ex_anchor_position(anchor: &DrawingAnchor) -> Option<AnchorPosition> {
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

// =============================================================================
// Domain conversions: Form controls
// =============================================================================

/// Convert parser `FormControlOutput` items into unified `FloatingObject` items.
pub(super) fn convert_form_controls(controls: &[FormControlOutput]) -> Vec<FloatingObject> {
    controls
        .iter()
        .enumerate()
        .map(|(idx, fc)| {
            let anchor = FloatingObjectAnchor {
                anchor_row: fc.from_row,
                anchor_col: fc.from_col,
                anchor_row_offset: fc.from_row_offset,
                anchor_col_offset: fc.from_col_offset,
                anchor_mode: AnchorMode::TwoCell,
                end_row: Some(fc.to_row),
                end_col: Some(fc.to_col),
                end_row_offset: Some(fc.to_row_offset),
                end_col_offset: Some(fc.to_col_offset),
                extent_cx: None,
                extent_cy: None,
            };
            // Build typed ooxml props for round-trip
            let ooxml = FormControlOoxmlProps {
                shape_id: fc.shape_id,
                alt_text: fc.alt_text.clone(),
                fmla_group: fc.fmla_group.clone(),
                fmla_txbx: fc.fmla_txbx.clone(),
                checked: fc.checked.clone(),
                val: fc.val,
                sel: fc.sel,
                min: fc.min,
                max: fc.max,
                inc: fc.inc,
                page: fc.page,
                drop_lines: fc.drop_lines,
                drop_style: fc.drop_style.clone(),
                dx: fc.dx,
                horiz: fc.horiz,
                colored: fc.colored,
                no_three_d: fc.no_three_d,
                no_three_d2: fc.no_three_d2,
                first_button: fc.first_button,
                lock_text: fc.lock_text,
                sel_type: fc.sel_type.clone(),
                multi_sel: fc.multi_sel.clone(),
                text_h_align: fc.text_h_align.clone(),
                text_v_align: fc.text_v_align.clone(),
                edit_val: fc.edit_val.clone(),
                multi_line: fc.multi_line,
                vertical_bar: fc.vertical_bar,
                password_edit: fc.password_edit,
                just_last_x: fc.just_last_x,
                width_min: fc.width_min,
                items: fc.items.clone(),
                macro_name: fc.macro_name.clone(),
                anchor_source: fc.anchor_source.clone(),
                move_with_cells: fc.move_with_cells,
                size_with_cells: fc.size_with_cells,
                vml_extras: fc.vml_extras.clone(),
                control_pr_attrs: fc.control_pr_attrs.clone(),
                vml_shape: Some(fc.vml_shape.clone()),
            };
            FloatingObject {
                common: FloatingObjectCommon {
                    id: format!("fobj-fc-{}", idx),
                    sheet_id: String::new(),
                    anchor,
                    width: 0.0,
                    height: 0.0,
                    z_index: idx as i32,
                    rotation: 0.0,
                    flip_h: false,
                    flip_v: false,
                    locked: false,
                    visible: true,
                    printable: true,
                    opacity: 1.0,
                    name: fc.name.clone().unwrap_or_default(),
                    created_at: 0,
                    updated_at: 0,
                    group_id: None,
                    anchor_cell_id: None,
                    to_anchor_cell_id: None,
                    lock_aspect_ratio: None,
                    alt_text_title: None,
                    display_name: None,
                    import_status: None,
                },
                data: FloatingObjectData::FormControl(FormControlData {
                    control_type: fc.object_type.clone(),
                    cell_link: fc.fmla_link.clone(),
                    input_range: fc.fmla_range.clone(),
                    ooxml: Some(ooxml),
                }),
            }
        })
        .collect()
}

// =============================================================================
// Domain conversions: OLE objects
// =============================================================================

/// Convert parser `OleObjectOutput` items into unified `FloatingObject` items.
pub(super) fn convert_ole_objects(objects: &[OleObjectOutput]) -> Vec<FloatingObject> {
    objects
        .iter()
        .enumerate()
        .map(|(idx, o)| {
            // Build anchor from objectPr anchor if available
            let anchor = o
                .object_pr
                .as_ref()
                .and_then(|pr| pr.anchor.as_ref())
                .map(|a| FloatingObjectAnchor {
                    anchor_row: a.from.row,
                    anchor_col: a.from.col,
                    anchor_row_offset: a.from.row_off,
                    anchor_col_offset: a.from.col_off,
                    anchor_mode: AnchorMode::TwoCell,
                    end_row: Some(a.to.row),
                    end_col: Some(a.to.col),
                    end_row_offset: Some(a.to.row_off),
                    end_col_offset: Some(a.to.col_off),
                    extent_cx: None,
                    extent_cy: None,
                })
                .unwrap_or(FloatingObjectAnchor {
                    anchor_row: 0,
                    anchor_col: 0,
                    anchor_row_offset: 0,
                    anchor_col_offset: 0,
                    anchor_mode: AnchorMode::TwoCell,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    extent_cx: None,
                    extent_cy: None,
                });
            // Build typed ooxml props for round-trip
            let ooxml = OleObjectOoxmlProps {
                shape_id: o.shape_id,
                r_id: o.r_id.clone(),
                data_path: o.data_path.clone(),
                name: o.name.clone(),
                link: o.link.clone(),
                dv_aspect: o.dv_aspect.clone(),
                prog_id: o.prog_id.clone(),
                ole_update: o.ole_update.clone(),
                auto_load: o.auto_load,
                preview_image_rel_id: o.preview_image_rel_id.clone(),
                preview_image_path: o.preview_image_path.clone(),
                object_pr: o.object_pr.clone(),
            };
            FloatingObject {
                common: FloatingObjectCommon {
                    id: format!("fobj-ole-{}", idx),
                    sheet_id: String::new(),
                    anchor,
                    width: 0.0,
                    height: 0.0,
                    z_index: idx as i32,
                    rotation: 0.0,
                    flip_h: false,
                    flip_v: false,
                    locked: false,
                    visible: true,
                    printable: true,
                    opacity: 1.0,
                    name: o.name.clone().unwrap_or_default(),
                    created_at: 0,
                    updated_at: 0,
                    group_id: None,
                    anchor_cell_id: None,
                    to_anchor_cell_id: None,
                    lock_aspect_ratio: None,
                    alt_text_title: None,
                    display_name: None,
                    import_status: None,
                },
                data: FloatingObjectData::OleObject(OleObjectData {
                    prog_id: o.prog_id.clone(),
                    dv_aspect: "DVASPECT_CONTENT".to_string(),
                    is_linked: false,
                    is_embedded: true,
                    preview_image_src: None,
                    alt_text: None,
                    ooxml: Some(ooxml),
                }),
            }
        })
        .collect()
}

// =============================================================================
// Domain conversions: Connectors
// =============================================================================

/// Convert parser `ConnectorOutput` items into unified `FloatingObject` items.
pub(super) fn convert_connectors(connectors: &[ConnectorOutput]) -> Vec<FloatingObject> {
    connectors
        .iter()
        .enumerate()
        .map(|(idx, c)| {
            let has_end = c.end_row.is_some() && c.end_col.is_some();
            let anchor = FloatingObjectAnchor {
                anchor_row: c.anchor_row.unwrap_or(0),
                anchor_col: c.anchor_col.unwrap_or(0),
                anchor_row_offset: c.anchor_row_offset,
                anchor_col_offset: c.anchor_col_offset,
                anchor_mode: if has_end {
                    AnchorMode::TwoCell
                } else {
                    AnchorMode::OneCell
                },
                end_row: c.end_row,
                end_col: c.end_col,
                end_row_offset: c.end_row_offset,
                end_col_offset: c.end_col_offset,
                extent_cx: None,
                extent_cy: None,
            };
            // Convert EMU to pixels (÷9525) for width/height
            let width = c.width.map(|w| (w / 9525) as f64).unwrap_or(0.0);
            let height = c.height.map(|h| (h / 9525) as f64).unwrap_or(0.0);
            let start_connection = c.start_connection.as_ref().map(|e| ConnectorBinding {
                shape_id: e.shape_id.to_string(),
                site_index: e.idx as i32,
            });
            let end_connection = c.end_connection.as_ref().map(|e| ConnectorBinding {
                shape_id: e.shape_id.to_string(),
                site_index: e.idx as i32,
            });
            let ooxml: Option<ConnectorOoxmlProps> = c
                .raw_json
                .as_ref()
                .and_then(|j| {
                    serde_json::from_str::<ooxml_types::drawings::SpreadsheetConnector>(j).ok()
                })
                .map(|connector| ConnectorOoxmlProps {
                    connector,
                    anchor_index: None,
                    extent_emu_cx: c.width,
                    extent_emu_cy: c.height,
                    edit_as: None,
                    client_data_locks_with_sheet: None,
                    client_data_prints_with_sheet: None,
                    mc_alternate_content_raw_xml: None,
                });
            FloatingObject {
                common: FloatingObjectCommon {
                    id: format!("fobj-conn-{}", idx),
                    sheet_id: String::new(),
                    anchor,
                    width,
                    height,
                    z_index: idx as i32,
                    rotation: 0.0,
                    flip_h: false,
                    flip_v: false,
                    locked: false,
                    visible: true,
                    printable: true,
                    opacity: 1.0,
                    name: c.name.clone().unwrap_or_default(),
                    created_at: 0,
                    updated_at: 0,
                    group_id: None,
                    anchor_cell_id: None,
                    to_anchor_cell_id: None,
                    lock_aspect_ratio: None,
                    alt_text_title: None,
                    display_name: None,
                    import_status: None,
                },
                data: FloatingObjectData::Connector(ConnectorData {
                    shape_type: c
                        .preset_geometry
                        .clone()
                        .unwrap_or_else(|| "line".to_string()),
                    fill: None,
                    outline: None,
                    start_connection,
                    end_connection,
                    adjustments: None,
                    ooxml,
                }),
            }
        })
        .collect()
}

// =============================================================================
// Domain conversions: Print settings
// =============================================================================

/// Convert parser `PrintSettingsOutput` into domain `PrintSettings`.
pub(super) fn convert_print_settings(ps: &PrintSettingsOutput) -> PrintSettings {
    let margins = ps.margins.as_ref().map(|m| PageMargins {
        top: m.top,
        bottom: m.bottom,
        left: m.left,
        right: m.right,
        header: m.header,
        footer: m.footer,
    });
    let header_footer = ps.header_footer.as_ref().map(|hf| HeaderFooter {
        odd_header: hf.odd_header.clone(),
        odd_footer: hf.odd_footer.clone(),
        even_header: hf.even_header.clone(),
        even_footer: hf.even_footer.clone(),
        first_header: hf.first_header.clone(),
        first_footer: hf.first_footer.clone(),
        different_odd_even: hf.different_odd_even,
        different_first: hf.different_first,
        scale_with_doc: hf.scale_with_doc,
        align_with_margins: hf.align_with_margins,
    });
    // Only populate pageSetup-derived fields when the original XML actually
    // had a <pageSetup> element.  Without this guard, orientation defaults to
    // "default" (a non-empty string) which tricks `build_print_writer_from_domain`
    // into creating a spurious <pageSetup usePrinterDefaults="0"/>.
    let (
        orientation,
        scale,
        fit_to_width,
        fit_to_height,
        black_and_white,
        draft,
        first_page_number,
    ) = if ps.has_page_setup {
        (
            non_empty(&ps.orientation),
            ps.scale.map(|s| s as u32),
            ps.fit_to_width.map(|f| f as u32),
            ps.fit_to_height.map(|f| f as u32),
            ps.black_and_white,
            ps.draft,
            ps.first_page_number,
        )
    } else {
        (None, None, None, None, false, false, None)
    };

    PrintSettings {
        paper_size: ps.paper_size.map(|p| p as u32),
        orientation,
        scale,
        fit_to_width,
        fit_to_height,
        gridlines: ps.grid_lines,
        headings: ps.headings,
        h_centered: ps.horizontal_centered,
        v_centered: ps.vertical_centered,
        margins,
        header_footer,
        black_and_white,
        draft,
        first_page_number,
        page_order: ps.page_order.clone(),
        use_printer_defaults: ps.use_printer_defaults,
        horizontal_dpi: ps.horizontal_dpi,
        vertical_dpi: ps.vertical_dpi,
        r_id: ps.r_id.clone(),
        use_first_page_number: ps.use_first_page_number,
        has_print_options: ps.has_print_options,
        has_page_setup: ps.has_page_setup,
        cell_comments: ps.cell_comments.clone(),
        print_errors: ps.print_errors.clone(),
    }
}

// =============================================================================
// Domain conversions: Page breaks
// =============================================================================

/// Convert parser `PageBreaksOutput` into domain `PageBreaks`.
pub(super) fn convert_page_breaks(pb: &PageBreaksOutput) -> PageBreaks {
    use domain_types::domain::print::PageBreakEntry;
    PageBreaks {
        row_breaks: pb
            .row_breaks
            .iter()
            .map(|b| PageBreakEntry {
                id: b.id,
                min: b.min,
                max: b.max,
                manual: b.man,
                pt: b.pt,
            })
            .collect(),
        col_breaks: pb
            .col_breaks
            .iter()
            .map(|b| PageBreakEntry {
                id: b.id,
                min: b.min,
                max: b.max,
                manual: b.man,
                pt: b.pt,
            })
            .collect(),
    }
}

// =============================================================================
// Domain conversions: Header/footer images
// =============================================================================

/// Extract header/footer images from a sheet's raw VML drawings and resolve
/// image relationship IDs to file paths, producing domain `HeaderFooterImageInfo` entries.
pub(super) fn convert_hf_images(
    sheet: &FullParsedSheet,
) -> Vec<domain_types::domain::print::HeaderFooterImageInfo> {
    use crate::domain::print::hf_images::{parse_hf_images_from_vml, parse_vml_rels_image_targets};
    use domain_types::domain::print::{HeaderFooterImageInfo, HfImagePosition};

    // Identify the comment VML path so we can skip it.
    let comment_vml_path: Option<String> = sheet.legacy_drawing_r_id.as_ref().and_then(|rid| {
        sheet
            .sheet_opc_rels
            .iter()
            .find(|r| r.id == *rid && r.rel_type.ends_with("/vmlDrawing"))
            .map(|r| opc_target_to_zip_path(&r.target, "xl"))
    });

    // Scan non-comment VML drawings for HF image shapes.
    for (path, data, rels) in &sheet.raw_vml_drawings {
        if comment_vml_path.as_deref() == Some(path.as_str()) {
            continue;
        }

        let images = parse_hf_images_from_vml(data);
        if images.is_empty() {
            continue;
        }

        // Parse .rels to get rel_id → target path mapping
        let rels_targets: Vec<(String, String)> = rels
            .as_ref()
            .map(|(_, rels_data)| parse_vml_rels_image_targets(rels_data))
            .unwrap_or_default();
        let rel_map: std::collections::HashMap<&str, &str> = rels_targets
            .iter()
            .map(|(id, target)| (id.as_str(), target.as_str()))
            .collect();

        // Map parser HeaderFooterImage → domain HeaderFooterImageInfo
        let hf_images: Vec<HeaderFooterImageInfo> = images
            .iter()
            .filter_map(|img| {
                let src = rel_map
                    .get(img.image_rel_id.as_str())
                    .map(|t| t.to_string())?;
                let position = match img.position {
                    crate::domain::print::HfImagePosition::LeftHeader => {
                        HfImagePosition::LeftHeader
                    }
                    crate::domain::print::HfImagePosition::CenterHeader => {
                        HfImagePosition::CenterHeader
                    }
                    crate::domain::print::HfImagePosition::RightHeader => {
                        HfImagePosition::RightHeader
                    }
                    crate::domain::print::HfImagePosition::LeftFooter => {
                        HfImagePosition::LeftFooter
                    }
                    crate::domain::print::HfImagePosition::CenterFooter => {
                        HfImagePosition::CenterFooter
                    }
                    crate::domain::print::HfImagePosition::RightFooter => {
                        HfImagePosition::RightFooter
                    }
                };
                Some(HeaderFooterImageInfo {
                    position,
                    src,
                    title: img.title.clone(),
                    width_pt: img.width_pt,
                    height_pt: img.height_pt,
                })
            })
            .collect();

        return hf_images;
    }

    Vec::new()
}

// =============================================================================
// Domain conversions: Conditional formatting
// =============================================================================

/// Convert fully-parsed `ooxml_types::ConditionalFormatting` into domain `ConditionalFormat` items.
/// Preserves complete rule definitions including color scales, data bars, icon sets,
/// cell-is conditions, formula rules, text rules, and all other CF rule types.
///
/// # Typed sqref boundary:
///
/// The `sqref` string is routed through the typed [`compute_parser::SqrefList`]
/// parser rather than naïve `split_whitespace` + per-token range parsing.
/// The typed form drops malformed tokens atomically (a single bad token
/// yields `None`), where the old path would silently keep whichever tokens
/// happened to parse — see [`parse_sqref_to_cf_ranges`] for the explicit
/// empty-on-error contract.
pub(super) fn convert_conditional_formats(
    cfs: &[ooxml_types::cond_format::ConditionalFormatting],
    dxfs: &[ooxml_types::styles::DxfDef],
    theme_colors: &[String],
) -> Vec<ConditionalFormat> {
    cfs.iter()
        .map(|cf| {
            let ranges = parse_sqref_to_cf_ranges(&cf.sqref);
            ConditionalFormat {
                id: make_cf_id(),
                sheet_id: String::new(), // Hydration layer sets the real sheet_id
                pivot: if cf.pivot { Some(true) } else { None },
                ranges,
                range_identities: None,
                rules: cf
                    .rules
                    .iter()
                    .map(|r| convert_cf_rule(r, dxfs, theme_colors))
                    .collect(),
            }
        })
        .collect()
}

/// Generate a deterministic CF/rule identifier.
/// Uses a simple counter-based scheme since the parser doesn't have UUID deps.
/// The hydration layer will assign real UUIDs when needed.
fn make_cf_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    format!("cf-parse-{}", COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// Parse a raw XLSX `sqref` string into a `Vec<CFCellRange>` via
/// [`compute_parser::SqrefList`] (typed sqref boundary typed boundary).
///
/// The canonical in-engine version of this helper lives at
/// `compute::import::parse_output_to_snapshot::cond_format_lowering`; the
/// copy here is mechanical, kept in `xlsx-parser` because that crate cannot
/// depend on `compute-core`. If the helper grows non-trivial logic both
/// copies must stay in sync.
///
/// Behaviour: empty / whitespace-only / fully-malformed input yields an
/// empty vector (no panic). A partially-valid sqref (one good token, one
/// bad) also yields an empty vector — the typed `SqrefList::parse` fails
/// atomically on any token error, which is stricter than the old
/// per-token `filter_map` and surfaces malformed XLSX to the downstream
/// layer instead of silently half-accepting it.
fn parse_sqref_to_cf_ranges(sqref: &str) -> Vec<CFCellRange> {
    compute_parser::SqrefList::parse(sqref)
        .as_ref()
        .map(|list| list.0.iter().filter_map(range_ref_to_cf_range).collect())
        .unwrap_or_default()
}

/// Convert a single [`compute_parser::RangeRef`] into the positional
/// [`CFCellRange`] form. Returns `None` if either corner is already a
/// [`formula_types::CellRef::Resolved`] — that shape is impossible at
/// XLSX-import time but we skip rather than panic.
fn range_ref_to_cf_range(r: &compute_parser::RangeRef) -> Option<CFCellRange> {
    let (start_row, start_col) = match r.start {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    let (end_row, end_col) = match r.end {
        formula_types::CellRef::Positional { row, col, .. } => (row, col),
        formula_types::CellRef::Resolved(_) => return None,
    };
    Some(CFCellRange::new(start_row, start_col, end_row, end_col))
}

/// Resolve an `ooxml_types::styles::ColorDef` to a `#RRGGBB` hex string.
///
/// `theme_colors` is a 12-element palette of resolved hex strings
/// (dk1, lt1, dk2, lt2, accent1..6, hlink, fol_hlink) extracted from the theme.
fn resolve_color_def_to_hex(
    color: &ooxml_types::styles::ColorDef,
    theme_colors: &[String],
) -> Option<String> {
    use ooxml_types::styles::ColorDef;

    /// Parse an AARRGGBB or RRGGBB hex string to (r, g, b).
    fn parse_hex_rgb(s: &str) -> Option<(u8, u8, u8)> {
        let hex = s.strip_prefix('#').unwrap_or(s);
        let rgb_part = if hex.len() == 8 { &hex[2..] } else { hex };
        if rgb_part.len() != 6 {
            return None;
        }
        let r = u8::from_str_radix(&rgb_part[0..2], 16).ok()?;
        let g = u8::from_str_radix(&rgb_part[2..4], 16).ok()?;
        let b = u8::from_str_radix(&rgb_part[4..6], 16).ok()?;
        Some((r, g, b))
    }

    /// Apply ECMA-376 tint to an (r, g, b) tuple, returning the adjusted color.
    fn apply_tint(r: u8, g: u8, b: u8, tint: f64) -> (u8, u8, u8) {
        // Convert to HSL
        let rf = r as f64 / 255.0;
        let gf = g as f64 / 255.0;
        let bf = b as f64 / 255.0;
        let max = rf.max(gf).max(bf);
        let min = rf.min(gf).min(bf);
        let l = (max + min) / 2.0;
        let s = if (max - min).abs() < f64::EPSILON {
            0.0
        } else if l <= 0.5 {
            (max - min) / (max + min)
        } else {
            (max - min) / (2.0 - max - min)
        };
        let h = if (max - min).abs() < f64::EPSILON {
            0.0
        } else if (max - rf).abs() < f64::EPSILON {
            ((gf - bf) / (max - min)).rem_euclid(6.0) * 60.0
        } else if (max - gf).abs() < f64::EPSILON {
            ((bf - rf) / (max - min) + 2.0) * 60.0
        } else {
            ((rf - gf) / (max - min) + 4.0) * 60.0
        };

        // Apply tint per ECMA-376 spec
        let new_l = if tint < 0.0 {
            l * (1.0 + tint)
        } else {
            l * (1.0 - tint) + tint
        }
        .clamp(0.0, 1.0);

        // Convert back to RGB
        let c = (1.0 - (2.0 * new_l - 1.0).abs()) * s;
        let x = c * (1.0 - ((h / 60.0).rem_euclid(2.0) - 1.0).abs());
        let m = new_l - c / 2.0;
        let (r1, g1, b1) = match h as u32 {
            0..=59 => (c, x, 0.0),
            60..=119 => (x, c, 0.0),
            120..=179 => (0.0, c, x),
            180..=239 => (0.0, x, c),
            240..=299 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        (
            ((r1 + m) * 255.0).round() as u8,
            ((g1 + m) * 255.0).round() as u8,
            ((b1 + m) * 255.0).round() as u8,
        )
    }

    /// Resolve and optionally tint a base hex color.
    fn resolve_with_tint(base_hex: &str, tint_str: &Option<String>) -> Option<String> {
        let (r, g, b) = parse_hex_rgb(base_hex)?;
        if let Some(t) = tint_str.as_deref().and_then(|s| s.parse::<f64>().ok()) {
            if t.abs() > f64::EPSILON {
                let (r2, g2, b2) = apply_tint(r, g, b, t);
                return Some(format!("#{:02x}{:02x}{:02x}", r2, g2, b2));
            }
        }
        Some(format!("#{:02x}{:02x}{:02x}", r, g, b))
    }

    match color {
        ColorDef::Rgb { val, tint } => resolve_with_tint(val, tint),
        ColorDef::Theme { id, tint } => {
            let base = theme_colors.get(*id as usize)?;
            resolve_with_tint(base, tint)
        }
        ColorDef::Indexed { id, tint } => {
            // Use the standard Excel indexed color palette
            let rgb = crate::domain::themes::types::Theme::indexed_color(*id as u8)?;
            let base = format!("#{:02x}{:02x}{:02x}", rgb.r, rgb.g, rgb.b);
            resolve_with_tint(&base, tint)
        }
        ColorDef::Auto { .. } => None, // Auto means inherit from context
    }
}

/// Resolve a `DxfDef` (differential formatting record) into a `CFStyle`.
///
/// Extracts font color, background color, bold, italic, strikethrough, underline,
/// and number format from the DXF, resolving theme/indexed colors to hex.
fn resolve_dxf_to_cf_style(
    dxf: &ooxml_types::styles::DxfDef,
    theme_colors: &[String],
    dxf_id: Option<u32>,
) -> CFStyle {
    let font_color = dxf
        .font
        .as_ref()
        .and_then(|f| f.color.as_ref())
        .and_then(|c| resolve_color_def_to_hex(c, theme_colors));

    let background_color = dxf.fill.as_ref().and_then(|fill| {
        use ooxml_types::styles::FillDef;
        match fill {
            FillDef::Solid { fg_color } => resolve_color_def_to_hex(fg_color, theme_colors),
            FillDef::Pattern {
                fg_color, bg_color, ..
            } => {
                // For CF, foreground color of a pattern fill is the cell background
                fg_color
                    .as_ref()
                    .and_then(|c| resolve_color_def_to_hex(c, theme_colors))
                    .or_else(|| {
                        bg_color
                            .as_ref()
                            .and_then(|c| resolve_color_def_to_hex(c, theme_colors))
                    })
            }
            _ => None,
        }
    });

    let bold = dxf.font.as_ref().and_then(|f| f.bold);
    let italic = dxf.font.as_ref().and_then(|f| f.italic);
    let strikethrough = dxf.font.as_ref().and_then(|f| f.strikethrough);
    // CFStyle.underline_type is now the typed ooxml UnderlineStyle; no
    // conversion needed.
    let underline_type = dxf.font.as_ref().and_then(|f| f.underline);
    let number_format = dxf.num_fmt.as_ref().map(|nf| nf.format_code.clone());

    // Resolve border colors from DXF
    let border_color = dxf
        .border
        .as_ref()
        .and_then(|b| {
            // Use the first non-None side color as unified border color
            b.left
                .as_ref()
                .and_then(|s| s.color.as_ref())
                .or_else(|| b.top.as_ref().and_then(|s| s.color.as_ref()))
                .or_else(|| b.right.as_ref().and_then(|s| s.color.as_ref()))
                .or_else(|| b.bottom.as_ref().and_then(|s| s.color.as_ref()))
        })
        .and_then(|c| resolve_color_def_to_hex(c, theme_colors));

    CFStyle {
        background_color,
        font_color,
        bold,
        italic,
        underline_type,
        underline_legacy: None,
        strikethrough,
        number_format,
        border_color,
        border_style: None,
        border_top_color: None,
        border_top_style: None,
        border_bottom_color: None,
        border_bottom_style: None,
        border_left_color: None,
        border_left_style: None,
        border_right_color: None,
        border_right_style: None,
        dxf_id,
    }
}

/// Convert a single `ooxml_types::CfRule` to a `domain_types::CFRule`.
///
/// Resolves the DXF style from the dxf table into inline CFStyle properties
/// (font_color, background_color, bold, etc.) while preserving the dxf_id
/// for round-trip fidelity.
pub(super) fn convert_cf_rule(
    rule: &ooxml_types::cond_format::CfRule,
    dxfs: &[ooxml_types::styles::DxfDef],
    theme_colors: &[String],
) -> CFRule {
    use ooxml_types::cond_format::CfRuleType;

    let id = make_cf_id();
    let priority = rule.priority;
    let stop_if_true = if rule.stop_if_true { Some(true) } else { None };
    // Resolve DXF to inline style properties, preserving dxf_id for round-trip
    let style = match rule.dxf_id {
        Some(idx) => {
            if let Some(dxf) = dxfs.get(idx as usize) {
                resolve_dxf_to_cf_style(dxf, theme_colors, Some(idx))
            } else {
                CFStyle {
                    dxf_id: Some(idx),
                    ..CFStyle::default()
                }
            }
        }
        None => CFStyle::default(),
    };

    match rule.rule_type {
        CfRuleType::CellIs => CFRule::CellValue {
            id,
            operator: rule.operator.unwrap_or_default(),
            value1: rule
                .formulas
                .first()
                .map(|v| serde_json::Value::String(v.clone()))
                .unwrap_or(serde_json::Value::Null),
            value2: rule
                .formulas
                .get(1)
                .map(|v| serde_json::Value::String(v.clone())),
            style,
            priority,
            stop_if_true,
            text: rule.text.clone(),
        },
        CfRuleType::Expression => CFRule::Formula {
            id,
            formula: rule.formulas.first().cloned().unwrap_or_default(),
            style,
            priority,
            stop_if_true,
            text: rule.text.clone(),
        },
        CfRuleType::ColorScale => {
            let color_scale = if let Some(ref cs) = rule.color_scale {
                let points: Vec<CFColorPoint> = cs
                    .cfvo
                    .iter()
                    .zip(cs.colors.iter())
                    .map(|(cfvo, color)| cf_color_point(cfvo, color))
                    .collect();
                let min_point = points.first().cloned().unwrap_or_else(|| CFColorPoint {
                    value: domain_types::CFValueRef::Min,
                    ooxml_value: None,
                    color: String::new(),
                    color_theme: None,
                    color_tint: None,
                    color_indexed: None,
                    color_auto: None,
                });
                let max_point = points.last().cloned().unwrap_or_else(|| CFColorPoint {
                    value: domain_types::CFValueRef::Max,
                    ooxml_value: None,
                    color: String::new(),
                    color_theme: None,
                    color_tint: None,
                    color_indexed: None,
                    color_auto: None,
                });
                let mid_point = if points.len() == 3 {
                    Some(points[1].clone())
                } else {
                    None
                };
                CFColorScale {
                    min_point,
                    mid_point,
                    max_point,
                }
            } else {
                CFColorScale {
                    min_point: CFColorPoint {
                        value: domain_types::CFValueRef::Min,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                    },
                    mid_point: None,
                    max_point: CFColorPoint {
                        value: domain_types::CFValueRef::Max,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                    },
                }
            };
            CFRule::ColorScale {
                id,
                priority,
                stop_if_true,
                color_scale,
            }
        }
        CfRuleType::DataBar => {
            let data_bar = if let Some(ref db) = rule.data_bar {
                let min_cfvo = db.cfvo.first();
                let max_cfvo = db.cfvo.get(1);
                CFDataBar {
                    min_point: CFColorPoint {
                        value: domain_types::CFValueRef::from_ooxml(
                            min_cfvo.map(|c| c.cfvo_type).unwrap_or_default(),
                            min_cfvo.and_then(|c| c.val.as_deref()),
                        ),
                        ooxml_value: min_cfvo.and_then(|c| c.val.clone()),
                        color: String::new(), // data bar min/max color points don't carry color; positive_color does
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                    },
                    max_point: CFColorPoint {
                        value: domain_types::CFValueRef::from_ooxml(
                            max_cfvo.map(|c| c.cfvo_type).unwrap_or_default(),
                            max_cfvo.and_then(|c| c.val.as_deref()),
                        ),
                        ooxml_value: max_cfvo.and_then(|c| c.val.clone()),
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                    },
                    min_length: db.min_length_attr_present.then_some(db.min_length),
                    max_length: db.max_length_attr_present.then_some(db.max_length),
                    positive_color: cf_color_to_rgb(&db.color),
                    show_value: db.show_value_attr_present.then_some(db.show_value),
                    border_color: db.border_color.as_ref().map(cf_color_to_rgb),
                    negative_color: db.negative_fill_color.as_ref().map(cf_color_to_rgb),
                    axis_color: db.axis_color.as_ref().map(cf_color_to_rgb),
                    direction: db.direction_attr_present.then_some(db.direction),
                    gradient: db.gradient_attr_present.then_some(db.gradient),
                    ext_id: rule.ext_id.clone(),
                    show_border: db.border_attr_present.then_some(db.border),
                    axis_position: db.axis_position_attr_present.then_some(db.axis_position),
                    match_positive_fill_color: db
                        .negative_bar_color_same_as_positive_attr_present
                        .then_some(db.negative_bar_color_same_as_positive),
                    match_positive_border_color: db
                        .negative_bar_border_color_same_as_positive_attr_present
                        .then_some(db.negative_bar_border_color_same_as_positive),
                }
            } else {
                CFDataBar {
                    min_point: CFColorPoint {
                        value: domain_types::CFValueRef::Min,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                    },
                    max_point: CFColorPoint {
                        value: domain_types::CFValueRef::Max,
                        ooxml_value: None,
                        color: String::new(),
                        color_theme: None,
                        color_tint: None,
                        color_indexed: None,
                        color_auto: None,
                    },
                    min_length: None,
                    max_length: None,
                    positive_color: String::new(),
                    negative_color: None,
                    border_color: None,
                    show_border: None,
                    gradient: None,
                    direction: None,
                    axis_position: None,
                    axis_color: None,
                    show_value: None,
                    match_positive_fill_color: None,
                    match_positive_border_color: None,
                    ext_id: None,
                }
            };
            CFRule::DataBar {
                id,
                priority,
                stop_if_true,
                data_bar,
            }
        }
        CfRuleType::IconSet => {
            let icon_set = if let Some(ref is) = rule.icon_set {
                CFIconSet {
                    icon_set_name: is.icon_set,
                    reverse_order: if is.reverse { Some(true) } else { None },
                    show_icon_only: if !is.show_value { Some(true) } else { None },
                    thresholds: is
                        .cfvo
                        .iter()
                        .map(|cfvo| CFIconThreshold {
                            value_type: cfvo.cfvo_type,
                            value: cfvo.val.clone(),
                            gte: cfvo.gte,
                        })
                        .collect(),
                    custom_icons: is
                        .cf_icon
                        .iter()
                        .map(|icon| {
                            Some(CFCustomIcon {
                                icon_set: icon.icon_set.to_ooxml().to_string(),
                                icon_id: icon.icon_id,
                            })
                        })
                        .collect(),
                }
            } else {
                CFIconSet {
                    icon_set_name: ooxml_types::cond_format::IconSetType::ThreeTrafficLights1,
                    reverse_order: None,
                    show_icon_only: None,
                    thresholds: Vec::new(),
                    custom_icons: Vec::new(),
                }
            };
            CFRule::IconSet {
                id,
                priority,
                stop_if_true,
                icon_set,
            }
        }
        CfRuleType::Top10 => CFRule::Top10 {
            id,
            rank: rule.rank.unwrap_or(10),
            percent: if rule.percent { Some(true) } else { None },
            bottom: if rule.bottom { Some(true) } else { None },
            style,
            priority,
            stop_if_true,
        },
        CfRuleType::DuplicateValues => CFRule::DuplicateValues {
            id,
            unique: None,
            style,
            priority,
            stop_if_true,
        },
        CfRuleType::UniqueValues => CFRule::DuplicateValues {
            id,
            unique: Some(true),
            style,
            priority,
            stop_if_true,
        },
        CfRuleType::ContainsText
        | CfRuleType::NotContainsText
        | CfRuleType::BeginsWith
        | CfRuleType::EndsWith => {
            use ooxml_types::cond_format::CfOperator;
            // If the XLSX didn't carry an explicit `operator`, derive it from the
            // rule_type (Excel sometimes omits operator on NotContainsText /
            // BeginsWith / EndsWith because the rule_type alone is sufficient).
            let operator = rule.operator.unwrap_or(match rule.rule_type {
                CfRuleType::NotContainsText => CfOperator::NotContains,
                CfRuleType::BeginsWith => CfOperator::BeginsWith,
                CfRuleType::EndsWith => CfOperator::EndsWith,
                _ => CfOperator::ContainsText,
            });
            CFRule::ContainsText {
                id,
                operator,
                text: rule.text.clone().unwrap_or_default(),
                style,
                priority,
                stop_if_true,
                formula: rule.formulas.first().cloned(),
            }
        }
        CfRuleType::ContainsBlanks => CFRule::ContainsBlanks {
            id,
            blanks: true,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::NotContainsBlanks => CFRule::ContainsBlanks {
            id,
            blanks: false,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::ContainsErrors => CFRule::ContainsErrors {
            id,
            errors: true,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::NotContainsErrors => CFRule::ContainsErrors {
            id,
            errors: false,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::TimePeriod => CFRule::TimePeriod {
            id,
            time_period: rule.time_period.unwrap_or_default(),
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
        CfRuleType::AboveAverage => CFRule::AboveAverage {
            id,
            above_average: rule.above_average,
            equal_average: if rule.equal_average { Some(true) } else { None },
            std_dev: rule.std_dev,
            style,
            priority,
            stop_if_true,
            formula: rule.formulas.first().cloned(),
        },
    }
}

/// Extract an RGB hex string from a `CfColor`, falling back to an empty string.
pub(super) fn cf_color_to_rgb(color: &ooxml_types::cond_format::CfColor) -> String {
    color.rgb.clone().unwrap_or_default()
}

/// Build a `CFColorPoint` from a `Cfvo` and `CfColor`, preserving theme/indexed/tint/auto.
fn cf_color_point(
    cfvo: &ooxml_types::cond_format::Cfvo,
    color: &ooxml_types::cond_format::CfColor,
) -> CFColorPoint {
    CFColorPoint {
        value: domain_types::CFValueRef::from_ooxml(cfvo.cfvo_type, cfvo.val.as_deref()),
        ooxml_value: cfvo.val.clone(),
        color: color.rgb.clone().unwrap_or_default(),
        color_theme: color.theme,
        color_tint: color.tint,
        color_indexed: color.indexed,
        color_auto: if color.auto { Some(true) } else { None },
    }
}

// =============================================================================
// Domain conversions: Comment rich text runs
// =============================================================================

/// Convert parser `CommentRunOutput` items into domain `RichTextRun` items.
/// Preserves font properties: bold, italic, underline, strikethrough, color, size, name.
pub(super) fn convert_comment_runs(runs: &[CommentRunOutput]) -> Vec<RichTextRun> {
    runs.iter()
        .map(|r| RichTextRun {
            text: r.text.clone(),
            font_name: r.font_name.clone(),
            font_size: r.font_size,
            bold: r.bold,
            italic: r.italic,
            underline: r.underline,
            strikethrough: r.strike,
            color: r.color.clone(),
            color_indexed: r.color_indexed,
            color_theme: r.color_theme,
            color_tint: r.color_tint,
            charset: r.charset,
            family: r.font_family,
            scheme: r.scheme.clone(),
            vert_align: r.vert_align.clone(),
            preserve_space: r.preserve_space,
        })
        .collect()
}

// =============================================================================
// Domain conversions: Data validations (minimal)
// =============================================================================

/// Convert parser `DvSummary` items into domain `ValidationSpec` items.
/// Captures all validation data including formulas, error/prompt messages.
pub(super) fn convert_data_validations(dvs: &[DvSummary]) -> Vec<ValidationSpec> {
    dvs.iter()
        .map(|dv| {
            let f1 = dv.formula1.clone().unwrap_or_default();
            let f2 = dv.formula2.clone();
            let rule = match dv.validation_type.as_str() {
                "list" => ValidationRule::List {
                    formula1: f1,
                    show_dropdown: dv.show_dropdown,
                },
                "whole" => ValidationRule::WholeNumber {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "decimal" => ValidationRule::Decimal {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "date" => ValidationRule::Date {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "time" => ValidationRule::Time {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "textLength" => ValidationRule::TextLength {
                    operator: ValidationOperator::from_str_lossy(&dv.operator),
                    formula1: f1,
                    formula2: f2,
                },
                "custom" => ValidationRule::Custom { formula1: f1 },
                _ => ValidationRule::None { formula1: f1 },
            };
            ValidationSpec {
                ranges: dv
                    .sqref
                    .split_whitespace()
                    .filter(|s| !s.trim().is_empty() && !s.eq_ignore_ascii_case("#REF!"))
                    .map(String::from)
                    .collect(),
                rule,
                error_style: if dv.error_style.is_empty() {
                    ErrorStyle::Stop
                } else {
                    ErrorStyle::from_str_lossy(&dv.error_style)
                },
                show_error: dv.show_error,
                error_title: dv.error_title.clone(),
                error_message: dv.error_message.clone(),
                show_prompt: dv.show_input,
                prompt_title: dv.prompt_title.clone(),
                prompt_message: dv.prompt_message.clone(),
                allow_blank: dv.allow_blank,
                ime_mode: domain_types::ImeMode::from_str_lossy(&dv.ime_mode),
                uid: dv.uid.clone(),
            }
        })
        .collect()
}

// =============================================================================
// Domain conversions: Data table regions
// =============================================================================

/// Convert parser `DataTableInfo` items (per-sheet) into domain `DataTableRegion` items.
///
/// Typed data-table input refs: input refs are typed `Option<CellRef>` on both sides — this
/// is a pure structural copy plus the r1/r2 swap. No string round-trip; the
/// lowering boundary is stateless.
pub(super) fn convert_data_tables(
    tables: &[DataTableInfo],
    sheet_index: u32,
) -> Vec<DataTableRegion> {
    tables
        .iter()
        .map(|dt| DataTableRegion {
            sheet_index,
            start_row: dt.start_row,
            start_col: dt.start_col,
            end_row: dt.end_row,
            end_col: dt.end_col,
            // Excel's naming is inverted: r1 ("row input cell") receives top-row
            // (col-varying) values, r2 ("column input cell") receives left-column
            // (row-varying) values. Swap here so downstream semantics are correct.
            row_input_ref: dt.col_input_ref,
            col_input_ref: dt.row_input_ref,
            ooxml_flags: dt.ooxml_flags.clone(),
        })
        .collect()
}

// =============================================================================
// Domain conversions: Floating objects (from parsed drawings)
// =============================================================================

/// EMUs per pixel at 96 DPI (standard screen resolution).
const EMUS_PER_PIXEL: i64 = 9525;

fn resolve_media_data_url(
    media_data_urls: &HashMap<String, String>,
    target: &str,
) -> Option<String> {
    if let Some(data_url) = media_data_urls.get(target) {
        return Some(data_url.clone());
    }

    let normalized = target.replace('\\', "/");
    if let Some(data_url) = media_data_urls.get(&normalized) {
        return Some(data_url.clone());
    }

    if let Some(stripped) = normalized.strip_prefix("../") {
        let workbook_relative = format!("xl/{stripped}");
        if let Some(data_url) = media_data_urls.get(&workbook_relative) {
            return Some(data_url.clone());
        }
    }

    if normalized.starts_with("media/") {
        let workbook_relative = format!("xl/{normalized}");
        if let Some(data_url) = media_data_urls.get(&workbook_relative) {
            return Some(data_url.clone());
        }
    }

    normalized
        .rsplit('/')
        .next()
        .and_then(|file_name| media_data_urls.get(file_name).cloned())
}

/// Convert parsed drawing anchors into unified `FloatingObject` items.
///
/// Extracts pictures and shapes from the parser's structured `Drawing` type.
/// Charts, connectors, SmartArt, and graphic frames are handled by their own
/// dedicated conversion paths and are skipped here to avoid double-counting.
pub(super) fn convert_floating_objects(
    drawing: Option<&Drawing>,
    media_data_urls: &HashMap<String, String>,
) -> Vec<FloatingObject> {
    let drawing = match drawing {
        Some(d) => d,
        None => return Vec::new(),
    };

    let mut objects = Vec::new();

    for (idx, anchor) in drawing.anchors.iter().enumerate() {
        let (fobj_anchor, extent_emu, content, client_data, anchor_edit_as) = match anchor {
            DrawingAnchor::TwoCell(tc) => {
                let a = FloatingObjectAnchor {
                    anchor_row: tc.from.row,
                    anchor_col: tc.from.col,
                    anchor_row_offset: tc.from.row_off,
                    anchor_col_offset: tc.from.col_off,
                    anchor_mode: tc
                        .edit_as
                        .as_ref()
                        .map(|e| match e.to_ooxml() {
                            "oneCell" => AnchorMode::OneCell,
                            "absolute" => AnchorMode::Absolute,
                            _ => AnchorMode::TwoCell,
                        })
                        .unwrap_or(AnchorMode::TwoCell),
                    end_row: Some(tc.to.row),
                    end_col: Some(tc.to.col),
                    end_row_offset: Some(tc.to.row_off),
                    end_col_offset: Some(tc.to.col_off),
                    extent_cx: None,
                    extent_cy: None,
                };
                let ea = tc.edit_as.as_ref().map(|e| e.to_ooxml().to_string());
                (a, None, &tc.content, &tc.client_data, ea)
            }
            DrawingAnchor::OneCell(oc) => {
                let a = FloatingObjectAnchor {
                    anchor_row: oc.from.row,
                    anchor_col: oc.from.col,
                    anchor_row_offset: oc.from.row_off,
                    anchor_col_offset: oc.from.col_off,
                    anchor_mode: AnchorMode::OneCell,
                    end_row: None,
                    end_col: None,
                    end_row_offset: None,
                    end_col_offset: None,
                    extent_cx: Some(oc.extent.cx),
                    extent_cy: Some(oc.extent.cy),
                };
                (
                    a,
                    Some((oc.extent.cx, oc.extent.cy)),
                    &oc.content,
                    &oc.client_data,
                    None,
                )
            }
            DrawingAnchor::Absolute(_) => {
                continue;
            }
        };

        // Collect anchor-level bookkeeping that applies to all object types.
        let mc_alt_raw = if let DrawingAnchor::TwoCell(tc) = anchor {
            tc.mc_alternate_content
                .as_ref()
                .map(|mc| mc.raw_xml.clone())
        } else {
            None
        };
        let cd_locks = if !client_data.locks_with_sheet {
            Some(false)
        } else {
            None
        };
        let cd_prints = if !client_data.prints_with_sheet {
            Some(false)
        } else {
            None
        };

        // Build per-type data and extract common metadata from drawing content.
        let (data, name, rotation, flip_h, flip_v, locked, visible) = match content {
            DrawingContent::Picture(pic) => {
                let nv = &pic.nv_pic_pr.c_nv_pr;
                let xfrm = pic.sp_pr.xfrm.as_ref();
                let rot = xfrm
                    .and_then(|t| t.rotation)
                    .map(|a| a.value() as f64 / 60_000.0)
                    .unwrap_or(0.0);
                let fh = xfrm.and_then(|t| t.flip_h).unwrap_or(false);
                let fv = xfrm.and_then(|t| t.flip_v).unwrap_or(false);
                // Extract image relationship info
                let embed_id = pic.blip_fill.embed_id.as_deref().unwrap_or("rId1");
                let image_path = drawing
                    .opc_rels
                    .iter()
                    .find(|r| r.id == embed_id)
                    .map(|r| r.target.clone());

                // Build typed ooxml props — no more JSON blob!
                let ooxml_props = PictureOoxmlProps {
                    picture: pic.clone(),
                    anchor_index: Some(idx as i32),
                    extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                    extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                    edit_as: anchor_edit_as.clone(),
                    client_data_locks_with_sheet: cd_locks,
                    client_data_prints_with_sheet: cd_prints,
                    mc_alternate_content_raw_xml: mc_alt_raw.clone(),
                    image_path: image_path.clone(),
                };

                let src = image_path
                    .as_deref()
                    .and_then(|path| resolve_media_data_url(media_data_urls, path))
                    .unwrap_or_else(|| image_path.clone().unwrap_or_default());
                let data = FloatingObjectData::Picture(PictureData {
                    src,
                    original_width: None,
                    original_height: None,
                    crop: None,
                    adjustments: None,
                    border: None,
                    color_type: None,
                    ooxml: Some(ooxml_props),
                });
                (
                    data,
                    Some(nv.name.clone()),
                    rot,
                    fh,
                    fv,
                    pic.nv_pic_pr.locks.no_move,
                    !nv.hidden,
                )
            }
            DrawingContent::Shape(shp) => {
                let nv = &shp.nv_sp_pr.c_nv_pr;
                let xfrm = shp.sp_pr.xfrm.as_ref();
                let rot = xfrm
                    .and_then(|t| t.rotation)
                    .map(|a| a.value() as f64 / 60_000.0)
                    .unwrap_or(0.0);
                let fh = xfrm.and_then(|t| t.flip_h).unwrap_or(false);
                let fv = xfrm.and_then(|t| t.flip_v).unwrap_or(false);

                // Build typed ooxml props — no more JSON blob!
                let shape_ooxml = ShapeOoxmlProps {
                    shape: shp.clone(),
                    anchor_index: Some(idx as i32),
                    extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                    extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                    edit_as: anchor_edit_as.clone(),
                    client_data_locks_with_sheet: cd_locks,
                    client_data_prints_with_sheet: cd_prints,
                    mc_alternate_content_raw_xml: mc_alt_raw.clone(),
                    group_shape: None,
                };

                // Extract preset type for shape_type field
                let preset_type = shp
                    .sp_pr
                    .geometry
                    .as_ref()
                    .and_then(|g| match g {
                        ooxml_types::drawings::ShapeGeometry::Preset(pg) => {
                            Some(pg.prst.to_ooxml().to_string())
                        }
                        _ => None,
                    })
                    .unwrap_or_else(|| "rect".to_string());

                // Determine if this is a textbox
                let is_textbox = shp.nv_sp_pr.tx_box;

                let text_content = shp.tx_body.as_ref().and_then(|tb| {
                    let text: String = tb
                        .paragraphs
                        .iter()
                        .map(|p| {
                            p.runs
                                .iter()
                                .filter_map(|r| match r {
                                    ooxml_types::drawings::TextRunContent::Run(run) => {
                                        Some(run.text.as_str())
                                    }
                                    _ => None,
                                })
                                .collect::<Vec<_>>()
                                .join("")
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    if text.is_empty() { None } else { Some(text) }
                });

                let data = if is_textbox {
                    FloatingObjectData::Textbox(
                        domain_types::domain::floating_object::TextboxData {
                            text: text_content.map(|c| {
                                domain_types::domain::floating_object::ShapeText {
                                    content: c,
                                    format: None,
                                    runs: None,
                                    vertical_align: None,
                                    horizontal_align: None,
                                    margins: None,
                                    auto_size: None,
                                    orientation: None,
                                    reading_order: None,
                                    horizontal_overflow: None,
                                    vertical_overflow: None,
                                    text_body: None,
                                }
                            }),
                            fill: None,
                            border: None,
                            text_effects: None,
                            ooxml: Some(shape_ooxml),
                        },
                    )
                } else {
                    FloatingObjectData::Shape(ShapeData {
                        shape_type: preset_type,
                        fill: None,
                        outline: None,
                        text: text_content.map(|t| {
                            domain_types::domain::floating_object::ShapeText {
                                content: t,
                                format: None,
                                runs: None,
                                vertical_align: None,
                                horizontal_align: None,
                                margins: None,
                                auto_size: None,
                                orientation: None,
                                reading_order: None,
                                horizontal_overflow: None,
                                vertical_overflow: None,
                                text_body: None,
                            }
                        }),
                        shadow: None,
                        adjustments: None,
                        scene_3d: None,
                        sp_3d: None,
                        ooxml: Some(shape_ooxml),
                    })
                };
                (
                    data,
                    Some(nv.name.clone()),
                    rot,
                    fh,
                    fv,
                    shp.nv_sp_pr.c_nv_sp_pr.no_move,
                    !nv.hidden,
                )
            }
            DrawingContent::GroupShape(grp) => {
                // Carry the full CT_GroupShape payload so children and
                // properties survive the round-trip through the unified
                // FloatingObject model. Typed replacement for the former
                // `group_json: Option<serde_json::Value>` blob.
                let group_ooxml = ShapeOoxmlProps {
                    shape: ooxml_types::drawings::SpreadsheetShape::default(),
                    anchor_index: Some(idx as i32),
                    extent_emu_cx: extent_emu.map(|(cx, _)| cx),
                    extent_emu_cy: extent_emu.map(|(_, cy)| cy),
                    edit_as: anchor_edit_as.clone(),
                    client_data_locks_with_sheet: cd_locks,
                    client_data_prints_with_sheet: cd_prints,
                    mc_alternate_content_raw_xml: mc_alt_raw.clone(),
                    group_shape: Some(grp.clone()),
                };
                let data = FloatingObjectData::Shape(ShapeData {
                    shape_type: "group".to_string(),
                    fill: None,
                    outline: None,
                    text: None,
                    shadow: None,
                    adjustments: None,
                    scene_3d: None,
                    sp_3d: None,
                    ooxml: Some(group_ooxml),
                });
                (data, None, 0.0, false, false, false, true)
            }
            // Charts, connectors, graphic frames, SmartArt, and unknown content
            // are handled by their own dedicated conversions.
            _ => continue,
        };

        let (width, height) = match extent_emu {
            Some((cx, cy)) => (
                (cx as f64 / EMUS_PER_PIXEL as f64).max(0.0),
                (cy as f64 / EMUS_PER_PIXEL as f64).max(0.0),
            ),
            None => (0.0, 0.0),
        };

        objects.push(FloatingObject {
            common: FloatingObjectCommon {
                id: format!("fobj-{}", idx),
                sheet_id: String::new(),
                anchor: fobj_anchor,
                width,
                height,
                z_index: idx as i32,
                rotation,
                flip_h,
                flip_v,
                locked,
                visible,
                printable: true,
                opacity: 1.0,
                name: name.filter(|n| !n.is_empty()).unwrap_or_default(),
                created_at: 0,
                updated_at: 0,
                group_id: None,
                anchor_cell_id: None,
                to_anchor_cell_id: None,
                lock_aspect_ratio: None,
                alt_text_title: None,
                display_name: None,
                import_status: None,
            },
            data,
        });
    }

    objects
}

// =============================================================================
// Domain conversions: Sparklines
// =============================================================================

/// Convert parser `SparklineGroup` items into domain `Sparkline` and `SparklineGroup` items.
///
/// Each OOXML `SparklineGroup` may contain multiple sparkline entries that share
/// the same visual settings. We produce:
/// - A flat list of `DtSparkline` values (one per entry, with numeric coordinates)
/// - A list of `DtSparklineGroup` values preserving group structure
///
/// A1 cell references are parsed into 0-based numeric `(row, col)` coordinates
/// using the parser's existing `parse_a1_cell` utility.
pub(super) fn convert_sparkline_groups(
    groups: &[SparklineGroup],
    sheet_id: &str,
) -> (Vec<DtSparkline>, Vec<DtSparklineGroup>) {
    let mut sparklines = Vec::new();
    let mut sparkline_groups = Vec::new();
    let mut global_idx: usize = 0;

    for (group_idx, g) in groups.iter().enumerate() {
        let group_id = format!("group-{group_idx}");
        let sparkline_type = convert_sparkline_type(&g.sparkline_type);
        let visual = build_visual_settings(g);
        let axis = build_axis_settings(g);

        let mut sparkline_ids = Vec::with_capacity(g.sparklines.len());

        for entry in &g.sparklines {
            let spark_id = format!("sparkline-{global_idx}");
            global_idx += 1;

            let (cell_row, cell_col) = parse_sparkline_cell_ref(&entry.location);
            let data_range = parse_sparkline_range(&entry.data_range);

            sparklines.push(DtSparkline {
                id: spark_id.clone(),
                sheet_id: sheet_id.to_string(),
                cell: SparklineCellAddress {
                    sheet_id: sheet_id.to_string(),
                    row: cell_row,
                    col: cell_col,
                },
                data_range,
                sparkline_type: sparkline_type.clone(),
                data_in_rows: false, // OOXML default; no per-group attribute for this
                group_id: Some(group_id.clone()),
                visual: visual.clone(),
                axis: axis.clone(),
                created_at: None,
                updated_at: None,
            });

            sparkline_ids.push(spark_id);
        }

        sparkline_groups.push(DtSparklineGroup {
            id: group_id,
            sheet_id: sheet_id.to_string(),
            sparkline_ids,
            sparkline_type,
            visual,
            axis,
            created_at: None,
            updated_at: None,
        });
    }

    (sparklines, sparkline_groups)
}

/// Map OOXML `SparklineType` to domain `SparklineType`.
fn convert_sparkline_type(ooxml: &ooxml_types::sparklines::SparklineType) -> DtSparklineType {
    match ooxml {
        ooxml_types::sparklines::SparklineType::Line => DtSparklineType::Line,
        ooxml_types::sparklines::SparklineType::Column => DtSparklineType::Column,
        ooxml_types::sparklines::SparklineType::WinLoss => DtSparklineType::WinLoss,
    }
}

/// Build `SparklineVisualSettings` from an OOXML `SparklineGroup`.
fn build_visual_settings(g: &SparklineGroup) -> SparklineVisualSettings {
    SparklineVisualSettings {
        color: sparkline_color_to_hex(&g.color_series).unwrap_or_default(),
        negative_color: sparkline_color_to_hex(&g.color_negative),
        show_markers: if g.markers { Some(true) } else { None },
        marker_color: sparkline_color_to_hex(&g.color_markers),
        high_point_color: if g.high {
            sparkline_color_to_hex(&g.color_high)
        } else {
            None
        },
        low_point_color: if g.low {
            sparkline_color_to_hex(&g.color_low)
        } else {
            None
        },
        first_point_color: if g.first {
            sparkline_color_to_hex(&g.color_first)
        } else {
            None
        },
        last_point_color: if g.last {
            sparkline_color_to_hex(&g.color_last)
        } else {
            None
        },
        line_weight: g.line_weight,
        column_gap: None,
        bar_gap: None,
    }
}

/// Build `SparklineAxisSettings` from an OOXML `SparklineGroup`.
fn build_axis_settings(g: &SparklineGroup) -> SparklineAxisSettings {
    use ooxml_types::sparklines::SparklineAxisType;

    let min_value = match g.min_axis_type {
        SparklineAxisType::Individual => AxisBound::Label(AxisBoundLabel::Auto),
        SparklineAxisType::Group => AxisBound::Label(AxisBoundLabel::Same),
        SparklineAxisType::Custom => match g.manual_min {
            Some(v) => AxisBound::Value(v),
            None => AxisBound::Label(AxisBoundLabel::Auto),
        },
    };
    let max_value = match g.max_axis_type {
        SparklineAxisType::Individual => AxisBound::Label(AxisBoundLabel::Auto),
        SparklineAxisType::Group => AxisBound::Label(AxisBoundLabel::Same),
        SparklineAxisType::Custom => match g.manual_max {
            Some(v) => AxisBound::Value(v),
            None => AxisBound::Label(AxisBoundLabel::Auto),
        },
    };

    let display_empty_cells = match g.display_empty_cells_as {
        ooxml_types::sparklines::DisplayEmptyCellsAs::Gap => EmptyCellDisplay::Gaps,
        ooxml_types::sparklines::DisplayEmptyCellsAs::Zero => EmptyCellDisplay::Zero,
        ooxml_types::sparklines::DisplayEmptyCellsAs::Span => EmptyCellDisplay::Connect,
    };

    SparklineAxisSettings {
        min_value,
        max_value,
        show_axis: if g.display_x_axis { Some(true) } else { None },
        axis_color: sparkline_color_to_hex(&g.color_axis),
        display_empty_cells,
        right_to_left: if g.right_to_left { Some(true) } else { None },
    }
}

// =============================================================================
// A1 reference parsing helpers for sparkline cell/range references
// =============================================================================

/// Parse a sparkline cell reference like `"B2"` or `"Sheet1!B2"` into 0-based `(row, col)`.
///
/// Strips any sheet prefix (everything before and including `!`), then delegates
/// to the parser's `parse_a1_cell` utility.
fn parse_sparkline_cell_ref(cell_ref: &str) -> (u32, u32) {
    let cell_part = cell_ref.rsplit('!').next().unwrap_or(cell_ref);
    crate::infra::a1::parse_a1_cell(cell_part).unwrap_or((0, 0))
}

/// Parse a sparkline data range like `"Sheet1!A1:A10"` into a `SparklineDataRange`.
///
/// Strips any sheet prefix, splits on `:`, and parses each cell reference.
/// For single-cell references (no `:`), start and end are the same cell.
fn parse_sparkline_range(range_ref: &str) -> SparklineDataRange {
    let range_part = range_ref.rsplit('!').next().unwrap_or(range_ref);
    let parts: Vec<&str> = range_part.split(':').collect();
    let (start_row, start_col) = crate::infra::a1::parse_a1_cell(parts[0]).unwrap_or((0, 0));
    let (end_row, end_col) = if parts.len() > 1 {
        crate::infra::a1::parse_a1_cell(parts[1]).unwrap_or((start_row, start_col))
    } else {
        (start_row, start_col)
    };
    SparklineDataRange {
        start_row,
        start_col,
        end_row,
        end_col,
    }
}

/// Extract a hex color string from an optional `SparklineColor`.
pub(super) fn sparkline_color_to_hex(
    color: &Option<crate::domain::sparklines::read::SparklineColor>,
) -> Option<String> {
    color.as_ref().and_then(|c| {
        if let Some(ref rgb) = c.rgb {
            // Parser stores ARGB (e.g. "FF376092"), strip alpha prefix if 8 chars
            if rgb.len() == 8 {
                Some(format!("#{}", &rgb[2..]))
            } else {
                Some(format!("#{rgb}"))
            }
        } else {
            // Theme-based color — would need theme resolution, return None for now
            None
        }
    })
}

// =============================================================================
// Domain conversions: Outline groups
// =============================================================================

/// Compute `OutlineGroup` entries from row heights and column widths.
///
/// Outline groups in OOXML are encoded implicitly: each row/column has an
/// `outline_level` (0-7) and a `collapsed` flag. We scan for consecutive runs
/// of rows/columns at each level and emit one `OutlineGroup` per run.
///
/// Level 0 means "not in any group" and is skipped.
pub(super) fn compute_outline_groups(
    row_heights: &[RowHeight],
    col_widths: &[ColWidth],
) -> Vec<OutlineGroup> {
    let mut groups = Vec::new();

    // --- Row outline groups ---
    // Sort by row index to ensure consecutive grouping
    let mut row_entries: Vec<(u32, u8, bool, bool)> = row_heights
        .iter()
        .filter_map(|rh| {
            let level = rh.outline_level.unwrap_or(0);
            if level == 0 {
                return None;
            }
            let collapsed = rh.collapsed.unwrap_or(false);
            let hidden = rh.hidden.unwrap_or(false);
            Some((rh.row, level, collapsed, hidden))
        })
        .collect();
    row_entries.sort_by_key(|&(row, ..)| row);

    collect_outline_runs(&row_entries, true, &mut groups);

    // --- Column outline groups ---
    // ColWidth spans a range (min..=max, 1-indexed), expand each range entry
    let mut col_entries: Vec<(u32, u8, bool, bool)> = Vec::new();
    for cw in col_widths {
        let level = cw.outline_level.unwrap_or(0);
        if level == 0 {
            continue;
        }
        let collapsed = cw.collapsed;
        let hidden = cw.hidden;
        // min/max are 1-indexed in OOXML, convert to 0-indexed
        let start = cw.min.saturating_sub(1);
        let end = cw.max.saturating_sub(1);
        for col in start..=end {
            col_entries.push((col, level, collapsed, hidden));
        }
    }
    col_entries.sort_by_key(|&(col, ..)| col);
    col_entries.dedup_by_key(|entry| entry.0); // deduplicate in case of overlapping ranges

    collect_outline_runs(&col_entries, false, &mut groups);

    // In OOXML, the `collapsed` attribute typically goes on the row/col AFTER
    // the outline group end, not on the group members themselves. Scan all
    // rows/cols for `collapsed=true` and mark the matching outline group.
    // When collapsed comes from this path, `collapsed_on_member` stays false
    // (meaning the writer should put collapsed on `end + 1`).
    for cw in col_widths {
        if cw.collapsed {
            let collapsed_col_0 = cw.min.saturating_sub(1); // 0-indexed
            if collapsed_col_0 > 0 {
                let group_end = collapsed_col_0 - 1;
                for g in groups.iter_mut() {
                    if !g.is_row && g.end == group_end {
                        g.collapsed = true;
                        g.collapsed_on_member = false;
                    }
                }
            }
        }
    }
    for rh in row_heights {
        if rh.collapsed == Some(true) {
            let collapsed_row = rh.row;
            if collapsed_row > 0 {
                let group_end = collapsed_row - 1;
                for g in groups.iter_mut() {
                    if g.is_row && g.end == group_end {
                        g.collapsed = true;
                        g.collapsed_on_member = false;
                    }
                }
            }
        }
    }

    groups
}

/// Collect consecutive runs of items at the same outline level into `OutlineGroup`s.
///
/// Items must be pre-sorted by index. A run breaks when:
/// - The level changes
/// - The index is not consecutive (gap > 1)
///
/// Each level gets its own groups — level 2 rows inside a level 1 range
/// become separate OutlineGroup entries (the caller can reconstruct hierarchy
/// from the level field).
fn collect_outline_runs(
    entries: &[(u32, u8, bool, bool)], // (index, level, collapsed, hidden)
    is_row: bool,
    groups: &mut Vec<OutlineGroup>,
) {
    if entries.is_empty() {
        return;
    }

    let mut start = entries[0].0;
    let mut end = entries[0].0;
    let mut level = entries[0].1;
    let mut collapsed = entries[0].2;
    let mut hidden = entries[0].3;

    for &(idx, lv, col, hid) in &entries[1..] {
        if lv == level && idx == end + 1 && col == collapsed && hid == hidden {
            // Extend current run (same level, consecutive, same collapsed & hidden state)
            end = idx;
        } else {
            // Emit previous run.  When collapsed was detected from a group
            // member (outlineLevel > 0), mark `collapsed_on_member = true` so
            // the writer places the attribute on `end` instead of `end + 1`.
            groups.push(OutlineGroup {
                is_row,
                start,
                end,
                level: level as u32,
                collapsed,
                hidden,
                collapsed_on_member: collapsed,
            });
            // Start new run
            start = idx;
            end = idx;
            level = lv;
            collapsed = col;
            hidden = hid;
        }
    }
    // Emit final run
    groups.push(OutlineGroup {
        is_row,
        start,
        end,
        level: level as u32,
        collapsed,
        hidden,
        collapsed_on_member: collapsed,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::drawings::{CellAnchor, ClientData, Extent, OneCellAnchor};
    use crate::output::results::FullParsedSheet;
    use domain_types::CFRule;
    use ooxml_types::cond_format::{
        CfColor, CfRule as OoxmlCfRule, CfRuleType, Cfvo, CfvoType, DataBar, DataBarAxisPosition,
        DataBarDirection,
    };

    fn fallback_chart_spec() -> ChartSpec {
        build_fallback_chart_spec(
            &crate::domain::charts::Chart::default(),
            0,
            &FullParsedSheet::default(),
        )
    }

    fn data_bar_rule(data_bar: DataBar) -> OoxmlCfRule {
        OoxmlCfRule {
            rule_type: CfRuleType::DataBar,
            priority: 1,
            data_bar: Some(data_bar),
            ..Default::default()
        }
    }

    fn basic_ooxml_data_bar() -> DataBar {
        DataBar {
            cfvo: vec![
                Cfvo {
                    cfvo_type: CfvoType::Min,
                    val: None,
                    gte: true,
                },
                Cfvo {
                    cfvo_type: CfvoType::Max,
                    val: None,
                    gte: true,
                },
            ],
            color: CfColor {
                rgb: Some("FF638EC6".to_string()),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    #[test]
    fn data_bar_defaults_absent_stay_absent_in_domain() {
        let rule = data_bar_rule(basic_ooxml_data_bar());
        let converted = convert_cf_rule(&rule, &[], &[]);

        let CFRule::DataBar { data_bar, .. } = converted else {
            panic!("expected data bar rule");
        };
        assert_eq!(data_bar.min_length, None);
        assert_eq!(data_bar.max_length, None);
        assert_eq!(data_bar.show_value, None);
        assert_eq!(data_bar.gradient, None);
        assert_eq!(data_bar.direction, None);
        assert_eq!(data_bar.axis_position, None);
        assert_eq!(data_bar.show_border, None);
        assert_eq!(data_bar.match_positive_fill_color, None);
        assert_eq!(data_bar.match_positive_border_color, None);
    }

    #[test]
    fn data_bar_explicit_default_attrs_stay_explicit_in_domain() {
        let mut data_bar = basic_ooxml_data_bar();
        data_bar.min_length_attr_present = true;
        data_bar.max_length_attr_present = true;
        data_bar.show_value_attr_present = true;
        data_bar.gradient_attr_present = true;
        data_bar.border_attr_present = true;
        data_bar.direction_attr_present = true;
        data_bar.negative_bar_color_same_as_positive_attr_present = true;
        data_bar.negative_bar_border_color_same_as_positive_attr_present = true;
        data_bar.axis_position_attr_present = true;
        data_bar.border = false;
        data_bar.direction = DataBarDirection::Context;
        data_bar.negative_bar_color_same_as_positive = true;
        data_bar.negative_bar_border_color_same_as_positive = false;
        data_bar.axis_position = DataBarAxisPosition::Automatic;

        let converted = convert_cf_rule(&data_bar_rule(data_bar), &[], &[]);

        let CFRule::DataBar { data_bar, .. } = converted else {
            panic!("expected data bar rule");
        };
        assert_eq!(data_bar.min_length, Some(10));
        assert_eq!(data_bar.max_length, Some(90));
        assert_eq!(data_bar.show_value, Some(true));
        assert_eq!(data_bar.gradient, Some(true));
        assert_eq!(data_bar.show_border, Some(false));
        assert_eq!(data_bar.direction, Some(DataBarDirection::Context));
        assert_eq!(data_bar.match_positive_fill_color, Some(true));
        assert_eq!(data_bar.match_positive_border_color, Some(false));
        assert_eq!(data_bar.axis_position, Some(DataBarAxisPosition::Automatic));
    }

    #[test]
    fn data_bar_min_max_cfvo_val_is_preserved_for_roundtrip() {
        let mut data_bar = basic_ooxml_data_bar();
        data_bar.cfvo[0].val = Some("0".to_string());
        data_bar.cfvo[1].val = Some("0".to_string());

        let converted = convert_cf_rule(&data_bar_rule(data_bar), &[], &[]);

        let CFRule::DataBar { data_bar, .. } = converted else {
            panic!("expected data bar rule");
        };
        assert_eq!(data_bar.min_point.value, domain_types::CFValueRef::Min);
        assert_eq!(data_bar.min_point.ooxml_value.as_deref(), Some("0"));
        assert_eq!(data_bar.max_point.value, domain_types::CFValueRef::Max);
        assert_eq!(data_bar.max_point.ooxml_value.as_deref(), Some("0"));
    }

    #[test]
    fn chart_ref_extent_uses_one_cell_anchor_extent_not_graphic_frame_extent() {
        let mut spec = fallback_chart_spec();
        spec.position = AnchorPosition {
            anchor_row: 3,
            anchor_col: 8,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: None,
            end_col: None,
            end_row_offset: None,
            end_col_offset: None,
            extent_cx: Some(4_699_001),
            extent_cy: Some(3_260_722),
        };
        spec.xfrm_ext_cx = 0;
        spec.xfrm_ext_cy = 0;

        assert_eq!(chart_ref_extent_from_spec(&spec), (4_699_001, 3_260_722));
    }

    #[test]
    fn chart_ref_extent_keeps_two_cell_graphic_frame_extent() {
        let mut spec = fallback_chart_spec();
        spec.position = AnchorPosition {
            anchor_row: 3,
            anchor_col: 8,
            anchor_row_offset: 0,
            anchor_col_offset: 0,
            end_row: Some(18),
            end_col: Some(16),
            end_row_offset: Some(0),
            end_col_offset: Some(0),
            extent_cx: Some(4_699_001),
            extent_cy: Some(3_260_722),
        };
        spec.xfrm_ext_cx = 1_234;
        spec.xfrm_ext_cy = 5_678;

        assert_eq!(chart_ref_extent_from_spec(&spec), (1_234, 5_678));
    }

    #[test]
    fn chart_frames_by_relationship_target_uses_normalized_chart_part_identity() {
        let frames = vec![
            (
                AnchorPosition {
                    anchor_row: 75,
                    anchor_col: 2,
                    anchor_row_offset: 65_607,
                    anchor_col_offset: 194_224,
                    end_row: Some(92),
                    end_col: Some(8),
                    end_row_offset: Some(63_507),
                    end_col_offset: Some(381_274),
                    extent_cx: None,
                    extent_cy: None,
                },
                ChartDrawingFrameOoxmlProps {
                    relationship_target: Some("../charts/chart8.xml".to_string()),
                    anchor_index: Some(8),
                    ..Default::default()
                },
            ),
            (
                AnchorPosition {
                    anchor_row: 101,
                    anchor_col: 2,
                    anchor_row_offset: 137_697,
                    anchor_col_offset: 578_704,
                    end_row: Some(109),
                    end_col: Some(9),
                    end_row_offset: Some(103_247),
                    end_col_offset: Some(558_992),
                    extent_cx: None,
                    extent_cy: None,
                },
                ChartDrawingFrameOoxmlProps {
                    relationship_target: Some("../charts/chart9.xml".to_string()),
                    anchor_index: Some(9),
                    ..Default::default()
                },
            ),
        ];

        let by_target = chart_frames_by_relationship_target(&frames);

        let (chart9_position, chart9_frame) = by_target
            .get("xl/charts/chart9.xml")
            .expect("chart9 frame should be keyed by normalized OPC target");
        assert_eq!(chart9_position.anchor_row, 101);
        assert_eq!(chart9_position.anchor_col_offset, 578_704);
        assert_eq!(chart9_frame.anchor_index, Some(9));
    }

    #[test]
    fn chart_ex_one_cell_anchor_position_preserves_extent() {
        let anchor = DrawingAnchor::OneCell(OneCellAnchor {
            from: CellAnchor {
                col: 8,
                row: 3,
                col_off: 11,
                row_off: 22,
            },
            extent: Extent {
                cx: 4_699_001,
                cy: 3_260_722,
            },
            content: DrawingContent::GraphicFrame(ooxml_types::drawings::SpreadsheetGraphicFrame {
                graphic_xml: Some(
                    "http://schemas.microsoft.com/office/drawing/2014/chartex".into(),
                ),
                ..Default::default()
            }),
            client_data: ClientData::default(),
            mc_alternate_content: None,
        });

        let pos = chart_ex_anchor_position(&anchor).expect("ChartEx anchor position");

        assert_eq!(pos.anchor_col, 8);
        assert_eq!(pos.anchor_row, 3);
        assert_eq!(pos.anchor_col_offset, 11);
        assert_eq!(pos.anchor_row_offset, 22);
        assert_eq!(pos.end_col, None);
        assert_eq!(pos.end_row, None);
        assert_eq!(pos.extent_cx, Some(4_699_001));
        assert_eq!(pos.extent_cy, Some(3_260_722));
    }
}
