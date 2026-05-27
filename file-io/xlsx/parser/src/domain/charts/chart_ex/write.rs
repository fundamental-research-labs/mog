//! ChartEx XML serializer — serializes `ChartExSpace` to `cx:chartSpace` XML.
//!
//! Reuses existing DrawingML emitters for `a:*` elements (spPr, txPr).

use crate::write::xml_writer::XmlWriter;
use ooxml_types::chart_ex::*;

use crate::domain::charts::write_canonical::{emit_shape_properties, emit_text_body};

// =============================================================================
// Constants
// =============================================================================

const NS_CHART_EX: &str = "http://schemas.microsoft.com/office/drawing/2014/chartex";
const NS_DRAWING: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// =============================================================================
// Main entry point
// =============================================================================

/// Serialize a `ChartExSpace` to complete ChartEx XML bytes.
pub fn serialize_chart_ex_space(cs: &ChartExSpace) -> Vec<u8> {
    let mut w = XmlWriter::new();
    w.write_declaration();

    w.start_element("cx:chartSpace")
        .attr("xmlns:cx", NS_CHART_EX)
        .attr("xmlns:a", NS_DRAWING)
        .attr("xmlns:r", NS_REL)
        .end_attrs();

    // chartData
    emit_chart_data(&mut w, &cs.chart_data);

    // chart
    emit_chart(&mut w, &cs.chart);

    // fmtOvrs
    if !cs.fmt_ovrs.is_empty() {
        w.start_element("cx:fmtOvrs").end_attrs();
        for ovr in &cs.fmt_ovrs {
            if let Some(ref sp) = ovr.sp_pr {
                w.start_element("cx:fmtOvr")
                    .attr_num("idx", ovr.idx)
                    .end_attrs();
                emit_shape_properties(&mut w, sp, "cx:spPr");
                w.end_element("cx:fmtOvr");
            } else {
                w.start_element("cx:fmtOvr")
                    .attr_num("idx", ovr.idx)
                    .self_close();
            }
        }
        w.end_element("cx:fmtOvrs");
    }

    // spPr
    if let Some(ref sp) = cs.sp_pr {
        emit_shape_properties(&mut w, sp, "cx:spPr");
    }

    // txPr
    if let Some(ref tb) = cs.tx_pr {
        emit_text_body(&mut w, tb, "cx:txPr");
    }

    // printSettings
    if let Some(ref ps) = cs.print_settings {
        if let Some(ref raw) = ps.raw_xml
            && !crate::infra::xml::raw_xml_contains_relationship_attr(raw)
        {
            w.raw(raw.as_bytes());
        }
    }

    w.end_element("cx:chartSpace");
    w.finish()
}

// =============================================================================
// ChartData
// =============================================================================

fn emit_chart_data(w: &mut XmlWriter, cd: &ChartExChartData) {
    if cd.data.is_empty() {
        return;
    }

    w.start_element("cx:chartData").end_attrs();

    for data in &cd.data {
        w.start_element("cx:data")
            .attr_num("id", data.id)
            .end_attrs();

        for dim in &data.dimensions {
            match dim {
                ChartExDimension::String { dim_type, formula } => {
                    w.start_element("cx:strDim")
                        .attr("type", dim_type)
                        .end_attrs();
                    emit_formula(w, formula);
                    w.end_element("cx:strDim");
                }
                ChartExDimension::Numeric { dim_type, formula } => {
                    w.start_element("cx:numDim")
                        .attr("type", dim_type)
                        .end_attrs();
                    emit_formula(w, formula);
                    w.end_element("cx:numDim");
                }
            }
        }

        w.end_element("cx:data");
    }

    w.end_element("cx:chartData");
}

fn emit_formula(w: &mut XmlWriter, f: &ChartExFormula) {
    w.start_element("cx:f");
    if let Some(ref dir) = f.dir {
        w.attr("dir", dir);
    }
    w.end_attrs();
    w.text(&f.content);
    w.end_element("cx:f");
}

// =============================================================================
// Chart
// =============================================================================

fn emit_chart(w: &mut XmlWriter, chart: &ChartExChart) {
    w.start_element("cx:chart").end_attrs();

    // title
    if let Some(ref title) = chart.title {
        emit_title(w, title);
    }

    // plotArea
    emit_plot_area(w, &chart.plot_area);

    // legend
    if let Some(ref legend) = chart.legend {
        emit_legend(w, legend);
    }

    w.end_element("cx:chart");
}

// =============================================================================
// Title
// =============================================================================

fn emit_title(w: &mut XmlWriter, title: &ChartExTitle) {
    w.start_element("cx:title");
    if let Some(ref pos) = title.pos {
        w.attr("pos", pos);
    }
    if let Some(ref align) = title.align {
        w.attr("align", align);
    }
    if let Some(overlay) = title.overlay {
        w.attr("overlay", if overlay { "1" } else { "0" });
    }
    w.end_attrs();

    // tx
    if let Some(ref tx) = title.tx {
        emit_text(w, tx);
    }

    // txPr
    if let Some(ref tx_pr) = title.tx_pr {
        emit_text_body(w, tx_pr, "cx:txPr");
    }

    // spPr
    if let Some(ref sp) = title.sp_pr {
        emit_shape_properties(w, sp, "cx:spPr");
    }

    w.end_element("cx:title");
}

fn emit_text(w: &mut XmlWriter, text: &ChartExText) {
    w.start_element("cx:tx").end_attrs();

    if let Some(ref td) = text.tx_data {
        emit_tx_data(w, td);
    }

    if let Some(ref rich) = text.rich {
        emit_text_body(w, rich, "cx:rich");
    }

    w.end_element("cx:tx");
}

fn emit_tx_data(w: &mut XmlWriter, td: &ChartExTxData) {
    w.start_element("cx:txData").end_attrs();

    if let Some(ref f) = td.formula {
        w.start_element("cx:f").end_attrs();
        w.text(f);
        w.end_element("cx:f");
    }

    if let Some(ref v) = td.value {
        w.start_element("cx:v").end_attrs();
        w.text(v);
        w.end_element("cx:v");
    }

    w.end_element("cx:txData");
}

// =============================================================================
// PlotArea
// =============================================================================

fn emit_plot_area(w: &mut XmlWriter, pa: &ChartExPlotArea) {
    w.start_element("cx:plotArea").end_attrs();

    // plotAreaRegion
    emit_plot_area_region(w, &pa.plot_area_region);

    // axes (before spPr per OOXML spec)
    for axis in &pa.axes {
        emit_axis(w, axis);
    }

    // spPr (plot area shape properties — after axes)
    if let Some(ref sp) = pa.sp_pr {
        emit_shape_properties(w, sp, "cx:spPr");
    }

    w.end_element("cx:plotArea");
}

fn emit_plot_area_region(w: &mut XmlWriter, par: &ChartExPlotAreaRegion) {
    if par.series.is_empty() && par.sp_pr.is_none() {
        w.start_element("cx:plotAreaRegion").self_close();
        return;
    }

    w.start_element("cx:plotAreaRegion").end_attrs();

    if let Some(ref sp) = par.sp_pr {
        emit_shape_properties(w, sp, "cx:spPr");
    }

    for series in &par.series {
        emit_series(w, series);
    }

    w.end_element("cx:plotAreaRegion");
}

// =============================================================================
// Series
// =============================================================================

fn emit_series(w: &mut XmlWriter, ser: &ChartExSeries) {
    w.start_element("cx:series")
        .attr("layoutId", ser.layout_id.to_ooxml());
    // ECMA-376 attribute order: layoutId, hidden, uniqueId, formatIdx
    if let Some(hidden) = ser.hidden {
        w.attr("hidden", if hidden { "1" } else { "0" });
    }
    if let Some(ref uid) = ser.unique_id {
        w.attr("uniqueId", uid);
    }
    if let Some(fi) = ser.format_idx {
        w.attr_num("formatIdx", fi);
    }
    w.end_attrs();

    // tx
    if let Some(ref tx) = ser.tx {
        emit_text(w, tx);
    }

    // spPr
    if let Some(ref sp) = ser.sp_pr {
        emit_shape_properties(w, sp, "cx:spPr");
    }

    // dataPt (per-data-point overrides)
    for dpt in &ser.data_points {
        if let Some(ref sp) = dpt.sp_pr {
            w.start_element("cx:dataPt")
                .attr_num("idx", dpt.idx)
                .end_attrs();
            emit_shape_properties(w, sp, "cx:spPr");
            w.end_element("cx:dataPt");
        } else {
            w.start_element("cx:dataPt")
                .attr_num("idx", dpt.idx)
                .self_close();
        }
    }

    // dataLabels
    if let Some(ref dl) = ser.data_labels {
        emit_data_labels(w, dl);
    }

    // dataId
    if let Some(data_id) = ser.data_id {
        w.start_element("cx:dataId")
            .attr_num("val", data_id)
            .self_close();
    }

    // layoutPr
    if let Some(ref lp) = ser.layout_pr {
        emit_layout_props(w, lp);
    }

    w.end_element("cx:series");
}

// =============================================================================
// DataLabels
// =============================================================================

fn emit_data_labels(w: &mut XmlWriter, dl: &ChartExDataLabels) {
    w.start_element("cx:dataLabels");
    if let Some(ref pos) = dl.pos {
        w.attr("pos", pos);
    }
    w.end_attrs();

    // txPr (before visibility per corpus order)
    if let Some(ref tx_pr) = dl.tx_pr {
        emit_text_body(w, tx_pr, "cx:txPr");
    }

    // visibility
    if let Some(ref vis) = dl.visibility {
        w.start_element("cx:visibility");
        if let Some(v) = vis.series_name {
            w.attr("seriesName", if v { "1" } else { "0" });
        }
        if let Some(v) = vis.category_name {
            w.attr("categoryName", if v { "1" } else { "0" });
        }
        if let Some(v) = vis.value {
            w.attr("value", if v { "1" } else { "0" });
        }
        w.self_close();
    }

    // numFmt
    if let Some(ref nf) = dl.num_fmt {
        w.start_element("cx:numFmt")
            .attr("formatCode", &nf.format_code);
        if let Some(sl) = nf.source_linked {
            w.attr("sourceLinked", if sl { "1" } else { "0" });
        }
        w.self_close();
    }

    // spPr
    if let Some(ref sp) = dl.sp_pr {
        emit_shape_properties(w, sp, "cx:spPr");
    }

    // separator
    if let Some(ref sep) = dl.separator {
        w.start_element("cx:separator").end_attrs();
        w.text(sep);
        w.end_element("cx:separator");
    }

    w.end_element("cx:dataLabels");
}

// =============================================================================
// Layout Properties
// =============================================================================

fn emit_layout_props(w: &mut XmlWriter, lp: &ChartExLayoutProperties) {
    w.start_element("cx:layoutPr").end_attrs();

    // visibility
    if let Some(ref vis) = lp.visibility {
        w.start_element("cx:visibility");
        if let Some(v) = vis.connector_lines {
            w.attr("connectorLines", if v { "1" } else { "0" });
        }
        if let Some(v) = vis.mean_line {
            w.attr("meanLine", if v { "1" } else { "0" });
        }
        if let Some(v) = vis.mean_marker {
            w.attr("meanMarker", if v { "1" } else { "0" });
        }
        if let Some(v) = vis.non_outlier_points {
            w.attr("nonoutlierPoints", if v { "1" } else { "0" });
        }
        if let Some(v) = vis.outlier_points {
            w.attr("outlierPoints", if v { "1" } else { "0" });
        }
        w.self_close();
    }

    // subtotals
    if let Some(ref st) = lp.subtotals {
        if st.idx.is_empty() {
            w.start_element("cx:subtotals").self_close();
        } else {
            w.start_element("cx:subtotals").end_attrs();
            for &idx in &st.idx {
                w.start_element("cx:idx").attr_num("val", idx).self_close();
            }
            w.end_element("cx:subtotals");
        }
    }

    // parentLabelLayout
    if let Some(ref pll) = lp.parent_label_layout {
        w.start_element("cx:parentLabelLayout")
            .attr("val", pll)
            .self_close();
    }

    // binning
    if let Some(ref bin) = lp.binning {
        emit_binning(w, bin);
    }

    // statistics
    if let Some(ref stat) = lp.statistics {
        w.start_element("cx:statistics");
        if let Some(ref qm) = stat.quartile_method {
            w.attr("quartileMethod", qm);
        }
        w.self_close();
    }

    w.end_element("cx:layoutPr");
}

fn emit_binning(w: &mut XmlWriter, bin: &ChartExBinning) {
    w.start_element("cx:binning");
    if let Some(ref ic) = bin.interval_closed {
        w.attr("intervalClosed", ic);
    }
    if let Some(ref uf) = bin.underflow {
        match uf {
            ChartExBoundValue::Auto => w.attr("underflow", "auto"),
            ChartExBoundValue::Value(v) => w.attr("underflow", &format_f64(*v)),
        };
    }
    if let Some(ref of_) = bin.overflow {
        match of_ {
            ChartExBoundValue::Auto => w.attr("overflow", "auto"),
            ChartExBoundValue::Value(v) => w.attr("overflow", &format_f64(*v)),
        };
    }
    w.end_attrs();

    if let Some(bs) = bin.bin_size {
        w.start_element("cx:binSize")
            .attr("val", &format_f64(bs))
            .self_close();
    }
    if let Some(bc) = bin.bin_count {
        w.start_element("cx:binCount")
            .attr_num("val", bc)
            .self_close();
    }

    w.end_element("cx:binning");
}

// =============================================================================
// Axis
// =============================================================================

fn emit_axis(w: &mut XmlWriter, axis: &ChartExAxis) {
    w.start_element("cx:axis");
    if let Some(id) = axis.id {
        w.attr_num("id", id);
    }
    if let Some(hidden) = axis.hidden {
        w.attr("hidden", if hidden { "1" } else { "0" });
    }
    w.end_attrs();

    // scaling
    match &axis.scaling {
        Some(ChartExScaling::Category { gap_width }) => {
            w.start_element("cx:catScaling");
            if let Some(gw) = gap_width {
                w.attr("gapWidth", gw);
            }
            w.self_close();
        }
        Some(ChartExScaling::Value { max, min }) => {
            w.start_element("cx:valScaling");
            if let Some(max_v) = max {
                w.attr("max", max_v);
            }
            if let Some(min_v) = min {
                w.attr("min", min_v);
            }
            w.self_close();
        }
        None => {}
    }

    // title
    if let Some(ref title) = axis.title {
        emit_title(w, title);
    }

    // majorGridlines
    if let Some(ref mg) = axis.major_gridlines {
        if let Some(ref sp) = mg.sp_pr {
            w.start_element("cx:majorGridlines").end_attrs();
            emit_shape_properties(w, sp, "cx:spPr");
            w.end_element("cx:majorGridlines");
        } else {
            w.start_element("cx:majorGridlines").self_close();
        }
    }

    // minorGridlines
    if let Some(ref mg) = axis.minor_gridlines {
        if let Some(ref sp) = mg.sp_pr {
            w.start_element("cx:minorGridlines").end_attrs();
            emit_shape_properties(w, sp, "cx:spPr");
            w.end_element("cx:minorGridlines");
        } else {
            w.start_element("cx:minorGridlines").self_close();
        }
    }

    // majorTickMarks
    if let Some(ref tm) = axis.major_tick_marks {
        w.start_element("cx:majorTickMarks");
        if let Some(ref t) = tm.tick_type {
            w.attr("type", t);
        }
        w.self_close();
    }

    // minorTickMarks
    if let Some(ref tm) = axis.minor_tick_marks {
        w.start_element("cx:minorTickMarks");
        if let Some(ref t) = tm.tick_type {
            w.attr("type", t);
        }
        w.self_close();
    }

    // tickLabels
    if axis.tick_labels {
        w.start_element("cx:tickLabels").self_close();
    }

    // numFmt
    if let Some(ref nf) = axis.num_fmt {
        w.start_element("cx:numFmt")
            .attr("formatCode", &nf.format_code);
        if let Some(sl) = nf.source_linked {
            w.attr("sourceLinked", if sl { "1" } else { "0" });
        }
        w.self_close();
    }

    // spPr
    if let Some(ref sp) = axis.sp_pr {
        emit_shape_properties(w, sp, "cx:spPr");
    }

    // txPr
    if let Some(ref tb) = axis.tx_pr {
        emit_text_body(w, tb, "cx:txPr");
    }

    w.end_element("cx:axis");
}

// =============================================================================
// Legend
// =============================================================================

fn emit_legend(w: &mut XmlWriter, legend: &ChartExLegend) {
    let has_children = legend.sp_pr.is_some() || legend.tx_pr.is_some();

    w.start_element("cx:legend");
    if let Some(ref pos) = legend.pos {
        w.attr("pos", pos);
    }
    if let Some(ref align) = legend.align {
        w.attr("align", align);
    }
    if let Some(overlay) = legend.overlay {
        w.attr("overlay", if overlay { "1" } else { "0" });
    }

    if !has_children {
        w.self_close();
        return;
    }

    w.end_attrs();

    // spPr
    if let Some(ref sp) = legend.sp_pr {
        emit_shape_properties(w, sp, "cx:spPr");
    }

    // txPr
    if let Some(ref tb) = legend.tx_pr {
        emit_text_body(w, tb, "cx:txPr");
    }

    w.end_element("cx:legend");
}

// =============================================================================
// Helpers
// =============================================================================

fn format_f64(v: f64) -> String {
    if v == v.floor() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{}", v)
    }
}
