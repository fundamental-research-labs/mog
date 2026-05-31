use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::{CatDataSource, ChartSeries, ChartType, NumDataSource, SeriesTextSource};
use ooxml_types::charts::{NumData, NumRef, StrData, StrRef};

use super::axes::emit_marker;
use super::chart_types::emit_extensions;
use super::labels::{
    emit_data_label, emit_data_labels, emit_data_point, emit_error_bars, emit_trendline,
};
use super::layout::emit_picture_options;
use super::shape_props::emit_shape_properties;

pub(super) fn emit_series(w: &mut XmlWriter, ser: &ChartSeries, chart_type: ChartType) {
    {
        let el = w.start_element("c:ser");
        if let Some(ref st) = ser.raw_series_type_attr {
            el.attr("seriesType", st);
        }
        el.end_attrs();
    }

    // EG_SerShared: idx, order, tx, spPr
    w.start_element("c:idx")
        .attr("val", &ser.idx.to_string())
        .self_close();
    w.start_element("c:order")
        .attr("val", &ser.order.to_string())
        .self_close();

    if let Some(ref tx) = ser.tx {
        emit_series_text(w, tx);
    }
    if let Some(ref sp) = ser.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }

    // Type-specific fields order varies by chart type.
    // We emit fields in a reasonable order that covers all chart types.

    // invertIfNegative (bar, bubble)
    if let Some(v) = ser.invert_if_negative {
        w.start_element("c:invertIfNegative")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // marker (line, scatter, radar)
    if let Some(ref m) = ser.marker {
        emit_marker(w, m);
    }

    // dPt
    for dp in &ser.d_pt {
        emit_data_point(w, dp);
    }

    // dLbls (series-level)
    if let Some(ref dl) = ser.d_lbls {
        emit_data_labels(w, dl);
    }

    // dLbl (individual overrides at series level)
    for dl in &ser.d_lbl {
        emit_data_label(w, dl);
    }

    // trendline
    for t in &ser.trendline {
        emit_trendline(w, t);
    }

    // errBars
    for eb in &ser.err_bars {
        emit_error_bars(w, eb);
    }

    // cat / val (bar, line, pie, area, radar, surface, stock)
    if let Some(ref cat) = ser.cat {
        emit_cat_data_source(w, cat, "c:cat");
    }
    if let Some(ref val) = ser.val {
        emit_num_data_source(w, val, "c:val");
    }

    // xVal / yVal (scatter, bubble)
    if let Some(ref xv) = ser.x_val {
        emit_cat_data_source(w, xv, "c:xVal");
    }
    if let Some(ref yv) = ser.y_val {
        emit_num_data_source(w, yv, "c:yVal");
    }

    // bubbleSize (bubble)
    if let Some(ref bs) = ser.bubble_size {
        emit_num_data_source(w, bs, "c:bubbleSize");
    }

    // bubble3D (bubble)
    if let Some(v) = ser.bubble_3d {
        w.start_element("c:bubble3D")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // explosion (pie, doughnut)
    if let Some(v) = ser.explosion {
        w.start_element("c:explosion")
            .attr("val", &v.to_string())
            .self_close();
    }

    // pictureOptions (bar, bar3D, area, surface)
    if let Some(ref po) = ser.picture_options {
        emit_picture_options(w, po);
    }

    // shape (bar3D)
    if let Some(ref s) = ser.shape {
        w.start_element("c:shape")
            .attr("val", s.to_ooxml())
            .self_close();
    }

    // smooth (line, scatter)
    if let Some(v) = ser.smooth {
        w.start_element("c:smooth")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // extLst — emit raw XML for lossless round-trip
    if !ser.extensions.is_empty() {
        emit_extensions(w, &ser.extensions);
    } else if ser.has_empty_ext_lst {
        w.start_element("c:extLst").self_close();
    }

    // Suppress unused variable warning
    let _ = chart_type;

    w.end_element("c:ser");
}

// ============================================================================
// Data sources
// ============================================================================

pub(super) fn emit_num_data_source(w: &mut XmlWriter, src: &NumDataSource, tag: &str) {
    w.start_element(tag).end_attrs();
    match src {
        NumDataSource::Ref(r) => emit_num_ref(w, r),
        NumDataSource::Lit(d) => emit_num_cache(w, d, "c:numLit"),
    }
    w.end_element(tag);
}

fn emit_cat_data_source(w: &mut XmlWriter, src: &CatDataSource, tag: &str) {
    w.start_element(tag).end_attrs();
    match src {
        CatDataSource::NumRef(r) => emit_num_ref(w, r),
        CatDataSource::NumLit(d) => emit_num_cache(w, d, "c:numLit"),
        CatDataSource::StrRef(r) => emit_str_ref(w, r),
        CatDataSource::StrLit(d) => emit_str_cache(w, d, "c:strLit"),
        CatDataSource::MultiLvlStrRef(r) => emit_multi_lvl_str_ref(w, r),
    }
    w.end_element(tag);
}

fn emit_series_text(w: &mut XmlWriter, tx: &SeriesTextSource) {
    w.start_element("c:tx").end_attrs();
    match tx {
        SeriesTextSource::StrRef(r) => emit_str_ref(w, r),
        SeriesTextSource::Value(v) => {
            w.element_with_text("c:v", v);
        }
    }
    w.end_element("c:tx");
}

fn emit_num_ref(w: &mut XmlWriter, r: &NumRef) {
    w.start_element("c:numRef").end_attrs();
    w.element_with_text("c:f", &r.f);
    if let Some(ref cache) = r.num_cache {
        emit_num_cache(w, cache, "c:numCache");
    }
    w.end_element("c:numRef");
}

fn emit_str_ref(w: &mut XmlWriter, r: &StrRef) {
    w.start_element("c:strRef").end_attrs();
    w.element_with_text("c:f", &r.f);
    if let Some(ref cache) = r.str_cache {
        emit_str_cache(w, cache, "c:strCache");
    }
    w.end_element("c:strRef");
}

fn emit_num_cache(w: &mut XmlWriter, d: &NumData, tag: &str) {
    w.start_element(tag).end_attrs();
    if let Some(ref fc) = d.format_code {
        w.element_with_text("c:formatCode", fc);
    }
    if let Some(pc) = d.pt_count {
        w.start_element("c:ptCount")
            .attr("val", &pc.to_string())
            .self_close();
    }
    for pt in &d.pts {
        w.start_element("c:pt").attr("idx", &pt.idx.to_string());
        if let Some(ref fc) = pt.format_code {
            w.attr("formatCode", fc);
        }
        w.end_attrs();
        w.element_with_text("c:v", &pt.v);
        w.end_element("c:pt");
    }
    w.end_element(tag);
}

fn emit_str_cache(w: &mut XmlWriter, d: &StrData, tag: &str) {
    w.start_element(tag).end_attrs();
    if let Some(pc) = d.pt_count {
        w.start_element("c:ptCount")
            .attr("val", &pc.to_string())
            .self_close();
    }
    for pt in &d.pts {
        w.start_element("c:pt")
            .attr("idx", &pt.idx.to_string())
            .end_attrs();
        w.element_with_text("c:v", &pt.v);
        w.end_element("c:pt");
    }
    w.end_element(tag);
}

fn emit_multi_lvl_str_ref(w: &mut XmlWriter, r: &ooxml_types::charts::MultiLvlStrRef) {
    w.start_element("c:multiLvlStrRef").end_attrs();
    w.element_with_text("c:f", &r.f);
    if let Some(ref cache) = r.multi_lvl_str_cache {
        w.start_element("c:multiLvlStrCache").end_attrs();
        if let Some(pc) = cache.pt_count {
            w.start_element("c:ptCount")
                .attr("val", &pc.to_string())
                .self_close();
        }
        for level in &cache.levels {
            w.start_element("c:lvl").end_attrs();
            if let Some(pc) = level.pt_count {
                w.start_element("c:ptCount")
                    .attr("val", &pc.to_string())
                    .self_close();
            }
            for pt in &level.pts {
                w.start_element("c:pt")
                    .attr("idx", &pt.idx.to_string())
                    .end_attrs();
                w.element_with_text("c:v", &pt.v);
                w.end_element("c:pt");
            }
            w.end_element("c:lvl");
        }
        w.end_element("c:multiLvlStrCache");
    }
    w.end_element("c:multiLvlStrRef");
}
