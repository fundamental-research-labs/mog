use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::{
    AxisCrosses, AxisType, ChartAxis, DisplayUnitKind, DisplayUnits, DisplayUnitsLabel, Marker,
    Scaling, TickLabelPosition, TickMark,
};

use super::layout::{emit_chart_lines, emit_chart_text, emit_layout, emit_num_fmt};
use super::shape_props::emit_shape_properties;
use super::structure::emit_title;
use super::text_body::emit_text_body;
use super::util::format_f64;

pub(super) fn emit_axis(w: &mut XmlWriter, axis: &ChartAxis) {
    let tag = match axis.axis_type {
        AxisType::Category => "c:catAx",
        AxisType::Value => "c:valAx",
        AxisType::Date => "c:dateAx",
        AxisType::Series => "c:serAx",
    };

    {
        let el = w.start_element(tag);
        if let Some(ref at) = axis.raw_axis_type_attr {
            el.attr("axisType", at);
        }
        el.end_attrs();
    }

    // EG_AxShared
    w.start_element("c:axId")
        .attr("val", &axis.ax_id.to_string())
        .self_close();

    emit_scaling(w, &axis.scaling);

    if axis.delete || axis.delete_explicit {
        w.start_element("c:delete")
            .attr("val", if axis.delete { "1" } else { "0" })
            .self_close();
    }

    w.start_element("c:axPos")
        .attr("val", axis.ax_pos.to_ooxml())
        .self_close();

    if let Some(ref gl) = axis.major_gridlines {
        emit_chart_lines(w, gl, "c:majorGridlines");
    }
    if let Some(ref gl) = axis.minor_gridlines {
        emit_chart_lines(w, gl, "c:minorGridlines");
    }

    if let Some(ref t) = axis.title {
        emit_title(w, t);
    }

    if let Some(ref nf) = axis.num_fmt {
        emit_num_fmt(w, nf);
    }

    if axis.major_tick_mark_explicit || axis.major_tick_mark != TickMark::Cross {
        w.start_element("c:majorTickMark")
            .attr("val", axis.major_tick_mark.to_ooxml())
            .self_close();
    }
    if axis.minor_tick_mark_explicit || axis.minor_tick_mark != TickMark::Cross {
        w.start_element("c:minorTickMark")
            .attr("val", axis.minor_tick_mark.to_ooxml())
            .self_close();
    }
    if axis.tick_lbl_pos_explicit || axis.tick_lbl_pos != TickLabelPosition::NextTo {
        w.start_element("c:tickLblPos")
            .attr("val", axis.tick_lbl_pos.to_ooxml())
            .self_close();
    }

    if let Some(ref sp) = axis.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if let Some(ref tb) = axis.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    w.start_element("c:crossAx")
        .attr("val", &axis.cross_ax.to_string())
        .self_close();

    if axis.crosses_explicit || axis.crosses != AxisCrosses::AutoZero {
        match axis.crosses {
            ooxml_types::charts::AxisCrosses::AutoZero => {
                w.start_element("c:crosses")
                    .attr("val", "autoZero")
                    .self_close();
            }
            ooxml_types::charts::AxisCrosses::Min => {
                w.start_element("c:crosses").attr("val", "min").self_close();
            }
            ooxml_types::charts::AxisCrosses::Max => {
                w.start_element("c:crosses").attr("val", "max").self_close();
            }
        }
    }

    if let Some(v) = axis.crosses_at {
        w.start_element("c:crossesAt")
            .attr("val", &format_f64(v))
            .self_close();
    }

    // Type-specific fields
    match axis.axis_type {
        AxisType::Category => {
            if let Some(v) = axis.auto {
                w.start_element("c:auto")
                    .attr("val", if v { "1" } else { "0" })
                    .self_close();
            }
            if let Some(ref la) = axis.lbl_algn {
                w.start_element("c:lblAlgn")
                    .attr("val", la.to_ooxml())
                    .self_close();
            }
            if let Some(v) = axis.lbl_offset {
                w.start_element("c:lblOffset")
                    .attr("val", &v.to_string())
                    .self_close();
            }
            if let Some(v) = axis.tick_lbl_skip {
                w.start_element("c:tickLblSkip")
                    .attr("val", &v.to_string())
                    .self_close();
            }
            if let Some(v) = axis.tick_mark_skip {
                w.start_element("c:tickMarkSkip")
                    .attr("val", &v.to_string())
                    .self_close();
            }
            if let Some(v) = axis.no_multi_lvl_lbl {
                w.start_element("c:noMultiLvlLbl")
                    .attr("val", if v { "1" } else { "0" })
                    .self_close();
            }
        }
        AxisType::Value => {
            if let Some(ref cb) = axis.cross_between {
                w.start_element("c:crossBetween")
                    .attr("val", cb.to_ooxml())
                    .self_close();
            }
            if let Some(v) = axis.major_unit {
                w.start_element("c:majorUnit")
                    .attr("val", &format_f64(v))
                    .self_close();
            }
            if let Some(v) = axis.minor_unit {
                w.start_element("c:minorUnit")
                    .attr("val", &format_f64(v))
                    .self_close();
            }
            if let Some(ref du) = axis.disp_units {
                emit_display_units(w, du);
            }
        }
        AxisType::Date => {
            if let Some(v) = axis.auto {
                w.start_element("c:auto")
                    .attr("val", if v { "1" } else { "0" })
                    .self_close();
            }
            if let Some(v) = axis.lbl_offset {
                w.start_element("c:lblOffset")
                    .attr("val", &v.to_string())
                    .self_close();
            }
            if let Some(ref tu) = axis.base_time_unit {
                w.start_element("c:baseTimeUnit")
                    .attr("val", tu.to_ooxml())
                    .self_close();
            }
            if let Some(v) = axis.major_unit {
                w.start_element("c:majorUnit")
                    .attr("val", &format_f64(v))
                    .self_close();
            }
            if let Some(ref tu) = axis.major_time_unit {
                w.start_element("c:majorTimeUnit")
                    .attr("val", tu.to_ooxml())
                    .self_close();
            }
            if let Some(v) = axis.minor_unit {
                w.start_element("c:minorUnit")
                    .attr("val", &format_f64(v))
                    .self_close();
            }
            if let Some(ref tu) = axis.minor_time_unit {
                w.start_element("c:minorTimeUnit")
                    .attr("val", tu.to_ooxml())
                    .self_close();
            }
        }
        AxisType::Series => {
            if let Some(v) = axis.tick_lbl_skip {
                w.start_element("c:tickLblSkip")
                    .attr("val", &v.to_string())
                    .self_close();
            }
            if let Some(v) = axis.tick_mark_skip {
                w.start_element("c:tickMarkSkip")
                    .attr("val", &v.to_string())
                    .self_close();
            }
        }
    }

    w.end_element(tag);
}

fn emit_scaling(w: &mut XmlWriter, scaling: &Scaling) {
    w.start_element("c:scaling").end_attrs();

    if let Some(v) = scaling.log_base {
        w.start_element("c:logBase")
            .attr("val", &format_f64(v))
            .self_close();
    }
    w.start_element("c:orientation")
        .attr("val", scaling.orientation.to_ooxml())
        .self_close();
    if let Some(v) = scaling.max {
        w.start_element("c:max")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(v) = scaling.min {
        w.start_element("c:min")
            .attr("val", &format_f64(v))
            .self_close();
    }

    w.end_element("c:scaling");
}

fn emit_display_units(w: &mut XmlWriter, du: &DisplayUnits) {
    w.start_element("c:dispUnits").end_attrs();

    if let Some(ref kind) = du.kind {
        match kind {
            DisplayUnitKind::BuiltIn(bi) => {
                w.start_element("c:builtInUnit")
                    .attr("val", bi.to_ooxml())
                    .self_close();
            }
            DisplayUnitKind::Custom(v) => {
                w.start_element("c:custUnit")
                    .attr("val", &format_f64(*v))
                    .self_close();
            }
        }
    }

    if let Some(ref lbl) = du.disp_units_lbl {
        emit_display_units_label(w, lbl);
    }

    w.end_element("c:dispUnits");
}

fn emit_display_units_label(w: &mut XmlWriter, lbl: &DisplayUnitsLabel) {
    w.start_element("c:dispUnitsLbl").end_attrs();

    if let Some(ref lay) = lbl.layout {
        emit_layout(w, lay);
    }
    if let Some(ref tx) = lbl.tx {
        emit_chart_text(w, tx);
    }
    if let Some(ref sp) = lbl.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if let Some(ref tb) = lbl.tx_pr {
        emit_text_body(w, tb, "c:txPr");
    }

    w.end_element("c:dispUnitsLbl");
}

pub(super) fn emit_marker(w: &mut XmlWriter, marker: &Marker) {
    w.start_element("c:marker").end_attrs();

    if let Some(ref sym) = marker.symbol {
        w.start_element("c:symbol")
            .attr("val", sym.to_ooxml())
            .self_close();
    }
    if let Some(v) = marker.size {
        w.start_element("c:size")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(ref sp) = marker.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }

    w.end_element("c:marker");
}
