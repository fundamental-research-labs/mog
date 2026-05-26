use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::StrRef;
use ooxml_types::charts::{
    ChartLines, ChartText, DataTableConfig, ManualLayout, NumFmt, PictureOptions, UpDownBars,
};

use super::shape_props::emit_shape_properties;
use super::text_body::emit_text_body;
use super::util::format_f64;

pub(super) fn emit_chart_text(w: &mut XmlWriter, ct: &ChartText) {
    w.start_element("c:tx").end_attrs();

    match ct {
        ChartText::Rich(tb) => {
            emit_text_body(w, tb, "c:rich");
        }
        ChartText::StrRef(r) => {
            emit_str_ref(w, r);
        }
    }

    w.end_element("c:tx");
}

fn emit_str_ref(w: &mut XmlWriter, r: &StrRef) {
    w.start_element("c:strRef").end_attrs();
    w.element_with_text("c:f", &r.f);
    if let Some(ref cache) = r.str_cache {
        w.start_element("c:strCache").end_attrs();
        if let Some(pc) = cache.pt_count {
            w.start_element("c:ptCount")
                .attr("val", &pc.to_string())
                .self_close();
        }
        for pt in &cache.pts {
            w.start_element("c:pt")
                .attr("idx", &pt.idx.to_string())
                .end_attrs();
            w.element_with_text("c:v", &pt.v);
            w.end_element("c:pt");
        }
        w.end_element("c:strCache");
    }
    w.end_element("c:strRef");
}

pub(super) fn emit_chart_lines(w: &mut XmlWriter, cl: &ChartLines, tag: &str) {
    if let Some(ref sp) = cl.sp_pr {
        w.start_element(tag).end_attrs();
        emit_shape_properties(w, sp, "c:spPr");
        w.end_element(tag);
    } else {
        w.start_element(tag).self_close();
    }
}

pub(super) fn emit_up_down_bars(w: &mut XmlWriter, udb: &UpDownBars) {
    w.start_element("c:upDownBars").end_attrs();

    if let Some(v) = udb.gap_width {
        w.start_element("c:gapWidth")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(ref sp) = udb.up_bars {
        w.start_element("c:upBars").end_attrs();
        emit_shape_properties(w, sp, "c:spPr");
        w.end_element("c:upBars");
    } else {
        w.start_element("c:upBars").self_close();
    }
    if let Some(ref sp) = udb.down_bars {
        w.start_element("c:downBars").end_attrs();
        emit_shape_properties(w, sp, "c:spPr");
        w.end_element("c:downBars");
    } else {
        w.start_element("c:downBars").self_close();
    }

    w.end_element("c:upDownBars");
}

pub(super) fn emit_num_fmt(w: &mut XmlWriter, nf: &NumFmt) {
    w.start_element("c:numFmt")
        .attr("formatCode", &nf.format_code);
    if let Some(v) = nf.source_linked {
        w.attr("sourceLinked", if v { "1" } else { "0" });
    }
    w.self_close();
}

pub(super) fn emit_layout(w: &mut XmlWriter, layout: &ManualLayout) {
    let has_content = layout.layout_target.is_some()
        || layout.x_mode.is_some()
        || layout.y_mode.is_some()
        || layout.w_mode.is_some()
        || layout.h_mode.is_some()
        || layout.x.is_some()
        || layout.y.is_some()
        || layout.w.is_some()
        || layout.h.is_some();

    if !has_content {
        w.start_element("c:layout").self_close();
        return;
    }

    w.start_element("c:layout").end_attrs();
    w.start_element("c:manualLayout").end_attrs();

    if let Some(ref lt) = layout.layout_target {
        w.start_element("c:layoutTarget")
            .attr("val", lt.to_ooxml())
            .self_close();
    }
    if let Some(ref m) = layout.x_mode {
        w.start_element("c:xMode")
            .attr("val", m.to_ooxml())
            .self_close();
    }
    if let Some(ref m) = layout.y_mode {
        w.start_element("c:yMode")
            .attr("val", m.to_ooxml())
            .self_close();
    }
    if let Some(ref m) = layout.w_mode {
        w.start_element("c:wMode")
            .attr("val", m.to_ooxml())
            .self_close();
    }
    if let Some(ref m) = layout.h_mode {
        w.start_element("c:hMode")
            .attr("val", m.to_ooxml())
            .self_close();
    }
    if let Some(v) = layout.x {
        w.start_element("c:x")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(v) = layout.y {
        w.start_element("c:y")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(v) = layout.w {
        w.start_element("c:w")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(v) = layout.h {
        w.start_element("c:h")
            .attr("val", &format_f64(v))
            .self_close();
    }

    w.end_element("c:manualLayout");
    w.end_element("c:layout");
}

pub(super) fn emit_data_table(w: &mut XmlWriter, dt: &DataTableConfig) {
    w.start_element("c:dTable").end_attrs();

    if let Some(v) = dt.show_horz_border {
        w.start_element("c:showHorzBorder")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dt.show_vert_border {
        w.start_element("c:showVertBorder")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dt.show_outline {
        w.start_element("c:showOutline")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dt.show_keys {
        w.start_element("c:showKeys")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(ref sp) = dt.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if let Some(ref tb) = dt.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    w.end_element("c:dTable");
}

pub(super) fn emit_picture_options(w: &mut XmlWriter, po: &PictureOptions) {
    w.start_element("c:pictureOptions").end_attrs();

    if let Some(v) = po.apply_to_front {
        w.start_element("c:applyToFront")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = po.apply_to_sides {
        w.start_element("c:applyToSides")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = po.apply_to_end {
        w.start_element("c:applyToEnd")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(ref pf) = po.picture_format {
        w.start_element("c:pictureFormat")
            .attr("val", pf.to_ooxml())
            .self_close();
    }
    if let Some(v) = po.picture_stack_unit {
        w.start_element("c:pictureStackUnit")
            .attr("val", &format_f64(v))
            .self_close();
    }

    w.end_element("c:pictureOptions");
}
