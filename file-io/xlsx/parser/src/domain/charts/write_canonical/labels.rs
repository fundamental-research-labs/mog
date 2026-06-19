use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::{
    DataLabel, DataLabelOptions, DataPointOverride, ErrorBars, Trendline, TrendlineLabel,
};

use super::axes::emit_marker;
use super::chart_types::emit_extensions;
use super::layout::{
    emit_chart_lines, emit_chart_text, emit_layout, emit_num_fmt, emit_picture_options,
};
use super::series::emit_num_data_source;
use super::shape_props::emit_shape_properties;
use super::text_body::emit_text_body;
use super::util::format_f64;

pub(super) fn emit_data_labels(w: &mut XmlWriter, dl: &DataLabelOptions) {
    w.start_element("c:dLbls").end_attrs();

    // Individual overrides first (CT_DLbl within CT_DLbls)
    for lbl in &dl.d_lbl {
        emit_data_label(w, lbl);
    }

    // If delete is set, that's the choice alternative
    if let Some(v) = dl.delete {
        w.start_element("c:delete")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
        if !dl.extensions.is_empty() {
            emit_extensions(w, &dl.extensions);
        }
        w.end_element("c:dLbls");
        return;
    }

    // numFmt
    if let Some(ref nf) = dl.num_fmt_obj {
        emit_num_fmt(w, nf);
    } else if let Some(ref nfs) = dl.num_fmt {
        w.start_element("c:numFmt")
            .attr("formatCode", nfs)
            .attr("sourceLinked", "0")
            .self_close();
    }

    // spPr
    if let Some(ref sp) = dl.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }

    // txPr
    if let Some(ref tb) = dl.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    // layout
    if let Some(ref lay) = dl.layout {
        emit_layout(w, lay);
    }

    // dLblPos
    let pos_str = dl.position.to_ooxml();
    if pos_str != "bestFit" {
        // Only emit if not the default
        w.start_element("c:dLblPos")
            .attr("val", pos_str)
            .self_close();
    }

    emit_present_or_true_bool(
        w,
        "c:showLegendKey",
        dl.show_legend_key,
        dl.show_legend_key_present,
    );
    emit_present_or_true_bool(w, "c:showVal", dl.show_value, dl.show_value_present);
    emit_present_or_true_bool(
        w,
        "c:showCatName",
        dl.show_category,
        dl.show_category_present,
    );
    emit_present_or_true_bool(
        w,
        "c:showSerName",
        dl.show_series_name,
        dl.show_series_name_present,
    );
    emit_present_or_true_bool(w, "c:showPercent", dl.show_percent, dl.show_percent_present);
    emit_present_or_true_bool(
        w,
        "c:showBubbleSize",
        dl.show_bubble_size,
        dl.show_bubble_size_present,
    );

    // separator
    if let Some(ref sep) = dl.separator {
        w.element_with_text("c:separator", sep);
    }

    // showLeaderLines
    if let Some(v) = dl.show_leader_lines {
        w.start_element("c:showLeaderLines")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // leaderLines
    if let Some(ref ll) = dl.leader_lines {
        emit_chart_lines(w, ll, "c:leaderLines");
    }

    // extLst
    if !dl.extensions.is_empty() {
        emit_extensions(w, &dl.extensions);
    }

    w.end_element("c:dLbls");
}

pub(super) fn emit_data_label(w: &mut XmlWriter, dl: &DataLabel) {
    w.start_element("c:dLbl").end_attrs();

    w.start_element("c:idx")
        .attr("val", &dl.idx.to_string())
        .self_close();

    // delete — if set, this is the choice alternative
    if let Some(v) = dl.delete {
        w.start_element("c:delete")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
        // Emit extensions even when delete is set (e.g. c16:uniqueId)
        if !dl.extensions.is_empty() {
            emit_extensions(w, &dl.extensions);
        }
        w.end_element("c:dLbl");
        return;
    }

    // layout
    if let Some(ref lay) = dl.layout {
        emit_layout(w, lay);
    }

    // tx (custom text)
    if let Some(ref tx) = dl.text {
        emit_chart_text(w, tx);
    }

    // numFmt
    if let Some(ref nf) = dl.num_fmt {
        emit_num_fmt(w, nf);
    }

    // spPr
    if let Some(ref sp) = dl.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }

    // txPr
    if let Some(ref tb) = dl.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    // dLblPos
    if let Some(ref pos) = dl.position {
        w.start_element("c:dLblPos")
            .attr("val", pos.to_ooxml())
            .self_close();
    }

    // showLegendKey
    if let Some(v) = dl.show_legend_key {
        w.start_element("c:showLegendKey")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dl.show_value {
        w.start_element("c:showVal")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dl.show_category {
        w.start_element("c:showCatName")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dl.show_series_name {
        w.start_element("c:showSerName")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dl.show_percent {
        w.start_element("c:showPercent")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dl.show_bubble_size {
        w.start_element("c:showBubbleSize")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    // separator
    if let Some(ref sep) = dl.separator {
        w.element_with_text("c:separator", sep);
    }

    // extLst
    if !dl.extensions.is_empty() {
        emit_extensions(w, &dl.extensions);
    }

    w.end_element("c:dLbl");
}

pub(super) fn emit_data_point(w: &mut XmlWriter, dp: &DataPointOverride) {
    w.start_element("c:dPt").end_attrs();

    w.start_element("c:idx")
        .attr("val", &dp.idx.to_string())
        .self_close();

    if let Some(v) = dp.invert_if_negative {
        w.start_element("c:invertIfNegative")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(ref m) = dp.marker {
        emit_marker(w, m);
    }
    if let Some(v) = dp.bubble_3d {
        w.start_element("c:bubble3D")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = dp.explosion {
        w.start_element("c:explosion")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(ref sp) = dp.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if let Some(ref po) = dp.picture_options {
        emit_picture_options(w, po);
    }

    // extLst
    if !dp.extensions.is_empty() {
        emit_extensions(w, &dp.extensions);
    }

    w.end_element("c:dPt");
}

fn emit_present_or_true_bool(w: &mut XmlWriter, name: &str, value: bool, present: bool) {
    if !present && !value {
        return;
    }
    w.start_element(name)
        .attr("val", if value { "1" } else { "0" })
        .self_close();
}

pub(super) fn emit_trendline(w: &mut XmlWriter, t: &Trendline) {
    w.start_element("c:trendline").end_attrs();

    if let Some(ref name) = t.name {
        w.element_with_text("c:name", name);
    }
    if let Some(ref sp) = t.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }

    w.start_element("c:trendlineType")
        .attr("val", t.trendline_type.to_ooxml())
        .self_close();

    if let Some(v) = t.order {
        w.start_element("c:order")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = t.period {
        w.start_element("c:period")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = t.forward {
        w.start_element("c:forward")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(v) = t.backward {
        w.start_element("c:backward")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(v) = t.intercept {
        w.start_element("c:intercept")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(v) = t.disp_r_sqr {
        w.start_element("c:dispRSqr")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = t.disp_eq {
        w.start_element("c:dispEq")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    if let Some(ref lbl) = t.trendline_lbl {
        emit_trendline_label(w, lbl);
    }

    w.end_element("c:trendline");
}

fn emit_trendline_label(w: &mut XmlWriter, lbl: &TrendlineLabel) {
    w.start_element("c:trendlineLbl").end_attrs();

    if let Some(ref lay) = lbl.layout {
        emit_layout(w, lay);
    }
    if let Some(ref tx) = lbl.tx {
        emit_chart_text(w, tx);
    }
    if let Some(ref nf) = lbl.num_fmt {
        emit_num_fmt(w, nf);
    }
    if let Some(ref sp) = lbl.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if let Some(ref tb) = lbl.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }
    if !lbl.extensions.is_empty() {
        emit_extensions(w, &lbl.extensions);
    }

    w.end_element("c:trendlineLbl");
}

pub(super) fn emit_error_bars(w: &mut XmlWriter, eb: &ErrorBars) {
    w.start_element("c:errBars").end_attrs();

    if let Some(ref dir) = eb.err_dir {
        w.start_element("c:errDir")
            .attr("val", dir.to_ooxml())
            .self_close();
    }
    w.start_element("c:errBarType")
        .attr("val", eb.err_bar_type.to_ooxml())
        .self_close();
    w.start_element("c:errValType")
        .attr("val", eb.err_val_type.to_ooxml())
        .self_close();

    if let Some(v) = eb.no_end_cap {
        w.start_element("c:noEndCap")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    if let Some(ref plus) = eb.plus {
        emit_num_data_source(w, plus, "c:plus");
    }
    if let Some(ref minus) = eb.minus {
        emit_num_data_source(w, minus, "c:minus");
    }

    if let Some(v) = eb.val {
        w.start_element("c:val")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(ref sp) = eb.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if !eb.extensions.is_empty() {
        emit_extensions(w, &eb.extensions);
    }

    w.end_element("c:errBars");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render_data_labels(labels: &DataLabelOptions) -> String {
        let mut writer = XmlWriter::new();
        emit_data_labels(&mut writer, labels);
        String::from_utf8(writer.finish()).expect("data labels XML should be UTF-8")
    }

    #[test]
    fn emit_data_labels_omits_absent_false_show_flags() {
        let xml = render_data_labels(&DataLabelOptions::default());

        assert!(!xml.contains("<c:showLegendKey"));
        assert!(!xml.contains("<c:showVal"));
        assert!(!xml.contains("<c:showCatName"));
        assert!(!xml.contains("<c:showSerName"));
        assert!(!xml.contains("<c:showPercent"));
        assert!(!xml.contains("<c:showBubbleSize"));
    }

    #[test]
    fn emit_data_labels_preserves_explicit_false_show_flags() {
        let labels = DataLabelOptions {
            show_value_present: true,
            show_category_present: true,
            ..Default::default()
        };

        let xml = render_data_labels(&labels);

        assert!(xml.contains("<c:showVal val=\"0\"/>"));
        assert!(xml.contains("<c:showCatName val=\"0\"/>"));
        assert!(!xml.contains("<c:showSerName"));
        assert!(!xml.contains("<c:showPercent"));
    }

    #[test]
    fn emit_data_labels_preserves_true_show_flags_without_presence_metadata() {
        let labels = DataLabelOptions {
            show_value: true,
            ..Default::default()
        };

        let xml = render_data_labels(&labels);

        assert!(xml.contains("<c:showVal val=\"1\"/>"));
    }
}
