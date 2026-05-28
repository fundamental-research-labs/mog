use crate::write::xml_writer::XmlWriter;

use ooxml_types::charts::{
    Area3DChartConfig, AreaChartConfig, Bar3DChartConfig, BarChartConfig, BubbleChartConfig,
    DoughnutChartConfig, Line3DChartConfig, LineChartConfig, OfPieChartConfig, Pie3DChartConfig,
    PieChartConfig, RadarChartConfig, ScatterChartConfig, StockChartConfig, SurfaceChartConfig,
};
use ooxml_types::charts::{
    BandFmt, ChartGroup, ChartSeries, ChartType, ChartTypeConfig, DataLabelOptions,
};

use super::axes::emit_axis;
use super::labels::emit_data_labels;
use super::layout::{emit_chart_lines, emit_data_table, emit_layout, emit_up_down_bars};
use super::series::emit_series;
use super::shape_props::emit_shape_properties;
use super::util::{format_f64, write_raw_xml_if_relationship_safe};

pub(super) fn emit_plot_area(w: &mut XmlWriter, pa: &ooxml_types::charts::PlotArea) {
    w.start_element("c:plotArea").end_attrs();

    // layout — only emit if present in the parsed model
    if let Some(ref lay) = pa.layout {
        emit_layout(w, lay);
    }

    // chart groups
    for group in &pa.chart_groups {
        emit_chart_group(w, group);
    }

    // axes
    for axis in &pa.axes {
        emit_axis(w, axis);
    }

    // dTable
    if let Some(ref dt) = pa.d_table {
        emit_data_table(w, dt);
    }

    // spPr
    if let Some(ref sp) = pa.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    if !pa.extensions.is_empty() {
        emit_extensions(w, &pa.extensions);
    }

    w.end_element("c:plotArea");
}

fn emit_chart_group(w: &mut XmlWriter, group: &ChartGroup) {
    let ct = group.raw_chart_type_attr.as_deref();
    match &group.config {
        ChartTypeConfig::Bar(cfg) => {
            emit_bar_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Bar3D(cfg) => {
            emit_bar3d_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Line(cfg) => {
            emit_line_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Line3D(cfg) => {
            emit_line3d_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Pie(cfg) => emit_pie_chart(w, cfg, &group.series, &group.d_lbls, ct),
        ChartTypeConfig::Pie3D(cfg) => emit_pie3d_chart(w, cfg, &group.series, &group.d_lbls, ct),
        ChartTypeConfig::Doughnut(cfg) => {
            emit_doughnut_chart(w, cfg, &group.series, &group.d_lbls, ct)
        }
        ChartTypeConfig::Area(cfg) => {
            emit_area_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Area3D(cfg) => {
            emit_area3d_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Scatter(cfg) => {
            emit_scatter_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Bubble(cfg) => {
            emit_bubble_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Radar(cfg) => {
            emit_radar_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Surface(cfg) => {
            emit_surface_chart(w, cfg, &group.series, &group.ax_id, "c:surfaceChart", ct)
        }
        ChartTypeConfig::Surface3D(cfg) => {
            emit_surface_chart(w, cfg, &group.series, &group.ax_id, "c:surface3DChart", ct)
        }
        ChartTypeConfig::Stock(cfg) => {
            emit_stock_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::OfPie(cfg) => {
            emit_of_pie_chart(w, cfg, &group.series, &group.d_lbls, &group.ax_id, ct)
        }
        ChartTypeConfig::Combo => {
            // Combo charts are expressed as multiple chart groups; nothing to emit for the group itself.
        }
    }
}

// ============================================================================
// Chart type emitters
// ============================================================================

/// Start a chart type element, optionally adding a non-standard `chartType`
/// attribute (seen in Google Sheets exports) for round-trip fidelity.
#[inline]
fn start_chart_type_element<'a>(
    w: &'a mut XmlWriter,
    tag: &str,
    ct: Option<&str>,
) -> &'a mut XmlWriter {
    let el = w.start_element(tag);
    if let Some(v) = ct {
        el.attr("chartType", v);
    }
    el.end_attrs()
}

fn emit_bar_chart(
    w: &mut XmlWriter,
    cfg: &BarChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:barChart", ct);

    w.start_element("c:barDir")
        .attr("val", cfg.bar_dir.to_ooxml())
        .self_close();
    if let Some(ref g) = cfg.grouping {
        w.start_element("c:grouping")
            .attr("val", g.to_ooxml())
            .self_close();
    }
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Bar);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(v) = cfg.gap_width {
        w.start_element("c:gapWidth")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = cfg.overlap {
        w.start_element("c:overlap")
            .attr("val", &v.to_string())
            .self_close();
    }
    for sl in &cfg.ser_lines {
        emit_chart_lines(w, sl, "c:serLines");
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:barChart");
}

fn emit_bar3d_chart(
    w: &mut XmlWriter,
    cfg: &Bar3DChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:bar3DChart", ct);

    w.start_element("c:barDir")
        .attr("val", cfg.bar_dir.to_ooxml())
        .self_close();
    if let Some(ref g) = cfg.grouping {
        w.start_element("c:grouping")
            .attr("val", g.to_ooxml())
            .self_close();
    }
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Bar3D);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(v) = cfg.gap_width {
        w.start_element("c:gapWidth")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = cfg.gap_depth {
        w.start_element("c:gapDepth")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(ref s) = cfg.shape {
        w.start_element("c:shape")
            .attr("val", s.to_ooxml())
            .self_close();
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:bar3DChart");
}

fn emit_line_chart(
    w: &mut XmlWriter,
    cfg: &LineChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:lineChart", ct);

    w.start_element("c:grouping")
        .attr("val", cfg.grouping.to_ooxml())
        .self_close();
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Line);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(ref dl) = cfg.drop_lines {
        emit_chart_lines(w, dl, "c:dropLines");
    }
    if let Some(ref hl) = cfg.hi_low_lines {
        emit_chart_lines(w, hl, "c:hiLowLines");
    }
    if let Some(ref udb) = cfg.up_down_bars {
        emit_up_down_bars(w, udb);
    }
    if let Some(v) = cfg.marker {
        w.start_element("c:marker")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = cfg.smooth {
        w.start_element("c:smooth")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:lineChart");
}

fn emit_line3d_chart(
    w: &mut XmlWriter,
    cfg: &Line3DChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:line3DChart", ct);

    w.start_element("c:grouping")
        .attr("val", cfg.grouping.to_ooxml())
        .self_close();
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Line3D);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(ref dl) = cfg.drop_lines {
        emit_chart_lines(w, dl, "c:dropLines");
    }
    if let Some(v) = cfg.gap_depth {
        w.start_element("c:gapDepth")
            .attr("val", &v.to_string())
            .self_close();
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:line3DChart");
}

fn emit_pie_chart(
    w: &mut XmlWriter,
    cfg: &PieChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:pieChart", ct);

    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Pie);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(v) = cfg.first_slice_ang {
        w.start_element("c:firstSliceAng")
            .attr("val", &v.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:pieChart");
}

fn emit_pie3d_chart(
    w: &mut XmlWriter,
    cfg: &Pie3DChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:pie3DChart", ct);

    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Pie3D);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:pie3DChart");
}

fn emit_doughnut_chart(
    w: &mut XmlWriter,
    cfg: &DoughnutChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:doughnutChart", ct);

    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Doughnut);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(v) = cfg.first_slice_ang {
        w.start_element("c:firstSliceAng")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = cfg.hole_size {
        w.start_element("c:holeSize")
            .attr("val", &v.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:doughnutChart");
}

fn emit_area_chart(
    w: &mut XmlWriter,
    cfg: &AreaChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:areaChart", ct);

    if let Some(ref g) = cfg.grouping {
        w.start_element("c:grouping")
            .attr("val", g.to_ooxml())
            .self_close();
    }
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Area);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(ref dl) = cfg.drop_lines {
        emit_chart_lines(w, dl, "c:dropLines");
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:areaChart");
}

fn emit_area3d_chart(
    w: &mut XmlWriter,
    cfg: &Area3DChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:area3DChart", ct);

    if let Some(ref g) = cfg.grouping {
        w.start_element("c:grouping")
            .attr("val", g.to_ooxml())
            .self_close();
    }
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Area3D);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(ref dl) = cfg.drop_lines {
        emit_chart_lines(w, dl, "c:dropLines");
    }
    if let Some(v) = cfg.gap_depth {
        w.start_element("c:gapDepth")
            .attr("val", &v.to_string())
            .self_close();
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:area3DChart");
}

fn emit_scatter_chart(
    w: &mut XmlWriter,
    cfg: &ScatterChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:scatterChart", ct);

    w.start_element("c:scatterStyle")
        .attr("val", cfg.scatter_style.to_ooxml())
        .self_close();
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Scatter);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:scatterChart");
}

fn emit_bubble_chart(
    w: &mut XmlWriter,
    cfg: &BubbleChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:bubbleChart", ct);

    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Bubble);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(v) = cfg.bubble_3d {
        w.start_element("c:bubble3D")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(v) = cfg.bubble_scale {
        w.start_element("c:bubbleScale")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(v) = cfg.show_neg_bubbles {
        w.start_element("c:showNegBubbles")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }
    if let Some(ref sr) = cfg.size_represents {
        w.start_element("c:sizeRepresents")
            .attr("val", sr.to_ooxml())
            .self_close();
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:bubbleChart");
}

fn emit_radar_chart(
    w: &mut XmlWriter,
    cfg: &RadarChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:radarChart", ct);

    w.start_element("c:radarStyle")
        .attr("val", cfg.radar_style.to_ooxml())
        .self_close();
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::Radar);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:radarChart");
}

fn emit_surface_chart(
    w: &mut XmlWriter,
    cfg: &SurfaceChartConfig,
    series: &[ChartSeries],
    ax_id: &[u32],
    tag: &str,
    ct: Option<&str>,
) {
    start_chart_type_element(w, tag, ct);

    if let Some(v) = cfg.wireframe {
        w.start_element("c:wireframe")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series {
        emit_series(w, ser, ChartType::Surface);
    }

    if !cfg.band_fmts.is_empty() {
        w.start_element("c:bandFmts").end_attrs();
        for bf in &cfg.band_fmts {
            emit_band_fmt(w, bf);
        }
        w.end_element("c:bandFmts");
    }

    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element(tag);
}

fn emit_stock_chart(
    w: &mut XmlWriter,
    cfg: &StockChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:stockChart", ct);

    for ser in series {
        emit_series(w, ser, ChartType::Stock);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(ref dl) = cfg.drop_lines {
        emit_chart_lines(w, dl, "c:dropLines");
    }
    if let Some(ref hl) = cfg.hi_low_lines {
        emit_chart_lines(w, hl, "c:hiLowLines");
    }
    if let Some(ref udb) = cfg.up_down_bars {
        emit_up_down_bars(w, udb);
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:stockChart");
}

fn emit_of_pie_chart(
    w: &mut XmlWriter,
    cfg: &OfPieChartConfig,
    series: &[ChartSeries],
    d_lbls: &Option<DataLabelOptions>,
    ax_id: &[u32],
    ct: Option<&str>,
) {
    start_chart_type_element(w, "c:ofPieChart", ct);

    w.start_element("c:ofPieType")
        .attr("val", cfg.of_pie_type.to_ooxml())
        .self_close();
    if let Some(v) = cfg.vary_colors {
        w.start_element("c:varyColors")
            .attr("val", if v { "1" } else { "0" })
            .self_close();
    }

    for ser in series.iter().chain(cfg.ser.iter()) {
        emit_series(w, ser, ChartType::OfPie);
    }

    let effective_d_lbls = d_lbls.as_ref().or(cfg.d_lbls.as_ref());
    if let Some(dl) = effective_d_lbls {
        emit_data_labels(w, dl);
    }

    if let Some(v) = cfg.gap_width {
        w.start_element("c:gapWidth")
            .attr("val", &v.to_string())
            .self_close();
    }
    if let Some(ref st) = cfg.split_type {
        w.start_element("c:splitType")
            .attr("val", st.to_ooxml())
            .self_close();
    }
    if let Some(v) = cfg.split_pos {
        w.start_element("c:splitPos")
            .attr("val", &format_f64(v))
            .self_close();
    }
    if let Some(ref cs) = cfg.cust_split {
        w.start_element("c:custSplit").end_attrs();
        for idx in cs {
            w.start_element("c:secondPiePt")
                .attr("val", &idx.to_string())
                .self_close();
        }
        w.end_element("c:custSplit");
    }
    if let Some(v) = cfg.second_pie_size {
        w.start_element("c:secondPieSize")
            .attr("val", &v.to_string())
            .self_close();
    }
    for sl in &cfg.ser_lines {
        emit_chart_lines(w, sl, "c:serLines");
    }
    for id in ax_id {
        w.start_element("c:axId")
            .attr("val", &id.to_string())
            .self_close();
    }
    emit_chart_type_extensions(w, &cfg.extensions);

    w.end_element("c:ofPieChart");
}

fn emit_band_fmt(w: &mut XmlWriter, bf: &BandFmt) {
    w.start_element("c:bandFmt").end_attrs();
    w.start_element("c:idx")
        .attr("val", &bf.idx.to_string())
        .self_close();
    if let Some(ref sp) = bf.sp_pr {
        emit_shape_properties(w, sp, "c:spPr");
    }
    w.end_element("c:bandFmt");
}

pub(super) fn emit_extensions(
    w: &mut XmlWriter,
    extensions: &[ooxml_types::charts::ExtensionEntry],
) {
    w.start_element("c:extLst").end_attrs();
    for ext in extensions {
        write_raw_xml_if_relationship_safe(w, &ext.xml);
    }
    w.end_element("c:extLst");
}

/// Emit chart-type-level extensions.  These may be stored as a single raw
/// `<c:extLst>...</c:extLst>` blob (uri `__raw_ext_lst__`) when the content
/// has deeply nested extLst elements (e.g., filtered series).
fn emit_chart_type_extensions(
    w: &mut XmlWriter,
    extensions: &[ooxml_types::charts::ExtensionEntry],
) {
    if extensions.is_empty() {
        return;
    }
    // Check for raw extLst blob
    if extensions.len() == 1 && extensions[0].uri == "__raw_ext_lst__" {
        write_raw_xml_if_relationship_safe(w, &extensions[0].xml);
    } else {
        emit_extensions(w, extensions);
    }
}
