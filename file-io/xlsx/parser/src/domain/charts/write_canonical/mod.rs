//! Canonical chart serializer — serializes `ChartSpace` directly to OOXML XML.
//!
//! This bypasses the lossy `ChartWriter` path and round-trips every field
//! present on the typed `ooxml_types::charts::ChartSpace` model.

mod axes;
mod chart_types;
mod labels;
mod layout;
mod series;
mod shape_props;
mod structure;
mod text_body;
mod util;

pub(crate) use shape_props::emit_shape_properties;
pub(crate) use text_body::emit_text_body;

use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::{Chart, ChartSpace};

use self::util::write_raw_xml_if_relationship_safe;

// ============================================================================
// Constants
// ============================================================================

const NS_CHART: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_DRAWING: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_C16R2: &str = "http://schemas.microsoft.com/office/drawing/2015/06/chart";

// ============================================================================
// Main entry point
// ============================================================================

/// Serialize a `ChartSpace` to complete OOXML chart XML bytes.
pub fn serialize_chart_space(cs: &ChartSpace) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();

    w.start_element("c:chartSpace")
        .attr("xmlns:c", NS_CHART)
        .attr("xmlns:a", NS_DRAWING)
        .attr("xmlns:r", NS_REL)
        .attr("xmlns:c16r2", NS_C16R2)
        .end_attrs();

    // date1904
    if let Some(v) = cs.date1904 {
        w.start_element("c:date1904")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // lang
    if let Some(ref lang) = cs.lang {
        w.start_element("c:lang").attr("val", lang).self_close();
    }

    // roundedCorners
    if let Some(v) = cs.rounded_corners {
        w.start_element("c:roundedCorners")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // style — prefer raw mc:AlternateContent blob for round-trip fidelity.
    // Some producers (Google Sheets) place this AFTER </c:chart>; in that case
    // `style_after_chart` is true and we defer emission until after `emit_chart`.
    if !cs.style_after_chart {
        if let Some(ref ac_xml) = cs.style_alternate_content {
            write_raw_xml_if_relationship_safe(&mut w, ac_xml);
        } else if let Some(v) = cs.style {
            w.start_element("c:style")
                .attr("val", &v.to_string())
                .self_close();
        }
    }

    // clrMapOvr
    if let Some(ref cmo) = cs.clr_map_ovr {
        structure::emit_clr_map_ovr(&mut w, cmo);
    }

    // pivotSource
    if let Some(ref ps) = cs.pivot_source {
        structure::emit_pivot_source(&mut w, ps);
    }

    // protection
    if let Some(ref prot) = cs.protection {
        structure::emit_protection(&mut w, prot);
    }

    // chart
    emit_chart(&mut w, &cs.chart);

    // Deferred style emission for files that had mc:AlternateContent after </c:chart>
    if cs.style_after_chart {
        if let Some(ref ac_xml) = cs.style_alternate_content {
            write_raw_xml_if_relationship_safe(&mut w, ac_xml);
        }
    }

    // spPr
    if let Some(ref sp) = cs.sp_pr {
        emit_shape_properties(&mut w, sp, "c:spPr");
    }

    // txPr
    if let Some(ref tb) = cs.tx_pr {
        emit_text_body(&mut w, tb, "c:txPr");
    }

    if let Some(ref external_data) = cs.external_data {
        w.start_element("c:externalData")
            .attr("r:id", &external_data.r_id)
            .end_attrs();
        if let Some(auto_update) = external_data.auto_update {
            w.start_element("c:autoUpdate")
                .attr("val", if auto_update { "1" } else { "0" })
                .self_close();
        }
        w.end_element("c:externalData");
    }

    // printSettings
    if let Some(ref ps) = cs.print_settings {
        structure::emit_print_settings(&mut w, ps);
    }

    if let Some(ref r_id) = cs.user_shapes {
        w.start_element("c:userShapes")
            .attr("r:id", r_id)
            .self_close();
    }

    // extLst
    if !cs.extensions.is_empty() {
        w.start_element("c:extLst").end_attrs();
        for ext in &cs.extensions {
            write_raw_xml_if_relationship_safe(&mut w, &ext.xml);
        }
        w.end_element("c:extLst");
    }

    w.end_element("c:chartSpace");
    w.finish()
}

// ============================================================================
// Chart-level helpers
// ============================================================================

fn emit_chart(w: &mut XmlWriter, chart: &Chart) {
    w.start_element("c:chart").end_attrs();

    // title
    if let Some(ref t) = chart.title {
        structure::emit_title(w, t);
    }

    // autoTitleDeleted
    if let Some(v) = chart.auto_title_deleted {
        w.start_element("c:autoTitleDeleted")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // pivotFmts
    if !chart.pivot_fmts.is_empty() {
        w.start_element("c:pivotFmts").end_attrs();
        for pf in &chart.pivot_fmts {
            structure::emit_pivot_fmt(w, pf);
        }
        w.end_element("c:pivotFmts");
    }

    // view3D
    if let Some(ref v3d) = chart.view_3d {
        structure::emit_view_3d(w, v3d);
    }

    // floor
    if let Some(ref f) = chart.floor {
        structure::emit_chart_surface(w, f, "c:floor");
    }

    // sideWall
    if let Some(ref sw) = chart.side_wall {
        structure::emit_chart_surface(w, sw, "c:sideWall");
    }

    // backWall
    if let Some(ref bw) = chart.back_wall {
        structure::emit_chart_surface(w, bw, "c:backWall");
    }

    // plotArea
    chart_types::emit_plot_area(w, &chart.plot_area);

    // legend
    if let Some(ref leg) = chart.legend {
        structure::emit_legend(w, leg);
    }

    // plotVisOnly
    if let Some(v) = chart.plot_vis_only {
        w.start_element("c:plotVisOnly")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // dispBlanksAs
    if let Some(ref dba) = chart.disp_blanks_as {
        w.start_element("c:dispBlanksAs")
            .attr("val", dba.to_ooxml())
            .self_close();
    }

    // showDLblsOverMax
    if let Some(v) = chart.show_d_lbls_over_max {
        w.start_element("c:showDLblsOverMax")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // extLst
    if !chart.extensions.is_empty() {
        w.start_element("c:extLst").end_attrs();
        for ext in &chart.extensions {
            write_raw_xml_if_relationship_safe(w, &ext.xml);
        }
        w.end_element("c:extLst");
    } else if chart.has_empty_ext_lst {
        w.start_element("c:extLst").self_close();
    }

    w.end_element("c:chart");
}
