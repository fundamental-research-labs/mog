use domain_types::chart::ObjectSize;
use domain_types::{ChartDefinition, ChartSpec};

use crate::output::results::FullParsedSheet;

use super::super::chart_ex_projection::project_chart_ex_space;
use super::{
    apply_chart_frame_to_spec, chart_auxiliary_parts, chart_drawing_frames,
    chart_frames_by_relationship_target, chart_owned_relationships,
    normalize_local_chart_source_references, standard_chart_projection_fingerprint,
};

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
