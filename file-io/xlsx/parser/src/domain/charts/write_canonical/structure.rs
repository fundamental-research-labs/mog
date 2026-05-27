use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::{
    ChartProtection, ChartSurface, Legend, LegendEntry, PageMargins, PageSetup, PivotFmt,
    PivotSource, PrintSettings, Title, View3D,
};

use super::layout::{emit_chart_text, emit_layout, emit_picture_options};
use super::shape_props::emit_shape_properties;
use super::text_body::emit_text_body;
use super::util::format_f64;

pub(super) fn emit_title(w: &mut XmlWriter, title: &Title) {
    w.start_element("c:title").end_attrs();

    // tx
    if let Some(ref tx) = title.tx {
        emit_chart_text(w, tx);
    }

    // layout
    if let Some(ref lay) = title.layout {
        emit_layout(w, lay);
    }

    // overlay
    if let Some(v) = title.overlay {
        w.start_element("c:overlay")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // spPr
    if let Some(ref sp) = title.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }

    // txPr
    if let Some(ref tb) = title.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    w.end_element("c:title");
}

pub(super) fn emit_legend(w: &mut XmlWriter, legend: &Legend) {
    w.start_element("c:legend").end_attrs();

    // legendPos
    if let Some(ref pos) = legend.legend_pos {
        w.start_element("c:legendPos")
            .attr("val", pos.to_ooxml())
            .self_close();
    }

    // legendEntry
    for entry in &legend.legend_entry {
        emit_legend_entry(w, entry);
    }

    // layout
    if let Some(ref lay) = legend.layout {
        emit_layout(w, lay);
    }

    // overlay
    if let Some(v) = legend.overlay {
        w.start_element("c:overlay")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // spPr
    if let Some(ref sp) = legend.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }

    // txPr
    if let Some(ref tb) = legend.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    w.end_element("c:legend");
}

fn emit_legend_entry(w: &mut XmlWriter, entry: &LegendEntry) {
    w.start_element("c:legendEntry").end_attrs();

    w.start_element("c:idx")
        .attr("val", &entry.idx.to_string())
        .self_close();

    if let Some(v) = entry.delete {
        w.start_element("c:delete")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    if let Some(ref tb) = entry.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    w.end_element("c:legendEntry");
}

pub(super) fn emit_view_3d(w: &mut XmlWriter, v3d: &View3D) {
    w.start_element("c:view3D").end_attrs();

    if let Some(v) = v3d.rot_x {
        w.start_element("c:rotX")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = v3d.height_percent {
        w.start_element("c:hPercent")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = v3d.rot_y {
        w.start_element("c:rotY")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = v3d.depth_percent {
        w.start_element("c:depthPercent")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = v3d.right_angle_axes {
        w.start_element("c:rAngAx")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = v3d.perspective {
        w.start_element("c:perspective")
            .attr("val", &v.to_string())
            .self_close();
    }

    w.end_element("c:view3D");
}

pub(super) fn emit_chart_surface(w: &mut XmlWriter, surface: &ChartSurface, tag: &str) {
    w.start_element(tag).end_attrs();

    if let Some(ref t) = surface.thickness {
        w.start_element("c:thickness").attr("val", t).self_close();
    }
    if let Some(ref sp) = surface.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if let Some(ref po) = surface.picture_options {
        emit_picture_options(w, po);
    }

    w.end_element(tag);
}

pub(super) fn emit_protection(w: &mut XmlWriter, prot: &ChartProtection) {
    w.start_element("c:protection").end_attrs();

    if let Some(v) = prot.chart_object {
        w.start_element("c:chartObject")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = prot.data {
        w.start_element("c:data")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = prot.formatting {
        w.start_element("c:formatting")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = prot.selection {
        w.start_element("c:selection")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = prot.user_interface {
        w.start_element("c:userInterface")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    w.end_element("c:protection");
}

pub(super) fn emit_print_settings(w: &mut XmlWriter, ps: &PrintSettings) {
    w.start_element("c:printSettings").end_attrs();

    // headerFooter
    if let Some(ref hf) = ps.header_footer {
        emit_header_footer(w, hf);
    }

    // pageMargins
    if let Some(ref pm) = ps.page_margins {
        emit_page_margins(w, pm);
    }

    // pageSetup
    if let Some(ref psu) = ps.page_setup {
        emit_page_setup(w, psu);
    }

    // legacyDrawingHF owns a chart-part relationship; omit until chart rels are
    // registered and resolved through the package graph.

    w.end_element("c:printSettings");
}

fn emit_header_footer(w: &mut XmlWriter, hf: &ooxml_types::print::HeaderFooter) {
    w.start_element("c:headerFooter");
    if hf.different_odd_even {
        w.attr("differentOddEven", "1");
    }
    if hf.different_first {
        w.attr("differentFirst", "1");
    }
    w.end_attrs();

    if let Some(ref v) = hf.odd_header {
        w.element_with_text("c:oddHeader", v);
    }
    if let Some(ref v) = hf.odd_footer {
        w.element_with_text("c:oddFooter", v);
    }
    if let Some(ref v) = hf.even_header {
        w.element_with_text("c:evenHeader", v);
    }
    if let Some(ref v) = hf.even_footer {
        w.element_with_text("c:evenFooter", v);
    }
    if let Some(ref v) = hf.first_header {
        w.element_with_text("c:firstHeader", v);
    }
    if let Some(ref v) = hf.first_footer {
        w.element_with_text("c:firstFooter", v);
    }

    w.end_element("c:headerFooter");
}

fn emit_page_margins(w: &mut XmlWriter, pm: &PageMargins) {
    w.start_element("c:pageMargins")
        .attr("b", &format_f64(pm.bottom))
        .attr("l", &format_f64(pm.left))
        .attr("r", &format_f64(pm.right))
        .attr("t", &format_f64(pm.top))
        .attr("header", &format_f64(pm.header))
        .attr("footer", &format_f64(pm.footer))
        .self_close();
}

fn emit_page_setup(w: &mut XmlWriter, psu: &PageSetup) {
    w.start_element("c:pageSetup");
    if let Some(v) = psu.paper_size {
        w.attr("paperSize", &v.to_string());
    }
    if let Some(ref v) = psu.paper_height {
        w.attr("paperHeight", v);
    }
    if let Some(ref v) = psu.paper_width {
        w.attr("paperWidth", v);
    }
    if let Some(v) = psu.first_page_number {
        w.attr("firstPageNumber", &v.to_string());
    }
    if let Some(ref v) = psu.orientation {
        w.attr("orientation", v.to_ooxml());
    }
    if let Some(v) = psu.black_and_white {
        w.attr("blackAndWhite", if v { "1" } else { "0" });
    }
    if let Some(v) = psu.draft {
        w.attr("draft", if v { "1" } else { "0" });
    }
    if let Some(v) = psu.use_first_page_number {
        w.attr("useFirstPageNumber", if v { "1" } else { "0" });
    }
    if let Some(v) = psu.horizontal_dpi {
        w.attr("horizontalDpi", &v.to_string());
    }
    if let Some(v) = psu.vertical_dpi {
        w.attr("verticalDpi", &v.to_string());
    }
    if let Some(v) = psu.copies {
        w.attr("copies", &v.to_string());
    }
    w.self_close();
}

pub(super) fn emit_pivot_source(w: &mut XmlWriter, ps: &PivotSource) {
    w.start_element("c:pivotSource").end_attrs();
    w.element_with_text("c:name", &ps.name);
    w.start_element("c:fmtId")
        .attr("val", &ps.fmt_id.to_string())
        .self_close();
    w.end_element("c:pivotSource");
}

pub(super) fn emit_pivot_fmt(w: &mut XmlWriter, pf: &PivotFmt) {
    w.start_element("c:pivotFmt").end_attrs();

    w.start_element("c:idx")
        .attr("val", &pf.idx.to_string())
        .self_close();

    if let Some(ref sp) = pf.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if let Some(ref tb) = pf.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }
    if let Some(ref m) = pf.marker {
        super::axes::emit_marker(w, m);
    }
    if let Some(ref dl) = pf.d_lbl {
        super::labels::emit_data_label(w, dl);
    }

    w.end_element("c:pivotFmt");
}

pub(super) fn emit_clr_map_ovr(w: &mut XmlWriter, cmo: &ooxml_types::themes::ColorMappingOverride) {
    w.start_element("c:clrMapOvr").end_attrs();

    match cmo {
        ooxml_types::themes::ColorMappingOverride::MasterClrMapping => {
            w.start_element("a:masterClrMapping").self_close();
        }
        ooxml_types::themes::ColorMappingOverride::OverrideClrMapping(cm) => {
            w.start_element("a:overrideClrMapping")
                .attr("bg1", cm.bg1.to_ooxml())
                .attr("tx1", cm.tx1.to_ooxml())
                .attr("bg2", cm.bg2.to_ooxml())
                .attr("tx2", cm.tx2.to_ooxml())
                .attr("accent1", cm.accent1.to_ooxml())
                .attr("accent2", cm.accent2.to_ooxml())
                .attr("accent3", cm.accent3.to_ooxml())
                .attr("accent4", cm.accent4.to_ooxml())
                .attr("accent5", cm.accent5.to_ooxml())
                .attr("accent6", cm.accent6.to_ooxml())
                .attr("hlink", cm.hlink.to_ooxml())
                .attr("folHlink", cm.fol_hlink.to_ooxml())
                .self_close();
        }
    }

    w.end_element("c:clrMapOvr");
}
