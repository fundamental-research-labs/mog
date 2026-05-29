use bridge_types::DescribeSchema;
use serde::{Deserialize, Serialize};

use crate::ImportObjectStatus;

use super::ChartSeriesData;
use super::floating_object::{
    AnchorMode, ChartData, ChartDrawingFrameOoxmlProps, ChartOoxmlProps, FloatingObject,
    FloatingObjectAnchor, FloatingObjectCommon, FloatingObjectData,
};
use super::{
    AnchorPosition, AxisData, ChartAuxiliaryPart, ChartDataTableData, ChartDefinition,
    ChartFormatData, ChartFormatStringData, ChartRelationshipData, ChartSubType, ChartType,
    ChartView3DData, DataLabelData, LegendData, ObjectSize, StandardChartExportAuthority,
    StandardChartProvenance,
};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct ChartExReplayData {
    pub original_path: String,
    pub original_xml: Vec<u8>,
    pub original_position: AnchorPosition,
    pub rels_path: Option<String>,
    pub rels_xml: Option<Vec<u8>>,
    pub relationships: Vec<ChartRelationshipData>,
    pub auxiliary_files: Vec<(String, Vec<u8>)>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, DescribeSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChartSpec {
    /// "column", "bar", "line", "pie", etc.
    pub chart_type: ChartType,
    pub title: Option<String>,
    pub position: AnchorPosition,
    pub size: ObjectSize,
    pub z_index: i32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub definition: Option<ChartDefinition>,
    // -- Typed chart data (populated by XLSX parser, used by to_floating_object) --
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub series: Vec<ChartSeriesData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub sub_type: Option<ChartSubType>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub legend: Option<LegendData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub axes: Option<AxisData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub data_labels: Option<DataLabelData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub data_range: Option<String>,

    // -- API-exposed appearance --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub style: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub rounded_corners: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub auto_title_deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_data_labels_over_max: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub chart_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plot_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_rich_text: Option<Vec<ChartFormatStringData>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_formula: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub data_table: Option<ChartDataTableData>,

    // -- Chart-level properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub display_blanks_as: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plot_visible_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub gap_width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub overlap: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub doughnut_hole_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub first_slice_angle: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bubble_scale: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub split_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub split_value: Option<f64>,

    // -- Bar shape (3D decorative charts) --
    /// Mark shape for 3D bar/column charts: "box", "cylinder", "cone", "pyramid".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bar_shape: Option<String>,

    // -- Bubble --
    /// Whether 3D effect is applied to bubble charts.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bubble_3d_effect: Option<bool>,

    // -- Surface --
    /// Whether surface chart uses wireframe rendering.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub wireframe: Option<bool>,
    /// Whether surface chart shows top view only.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub surface_top_view: Option<bool>,

    // -- Theming --
    /// Chart color scheme index (1-based).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub color_scheme: Option<u8>,

    // -- Simple config properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub category_label_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub series_name_level: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_all_field_buttons: Option<bool>,

    // -- Chart-level series properties --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub second_plot_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub vary_by_categories: Option<bool>,

    // -- Title alignment/shadow --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_h_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_v_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub title_show_shadow: Option<bool>,

    // -- Pivot chart options --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pivot_options: Option<PivotChartOptionsData>,

    // -- 3D --
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub view_3d: Option<ChartView3DData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub floor_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub side_wall_format: Option<ChartFormatData>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub back_wall_format: Option<ChartFormatData>,

    /// Typed drawing-frame OOXML contract for imported chart anchors.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub chart_frame: Option<ChartDrawingFrameOoxmlProps>,

    /// Chart-owned package relationships imported with this chart part.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chart_relationships: Vec<ChartRelationshipData>,

    /// Chart-owned auxiliary package parts imported with this chart part.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chart_auxiliary_files: Vec<(String, Vec<u8>)>,
    /// Typed chart-owned auxiliary package parts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chart_auxiliary_parts: Vec<ChartAuxiliaryPart>,
    #[serde(skip)]
    pub chart_ex_replay: Option<ChartExReplayData>,
    /// Durable standard chart import provenance used by XLSX export planning.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub standard_chart_provenance: Option<StandardChartProvenance>,
    /// Durable standard chart authority used to decide whether imported typed owners are current.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub standard_chart_export_authority: Option<StandardChartExportAuthority>,

    /// Whether this chart uses ChartEx format (cx: namespace) instead of standard c: namespace.
    /// ChartEx covers modern chart types: Waterfall, Treemap, Sunburst, Funnel, etc.
    #[serde(default)]
    pub is_chart_ex: bool,
    /// Original cNvPr name attribute from the drawing graphicFrame (for round-trip fidelity).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cnv_pr_name: Option<String>,
    /// Original cNvPr id attribute from the drawing graphicFrame.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cnv_pr_id: Option<u32>,
    /// Original cNvPr descr attribute (alt text / description) from the graphicFrame.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cnv_pr_descr: Option<String>,
    /// Original cNvPr title attribute from the graphicFrame.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cnv_pr_title: Option<String>,
    /// Whether cNvPr hidden="1" on the graphicFrame.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub cnv_pr_hidden: bool,
    /// Whether noChangeAspect was explicitly set on graphicFrameLocks.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub no_change_aspect: Option<bool>,
    /// Whether `<a:graphicFrameLocks/>` was present in the original XML, even if empty.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub has_graphic_frame_locks: bool,
    /// xfrm offset x in EMUs (from graphicFrame transform).
    #[serde(default)]
    pub xfrm_off_x: i64,
    /// xfrm offset y in EMUs.
    #[serde(default)]
    pub xfrm_off_y: i64,
    /// xfrm extent cx in EMUs.
    #[serde(default)]
    pub xfrm_ext_cx: i64,
    /// xfrm extent cy in EMUs.
    #[serde(default)]
    pub xfrm_ext_cy: i64,
    /// Opaque <a:extLst> XML from cNvPr (round-trip of creationId etc.).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cnv_pr_ext_lst: Option<String>,
    /// Drawing anchor editAs attribute ("oneCell", "twoCell", "absolute").
    /// Preserved for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub anchor_edit_as: Option<String>,
    /// Macro name from the graphicFrame element (@macro attribute).
    /// `Some("")` preserves `macro=""` for round-trip fidelity.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub macro_name: Option<String>,
    /// Whether the drawing object locks with the sheet (fLocksWithSheet attribute).
    /// `None` = use default (true), `Some(false)` = explicitly set to "0".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub client_data_locks_with_sheet: Option<bool>,
    /// Whether the drawing object prints with the sheet (fPrintsWithSheet attribute).
    /// `None` = use default (true), `Some(false)` = explicitly set to "0".
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub client_data_prints_with_sheet: Option<bool>,
    /// Original anchor index within the drawing XML (for round-trip ordering fidelity).
    /// Used to interleave chart anchors with floating object anchors in the correct order.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub anchor_index: Option<usize>,
    /// Import-time object validity/renderability status.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub import_status: Option<ImportObjectStatus>,
}

/// Pivot chart display options (field button visibility).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PivotChartOptionsData {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_axis_field_buttons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_legend_field_buttons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_report_filter_field_buttons: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub show_value_field_buttons: Option<bool>,
}

impl ChartSpec {
    /// Convert a `FloatingObject` back into a `ChartSpec` for XLSX export.
    ///
    /// Returns `None` if the object is not a chart.
    pub fn from_floating_object(obj: &FloatingObject) -> Option<ChartSpec> {
        let chart_data = match &obj.data {
            FloatingObjectData::Chart(cd) => cd,
            _ => return None,
        };

        let common = &obj.common;
        let anchor = &common.anchor;

        // Reconstruct AnchorPosition from FloatingObjectAnchor
        let position = AnchorPosition {
            anchor_row: anchor.anchor_row,
            anchor_col: anchor.anchor_col,
            anchor_row_offset: anchor.anchor_row_offset,
            anchor_col_offset: anchor.anchor_col_offset,
            absolute_x: anchor.absolute_x,
            absolute_y: anchor.absolute_y,
            end_row: anchor.end_row,
            end_col: anchor.end_col,
            end_row_offset: anchor.end_row_offset,
            end_col_offset: anchor.end_col_offset,
            extent_cx: anchor.extent_cx,
            extent_cy: anchor.extent_cy,
        };

        // Reconstruct ObjectSize from common width/height
        let size = ObjectSize {
            width: common.width,
            height: common.height,
            height_pt: chart_data.height_pt,
            width_pt: chart_data.width_pt,
            left_pt: chart_data.left_pt,
            top_pt: chart_data.top_pt,
        };

        // Unpack typed OOXML preservation data.
        let ooxml = chart_data.ooxml.as_ref();
        let chart_frame = ooxml.and_then(|o| o.drawing_frame.clone());
        let chart_relationships = ooxml
            .map(|o| o.chart_relationships.clone())
            .unwrap_or_default();
        let chart_auxiliary_files = ooxml
            .map(|o| o.chart_auxiliary_files.clone())
            .unwrap_or_default();
        let chart_auxiliary_parts = ooxml
            .map(|o| o.chart_auxiliary_parts.clone())
            .unwrap_or_default();
        let chart_ex_replay = ooxml.and_then(|o| o.chart_ex_replay.clone());
        let standard_chart_provenance = ooxml.and_then(|o| o.standard_chart_provenance.clone());
        let standard_chart_export_authority =
            ooxml.and_then(|o| o.standard_chart_export_authority.clone());
        let is_chart_ex = ooxml.map(|o| o.is_chart_ex).unwrap_or_else(|| {
            matches!(
                ooxml.and_then(|o| o.definition.as_ref()),
                Some(ChartDefinition::ChartEx(_))
            )
        });

        let (
            cnv_pr_name,
            cnv_pr_id,
            cnv_pr_descr,
            cnv_pr_title,
            cnv_pr_hidden,
            no_change_aspect,
            has_graphic_frame_locks,
            xfrm_off_x,
            xfrm_off_y,
            xfrm_ext_cx,
            xfrm_ext_cy,
            cnv_pr_ext_lst,
            anchor_edit_as,
            macro_name,
            client_data_locks_with_sheet,
            client_data_prints_with_sheet,
            anchor_index,
        ) = if let Some(ref frame) = chart_frame {
            let gf = &frame.graphic_frame;
            let nv = &gf.nv_graphic_frame_pr;
            let cnv = &nv.c_nv_pr;
            (
                (!cnv.name.is_empty()).then(|| cnv.name.clone()),
                (cnv.id.value() != 0).then_some(cnv.id.value()),
                cnv.descr.clone(),
                cnv.title.clone(),
                cnv.hidden,
                nv.no_change_aspect_explicit
                    .or_else(|| nv.c_nv_graphic_frame_pr.no_change_aspect.then_some(true)),
                nv.has_graphic_frame_locks,
                gf.xfrm.off_x(),
                gf.xfrm.off_y(),
                gf.xfrm.ext_cx() as i64,
                gf.xfrm.ext_cy() as i64,
                cnv.ext_lst.clone(),
                frame.edit_as.clone(),
                gf.macro_name.clone(),
                frame.client_data_locks_with_sheet,
                frame.client_data_prints_with_sheet,
                frame.anchor_index.and_then(|i| usize::try_from(i).ok()),
            )
        } else {
            (
                None, None, None, None, false, None, false, 0, 0, 0, 0, None, None, None, None,
                None, None,
            )
        };

        let definition = ooxml.and_then(|o| o.definition.clone()).or_else(|| {
            Some(if is_chart_ex {
                ChartDefinition::ChartEx(ooxml_types::chart_ex::ChartExSpace::default())
            } else {
                ChartDefinition::Chart(ooxml_types::charts::ChartSpace::default())
            })
        });

        Some(ChartSpec {
            chart_type: chart_data.chart_type.clone(),
            // Filter out the literal string "undefined" that can leak from JS bridge serialization.
            title: chart_data
                .title
                .as_deref()
                .filter(|t| *t != "undefined" && !t.is_empty())
                .map(|t| t.to_string()),
            position,
            size,
            z_index: common.z_index,
            definition,
            series: chart_data.series.clone().unwrap_or_default(),
            sub_type: chart_data.sub_type.clone(),
            legend: chart_data.legend.clone(),
            axes: chart_data.axis.clone(),
            data_labels: chart_data.data_labels.clone(),
            data_range: chart_data.data_range.clone(),
            // API-exposed appearance
            style: chart_data.style,
            rounded_corners: chart_data.rounded_corners,
            auto_title_deleted: chart_data.auto_title_deleted,
            show_data_labels_over_max: chart_data.show_data_labels_over_max,
            chart_format: chart_data.chart_format.clone(),
            plot_format: chart_data.plot_format.clone(),
            title_format: chart_data.title_format.clone(),
            title_rich_text: chart_data.title_rich_text.clone(),
            title_formula: chart_data.title_formula.clone(),
            data_table: chart_data.data_table.clone(),
            // Chart-level properties
            display_blanks_as: chart_data.display_blanks_as.clone(),
            plot_visible_only: chart_data.plot_visible_only,
            gap_width: chart_data.gap_width,
            overlap: chart_data.overlap,
            doughnut_hole_size: chart_data.doughnut_hole_size,
            first_slice_angle: chart_data.first_slice_angle,
            bubble_scale: chart_data.bubble_scale,
            split_type: chart_data.split_type.clone(),
            split_value: chart_data.split_value,
            // Simple config properties
            category_label_level: chart_data.category_label_level,
            series_name_level: chart_data.series_name_level,
            show_all_field_buttons: chart_data.show_all_field_buttons,
            // Chart-level series properties
            second_plot_size: chart_data.second_plot_size,
            vary_by_categories: chart_data.vary_by_categories,
            // Title alignment/shadow
            title_h_align: chart_data.title_h_align.clone(),
            title_v_align: chart_data.title_v_align.clone(),
            title_show_shadow: chart_data.title_show_shadow,
            // Pivot chart options
            pivot_options: chart_data.pivot_options.clone(),
            // Bar shape
            bar_shape: chart_data.bar_shape.clone(),
            // Bubble / Surface / Theming
            bubble_3d_effect: chart_data.bubble_3d_effect,
            wireframe: chart_data.wireframe,
            surface_top_view: chart_data.surface_top_view,
            color_scheme: chart_data.color_scheme,
            // 3D
            view_3d: chart_data.view_3d.clone(),
            floor_format: chart_data.floor_format.clone(),
            side_wall_format: chart_data.side_wall_format.clone(),
            back_wall_format: chart_data.back_wall_format.clone(),
            chart_frame,
            chart_relationships,
            chart_auxiliary_files,
            chart_auxiliary_parts,
            chart_ex_replay,
            standard_chart_provenance,
            standard_chart_export_authority,
            is_chart_ex,
            cnv_pr_name,
            cnv_pr_id,
            cnv_pr_descr,
            cnv_pr_title,
            cnv_pr_hidden,
            no_change_aspect,
            has_graphic_frame_locks,
            xfrm_off_x,
            xfrm_off_y,
            xfrm_ext_cx,
            xfrm_ext_cy,
            cnv_pr_ext_lst,
            anchor_edit_as,
            macro_name,
            client_data_locks_with_sheet,
            client_data_prints_with_sheet,
            anchor_index,
            import_status: obj.common.import_status.clone(),
        })
    }

    fn legacy_chart_frame_ooxml_props(&self) -> Option<ChartDrawingFrameOoxmlProps> {
        let has_frame_data = self.cnv_pr_name.is_some()
            || self.cnv_pr_id.is_some()
            || self.cnv_pr_descr.is_some()
            || self.cnv_pr_title.is_some()
            || self.cnv_pr_hidden
            || self.no_change_aspect.is_some()
            || self.has_graphic_frame_locks
            || self.xfrm_off_x != 0
            || self.xfrm_off_y != 0
            || self.xfrm_ext_cx != 0
            || self.xfrm_ext_cy != 0
            || self.cnv_pr_ext_lst.is_some()
            || self.anchor_edit_as.is_some()
            || self.macro_name.is_some()
            || self.client_data_locks_with_sheet.is_some()
            || self.client_data_prints_with_sheet.is_some()
            || self.anchor_index.is_some();

        if !has_frame_data {
            return None;
        }

        let mut graphic_frame = ooxml_types::drawings::SpreadsheetGraphicFrame::default();
        {
            let nv = &mut graphic_frame.nv_graphic_frame_pr;
            if let Some(id) = self.cnv_pr_id {
                nv.c_nv_pr.id = ooxml_types::drawings::StDrawingElementId::new(id);
            }
            nv.c_nv_pr.name = self.cnv_pr_name.clone().unwrap_or_default();
            nv.c_nv_pr.descr = self.cnv_pr_descr.clone();
            nv.c_nv_pr.title = self.cnv_pr_title.clone();
            nv.c_nv_pr.hidden = self.cnv_pr_hidden;
            nv.c_nv_pr.ext_lst = self.cnv_pr_ext_lst.clone();
            nv.has_graphic_frame_locks = self.has_graphic_frame_locks;
            nv.no_change_aspect_explicit = self.no_change_aspect;
            if let Some(true) = self.no_change_aspect {
                nv.c_nv_graphic_frame_pr.no_change_aspect = true;
            }
        }
        graphic_frame.xfrm = ooxml_types::drawings::Transform2D {
            offset: Some((self.xfrm_off_x, self.xfrm_off_y)),
            extent: Some((
                self.xfrm_ext_cx.max(0) as u64,
                self.xfrm_ext_cy.max(0) as u64,
            )),
            ..Default::default()
        };
        graphic_frame.macro_name = self.macro_name.clone();

        Some(ChartDrawingFrameOoxmlProps {
            graphic_frame,
            anchor_index: self.anchor_index.and_then(|i| i32::try_from(i).ok()),
            extent_emu_cx: self.position.extent_cx,
            extent_emu_cy: self.position.extent_cy,
            edit_as: self.anchor_edit_as.clone(),
            client_data_locks_with_sheet: self.client_data_locks_with_sheet,
            client_data_prints_with_sheet: self.client_data_prints_with_sheet,
            relationship_id: None,
            relationship_target: None,
            raw_alternate_content: None,
        })
    }

    /// Convert an XLSX-parsed `ChartSpec` into a `FloatingObject` for runtime storage.
    ///
    /// `sheet_id` — hex sheet identifier for the `FloatingObjectCommon::sheet_id` field.
    /// `index` — ordinal within the sheet, used for a deterministic `id` field.
    pub fn to_floating_object(&self, sheet_id: &str, index: usize) -> FloatingObject {
        let drawing_frame = self
            .chart_frame
            .clone()
            .or_else(|| self.legacy_chart_frame_ooxml_props());
        let definition = self.definition.clone();
        let ooxml_val = if definition.is_none()
            && drawing_frame.is_none()
            && self.chart_relationships.is_empty()
            && self.chart_auxiliary_files.is_empty()
            && self.chart_auxiliary_parts.is_empty()
            && self.chart_ex_replay.is_none()
            && self.standard_chart_provenance.is_none()
            && self.standard_chart_export_authority.is_none()
            && !self.is_chart_ex
        {
            None
        } else {
            Some(ChartOoxmlProps {
                definition,
                drawing_frame,
                chart_relationships: self.chart_relationships.clone(),
                chart_auxiliary_files: self.chart_auxiliary_files.clone(),
                chart_auxiliary_parts: self.chart_auxiliary_parts.clone(),
                standard_chart_provenance: self.standard_chart_provenance.clone(),
                standard_chart_export_authority: self.standard_chart_export_authority.clone(),
                chart_ex_replay: self.chart_ex_replay.clone(),
                is_chart_ex: self.is_chart_ex,
            })
        };

        // Determine anchor mode from position fields
        let anchor_mode =
            if self.position.absolute_x.is_some() && self.position.absolute_y.is_some() {
                AnchorMode::Absolute
            } else if self.position.end_row.is_some() && self.position.end_col.is_some() {
                AnchorMode::TwoCell
            } else {
                AnchorMode::OneCell
            };

        let common = FloatingObjectCommon {
            id: format!("chart-import-{}", index),
            sheet_id: sheet_id.to_string(),
            anchor: FloatingObjectAnchor {
                anchor_row: self.position.anchor_row,
                anchor_col: self.position.anchor_col,
                anchor_row_offset: self.position.anchor_row_offset,
                anchor_col_offset: self.position.anchor_col_offset,
                anchor_mode,
                absolute_x: self.position.absolute_x,
                absolute_y: self.position.absolute_y,
                end_row: self.position.end_row,
                end_col: self.position.end_col,
                end_row_offset: self.position.end_row_offset,
                end_col_offset: self.position.end_col_offset,
                extent_cx: self.position.extent_cx,
                extent_cy: self.position.extent_cy,
            },
            width: self.size.width,
            height: self.size.height,
            z_index: self.z_index,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            locked: true,
            visible: true,
            printable: true,
            opacity: 1.0,
            name: self
                .chart_frame
                .as_ref()
                .and_then(|frame| {
                    let name = &frame.graphic_frame.nv_graphic_frame_pr.c_nv_pr.name;
                    (!name.is_empty()).then(|| name.clone())
                })
                .or_else(|| self.cnv_pr_name.clone())
                .unwrap_or_default(),
            created_at: 0,
            updated_at: 0,
            group_id: None,
            anchor_cell_id: None,
            to_anchor_cell_id: None,
            lock_aspect_ratio: None,
            alt_text_title: None,
            display_name: None,
            import_status: self.import_status.clone(),
        };

        let chart_data = ChartData {
            chart_type: self.chart_type.clone(),
            sub_type: self.sub_type.clone(),
            series_orientation: None,
            data_range: self.data_range.clone(),
            data_range_identity: None,
            series_range: None,
            series_range_identity: None,
            category_range: None,
            category_range_identity: None,
            title: self.title.clone(),
            subtitle: None,
            legend: self.legend.clone(),
            axis: self.axes.clone(),
            colors: None,
            series: if self.series.is_empty() {
                None
            } else {
                Some(self.series.clone())
            },
            data_labels: self.data_labels.clone(),
            pie_slice: None,
            trendline: None,
            show_lines: None,
            smooth_lines: None,
            radar_filled: None,
            radar_markers: None,
            waterfall: None,
            display_blanks_as: self.display_blanks_as.clone(),
            plot_visible_only: self.plot_visible_only,
            gap_width: self.gap_width,
            overlap: self.overlap,
            doughnut_hole_size: self.doughnut_hole_size,
            first_slice_angle: self.first_slice_angle,
            bubble_scale: self.bubble_scale,
            split_type: self.split_type.clone(),
            split_value: self.split_value,
            // Simple config properties
            category_label_level: self.category_label_level,
            series_name_level: self.series_name_level,
            show_all_field_buttons: self.show_all_field_buttons,
            // Chart-level series properties
            second_plot_size: self.second_plot_size,
            vary_by_categories: self.vary_by_categories,
            // Title alignment/shadow
            title_h_align: self.title_h_align.clone(),
            title_v_align: self.title_v_align.clone(),
            title_show_shadow: self.title_show_shadow,
            // Pivot chart options
            pivot_options: self.pivot_options.clone(),
            // Bubble / Surface / Theming
            bubble_3d_effect: self.bubble_3d_effect,
            wireframe: self.wireframe,
            surface_top_view: self.surface_top_view,
            color_scheme: self.color_scheme,
            // Position in points
            height_pt: self.size.height_pt,
            width_pt: self.size.width_pt,
            left_pt: self.size.left_pt,
            top_pt: self.size.top_pt,
            // API-exposed fields
            style: self.style,
            rounded_corners: self.rounded_corners,
            auto_title_deleted: self.auto_title_deleted,
            show_data_labels_over_max: self.show_data_labels_over_max,
            chart_format: self.chart_format.clone(),
            plot_format: self.plot_format.clone(),
            title_format: self.title_format.clone(),
            title_rich_text: self.title_rich_text.clone(),
            title_formula: self.title_formula.clone(),
            data_table: self.data_table.clone(),
            // Bar shape
            bar_shape: self.bar_shape.clone(),
            // 3D
            view_3d: self.view_3d.clone(),
            floor_format: self.floor_format.clone(),
            side_wall_format: self.side_wall_format.clone(),
            back_wall_format: self.back_wall_format.clone(),
            source_table_id: None,
            table_data_columns: None,
            table_category_column: None,
            use_table_column_names_as_labels: None,
            table_column_names: None,
            width_cells: None,
            height_cells: None,
            ooxml: ooxml_val,
        };

        FloatingObject {
            common,
            data: FloatingObjectData::Chart(chart_data),
        }
    }
}
