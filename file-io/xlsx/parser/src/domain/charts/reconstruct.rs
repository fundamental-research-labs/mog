//! Reconstruct ChartSpace from ChartSpec for XLSX export.
//!
//! This is the inverse of extraction: given ChartSpec typed fields,
//! build the ooxml_types::charts::ChartSpace that serializes to valid OOXML.
//!
//! Design principles:
//! - Fields from `ChartRoundTripData` (via `spec.rt`) restore non-API features losslessly.
//! - Fields from ChartSpec typed fields reconstruct API-visible content.
//! - When both exist, rt takes precedence for structural layout.
//! - `..Default::default()` is used extensively to avoid listing every optional field.

use domain_types::chart::{
    AxisData, ChartColorData, ChartDashStyle, ChartDataTableData, ChartFillData, ChartFontData,
    ChartFormatData, ChartLineData, ChartSeriesData, ChartSpec, ChartStrikeStyle, ChartSubType,
    ChartType as DomainChartType, ChartUnderlineStyle, ChartView3DData, DataLabelData,
    ErrorBarData, LegendData, LegendEntryData, PointFormatData, SingleAxisData, TrendlineData,
    TrendlineLabelData,
};
use ooxml_types::charts::{
    self, AxisType, BarDirection, ChartAxis, ChartAxisPosition, ChartGroup, ChartLines, ChartSpace,
    ChartSurface, ChartText, ChartType as OoxmlChartType, ChartTypeConfig, CrossBetween,
    DataLabelOptions, DataLabelPosition, DataPointOverride, DataTableConfig, DisplayBlanksAs,
    ErrorBarDirection, ErrorBarType, ErrorBars, ErrorValueType, Grouping, LabelAlignment,
    LegendPosition, Marker, MarkerStyle, NumFmt, Orientation, Scaling, TickLabelPosition, TickMark,
    TimeUnit, Trendline, TrendlineLabel, TrendlineType, View3D,
};
use ooxml_types::charts::{CatDataSource, NumDataSource, NumRef, SeriesTextSource, StrRef};
use ooxml_types::drawings::{
    ColorTransform, DashStyle, DrawingColor, DrawingFill, GradientFill, GradientPathType,
    GradientStop, LineDash, LineFill, Outline, Paragraph, ParagraphProperties, PatternFill,
    PresetPatternVal, RunProperties, SchemeColor, ShapeProperties, SolidFill, StAngle,
    StPositiveFixedPercentageDecimal, TextBody, TextBodyProperties, TextFont, TextRun,
    TextRunContent, TextStrikeType, TextUnderlineType,
};

// =============================================================================
// Top-level entry point
// =============================================================================

/// Reconstruct a ChartSpace from ChartSpec for XLSX export.
pub fn reconstruct_chart_space(spec: &ChartSpec) -> ChartSpace {
    let rt = spec.rt.as_ref();

    ChartSpace {
        date1904: rt.and_then(|r| r.date1904),
        lang: rt.and_then(|r| r.lang.clone()),
        rounded_corners: spec.rounded_corners,
        style: spec.style,
        style_alternate_content: rt.and_then(|r| r.style_alternate_content.clone()),
        style_after_chart: rt.map(|r| r.style_after_chart).unwrap_or(false),
        clr_map_ovr: rt.and_then(|r| r.clr_map_ovr.map(Into::into)),
        protection: rt.and_then(|r| r.protection.clone().map(Into::into)),
        chart: build_chart(spec),
        sp_pr: spec.chart_format.as_ref().and_then(build_shape_properties),
        tx_pr: spec.chart_format.as_ref().and_then(build_text_body),
        // These nodes carry chart-owned r:ids. They are dropped until the XLSX
        // writer registers and resolves their target relationships through the
        // package graph.
        external_data: None,
        pivot_source: rt.and_then(|r| r.pivot_source.clone().map(Into::into)),
        user_shapes: None,
        print_settings: rt.and_then(|r| r.print_settings.clone().map(Into::into)),
        extensions: rt
            .map(|r| clean_chart_extensions(&r.chart_space_extensions))
            .unwrap_or_default(),
    }
}

// =============================================================================
// Chart
// =============================================================================

fn build_chart(spec: &ChartSpec) -> charts::Chart {
    let rt = spec.rt.as_ref();

    charts::Chart {
        title: build_title(spec.title.as_deref(), spec.title_format.as_ref()),
        auto_title_deleted: spec.auto_title_deleted,
        view_3d: spec.view_3d.as_ref().map(build_view_3d),
        floor: build_surface(spec.floor_format.as_ref()),
        side_wall: build_surface(spec.side_wall_format.as_ref()),
        back_wall: build_surface(spec.back_wall_format.as_ref()),
        plot_area: build_plot_area(spec),
        legend: spec.legend.as_ref().and_then(build_legend),
        plot_vis_only: spec.plot_visible_only,
        disp_blanks_as: spec
            .display_blanks_as
            .as_deref()
            .map(DisplayBlanksAs::from_ooxml),
        show_d_lbls_over_max: spec.show_data_labels_over_max,
        pivot_fmts: rt
            .map(|r| r.pivot_fmts.iter().cloned().map(Into::into).collect())
            .unwrap_or_default(),
        extensions: rt
            .map(|r| clean_chart_extensions(&r.chart_extensions))
            .unwrap_or_default(),
        has_empty_ext_lst: rt.map(|r| r.has_empty_chart_ext_lst).unwrap_or(false),
    }
}

// =============================================================================
// Plot Area
// =============================================================================

fn build_plot_area(spec: &ChartSpec) -> charts::PlotArea {
    let rt = spec.rt.as_ref();

    charts::PlotArea {
        layout: rt.and_then(|r| r.plot_area_layout.clone().map(Into::into)),
        chart_groups: build_chart_groups(spec),
        axes: build_axes(spec),
        d_table: spec.data_table.as_ref().map(build_data_table),
        sp_pr: spec.plot_format.as_ref().and_then(build_shape_properties),
        extensions: rt
            .map(|r| clean_chart_extensions(&r.plot_area_extensions))
            .unwrap_or_default(),
    }
}

fn clean_chart_extensions(
    extensions: &[ooxml_types::charts::ExtensionEntry],
) -> Vec<ooxml_types::charts::ExtensionEntry> {
    extensions
        .iter()
        .filter(|extension| !crate::infra::xml::raw_xml_contains_relationship_attr(&extension.xml))
        .cloned()
        .collect()
}

// =============================================================================
// Chart Groups
// =============================================================================

fn build_chart_groups(spec: &ChartSpec) -> Vec<ChartGroup> {
    let rt = spec.rt.as_ref();

    // If we have chart group metadata from round-trip, use it for structure
    if let Some(rt) = rt {
        if !rt.chart_groups_meta.is_empty() {
            return rt
                .chart_groups_meta
                .iter()
                .map(|meta| {
                    // Collect series for this group based on series_indices
                    let series: Vec<_> = meta
                        .series_indices
                        .iter()
                        .filter_map(|&idx| spec.series.iter().find(|s| s.idx == Some(idx)))
                        .enumerate()
                        .map(|(fallback_idx, sd)| {
                            build_series(sd, &spec.chart_type, fallback_idx as u32)
                        })
                        .collect();

                    // Inject series into the config template. The template is
                    // stored as a domain `ChartTypeConfig`; convert back to
                    // the ooxml form for the writer helpers to consume.
                    let ooxml_template: ChartTypeConfig = meta.config_template.clone().into();
                    let config = inject_series_into_config(&ooxml_template, &series, spec);

                    // Inject chart-level data labels
                    let d_lbls = spec.data_labels.as_ref().map(build_data_labels);

                    // Chart-type discriminant. `ChartType::Unknown(s)`
                    // (from a non-standard @chartType attribute) round-trips
                    // as the raw attribute on `ChartGroup`; everything else
                    // maps to the OOXML enum (row 2.13 + 2.21 fold).
                    let (ooxml_ct, raw_attr) = match &meta.chart_type {
                        DomainChartType::Unknown(s) if !s.is_empty() => {
                            (OoxmlChartType::Unknown, Some(s.clone()))
                        }
                        other => (other.to_ooxml(), None),
                    };
                    ChartGroup {
                        chart_type: ooxml_ct,
                        config,
                        series,
                        d_lbls,
                        ax_id: meta.ax_ids.clone(),
                        raw_chart_type_attr: raw_attr,
                    }
                })
                .collect();
        }
    }

    // Fallback: build a single chart group from spec.chart_type + all series
    let ooxml_ct = domain_to_ooxml_chart_type(&spec.chart_type, spec.sub_type.as_ref());
    let series_data = series_for_export(spec);
    let series: Vec<_> = series_data
        .iter()
        .enumerate()
        .map(|(fallback_idx, sd)| build_series(sd, &spec.chart_type, fallback_idx as u32))
        .collect();
    let config = build_default_config(ooxml_ct, spec, &series);
    let d_lbls = spec.data_labels.as_ref().map(build_data_labels);

    // Determine default axis IDs based on chart type
    let ax_id = default_axis_ids(ooxml_ct);

    vec![ChartGroup {
        chart_type: ooxml_ct,
        config,
        series,
        d_lbls,
        ax_id,
        raw_chart_type_attr: None,
    }]
}

fn series_for_export(spec: &ChartSpec) -> Vec<ChartSeriesData> {
    if !spec.series.is_empty() {
        return spec.series.clone();
    }

    spec.data_range
        .as_deref()
        .and_then(synthesize_series_from_data_range)
        .unwrap_or_default()
}

fn synthesize_series_from_data_range(data_range: &str) -> Option<Vec<ChartSeriesData>> {
    let parsed = ParsedA1Range::parse(data_range)?;
    if parsed.start_row > parsed.end_row || parsed.start_col > parsed.end_col {
        return None;
    }

    let has_header_row = parsed.start_row < parsed.end_row;
    let has_category_col = parsed.start_col < parsed.end_col;
    let first_value_col = if has_category_col {
        parsed.start_col + 1
    } else {
        parsed.start_col
    };
    let first_value_row = if has_header_row {
        parsed.start_row + 1
    } else {
        parsed.start_row
    };

    if first_value_col > parsed.end_col || first_value_row > parsed.end_row {
        return None;
    }

    let categories = if has_category_col {
        Some(parsed.sub_range(
            parsed.start_col,
            first_value_row,
            parsed.start_col,
            parsed.end_row,
        ))
    } else {
        None
    };

    let mut series = Vec::new();
    for (order, col) in (first_value_col..=parsed.end_col).enumerate() {
        let name = if has_header_row {
            Some(parsed.cell_ref(col, parsed.start_row))
        } else {
            None
        };
        series.push(chart_series_data(
            name,
            categories.clone(),
            Some(parsed.sub_range(col, first_value_row, col, parsed.end_row)),
            order as u32,
        ));
    }

    Some(series)
}

fn chart_series_data(
    name: Option<String>,
    categories: Option<String>,
    values: Option<String>,
    idx: u32,
) -> ChartSeriesData {
    ChartSeriesData {
        name,
        r#type: None,
        color: None,
        values,
        categories,
        bubble_size: None,
        smooth: None,
        explosion: None,
        invert_if_negative: None,
        y_axis_index: None,
        show_markers: None,
        marker_size: None,
        marker_style: None,
        line_width: None,
        points: None,
        data_labels: None,
        trendlines: None,
        error_bars: None,
        x_error_bars: None,
        y_error_bars: None,
        idx: Some(idx),
        order: Some(idx),
        format: None,
        bar_shape: None,
        invert_color: None,
        marker_background_color: None,
        marker_foreground_color: None,
        filtered: None,
        show_shadow: None,
        show_connector_lines: None,
        leader_line_format: None,
        show_leader_lines: None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedA1Range {
    sheet_prefix: Option<String>,
    start_col: u32,
    start_row: u32,
    end_col: u32,
    end_row: u32,
}

impl ParsedA1Range {
    fn parse(input: &str) -> Option<Self> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return None;
        }
        let (sheet_prefix, body) = split_sheet_prefix(trimmed);
        let mut parts = body.split(':');
        let start = parts.next()?;
        let end = parts.next().unwrap_or(start);
        if parts.next().is_some() {
            return None;
        }
        let (start_col, start_row) = parse_a1_cell(start)?;
        let (end_col, end_row) = parse_a1_cell(end)?;
        Some(Self {
            sheet_prefix: sheet_prefix.map(str::to_string),
            start_col: start_col.min(end_col),
            start_row: start_row.min(end_row),
            end_col: start_col.max(end_col),
            end_row: start_row.max(end_row),
        })
    }

    fn cell_ref(&self, col: u32, row: u32) -> String {
        let cell = format!("{}{}", col_to_name(col), row + 1);
        self.qualify(&cell)
    }

    fn sub_range(&self, start_col: u32, start_row: u32, end_col: u32, end_row: u32) -> String {
        let range = format!(
            "{}{}:{}{}",
            col_to_name(start_col),
            start_row + 1,
            col_to_name(end_col),
            end_row + 1
        );
        self.qualify(&range)
    }

    fn qualify(&self, reference: &str) -> String {
        match &self.sheet_prefix {
            Some(prefix) => format!("{prefix}!{reference}"),
            None => reference.to_string(),
        }
    }
}

fn split_sheet_prefix(input: &str) -> (Option<&str>, &str) {
    let mut in_quote = false;
    let mut chars = input.char_indices().peekable();
    while let Some((idx, ch)) = chars.next() {
        match ch {
            '\'' => {
                if in_quote && matches!(chars.peek(), Some((_, '\''))) {
                    chars.next();
                } else {
                    in_quote = !in_quote;
                }
            }
            '!' if !in_quote => {
                let (sheet, reference) = input.split_at(idx);
                return (
                    Some(sheet),
                    reference.strip_prefix('!').unwrap_or(reference),
                );
            }
            _ => {}
        }
    }
    (None, input)
}

fn parse_a1_cell(input: &str) -> Option<(u32, u32)> {
    let mut col: u32 = 0;
    let mut row: u32 = 0;
    let mut saw_col = false;
    let mut saw_row = false;

    for ch in input.chars().filter(|ch| *ch != '$') {
        if ch.is_ascii_alphabetic() && !saw_row {
            saw_col = true;
            col = col
                .checked_mul(26)?
                .checked_add((ch.to_ascii_uppercase() as u8 - b'A' + 1) as u32)?;
        } else if ch.is_ascii_digit() {
            saw_row = true;
            row = row.checked_mul(10)?.checked_add(ch.to_digit(10)?)?;
        } else {
            return None;
        }
    }

    if !saw_col || !saw_row || row == 0 {
        return None;
    }

    Some((col - 1, row - 1))
}

fn col_to_name(mut col: u32) -> String {
    let mut chars = Vec::new();
    loop {
        let rem = (col % 26) as u8;
        chars.push((b'A' + rem) as char);
        col /= 26;
        if col == 0 {
            break;
        }
        col -= 1;
    }
    chars.iter().rev().collect()
}

/// Map domain ChartType to OOXML ChartType.
fn domain_to_ooxml_chart_type(
    ct: &DomainChartType,
    _sub_type: Option<&ChartSubType>,
) -> OoxmlChartType {
    ct.to_ooxml()
}

/// Map domain sub-type to OOXML Grouping.
fn sub_type_to_grouping(sub: Option<&ChartSubType>) -> Grouping {
    match sub {
        Some(ChartSubType::Clustered) => Grouping::Clustered,
        Some(ChartSubType::Stacked) => Grouping::Stacked,
        Some(ChartSubType::PercentStacked) => Grouping::PercentStacked,
        _ => Grouping::Clustered,
    }
}

/// Determine bar direction from domain chart type.
fn bar_direction_for(ct: &DomainChartType) -> BarDirection {
    match ct {
        DomainChartType::Bar => BarDirection::Bar,
        _ => BarDirection::Column,
    }
}

/// Default axis IDs based on chart type.
fn default_axis_ids(ct: OoxmlChartType) -> Vec<u32> {
    match ct {
        OoxmlChartType::Pie | OoxmlChartType::Pie3D | OoxmlChartType::Doughnut => vec![],
        _ => vec![111111111, 222222222],
    }
}

/// Build a default ChartTypeConfig for a single-group chart.
fn build_default_config(
    ct: OoxmlChartType,
    spec: &ChartSpec,
    _series: &[charts::ChartSeries],
) -> ChartTypeConfig {
    let grouping = sub_type_to_grouping(spec.sub_type.as_ref());
    match ct {
        OoxmlChartType::Bar | OoxmlChartType::Bar3D => {
            let bar_dir = bar_direction_for(&spec.chart_type);
            ChartTypeConfig::Bar(charts::BarChartConfig {
                bar_dir,
                grouping: Some(grouping),
                gap_width: spec.gap_width,
                overlap: spec.overlap,
                ..Default::default()
            })
        }
        OoxmlChartType::Line => ChartTypeConfig::Line(charts::LineChartConfig {
            grouping,
            ..Default::default()
        }),
        OoxmlChartType::Line3D => ChartTypeConfig::Line3D(charts::Line3DChartConfig {
            grouping,
            ..Default::default()
        }),
        OoxmlChartType::Pie => ChartTypeConfig::Pie(charts::PieChartConfig {
            first_slice_ang: spec.first_slice_angle,
            ..Default::default()
        }),
        OoxmlChartType::Pie3D => ChartTypeConfig::Pie3D(charts::Pie3DChartConfig::default()),
        OoxmlChartType::Doughnut => ChartTypeConfig::Doughnut(charts::DoughnutChartConfig {
            hole_size: spec.doughnut_hole_size,
            first_slice_ang: spec.first_slice_angle,
            ..Default::default()
        }),
        OoxmlChartType::Area => ChartTypeConfig::Area(charts::AreaChartConfig {
            grouping: Some(grouping),
            ..Default::default()
        }),
        OoxmlChartType::Area3D => ChartTypeConfig::Area3D(charts::Area3DChartConfig {
            grouping: Some(grouping),
            ..Default::default()
        }),
        OoxmlChartType::Scatter => ChartTypeConfig::Scatter(charts::ScatterChartConfig::default()),
        OoxmlChartType::Bubble => ChartTypeConfig::Bubble(charts::BubbleChartConfig {
            bubble_scale: spec.bubble_scale,
            ..Default::default()
        }),
        OoxmlChartType::Radar => ChartTypeConfig::Radar(charts::RadarChartConfig::default()),
        OoxmlChartType::Surface => ChartTypeConfig::Surface(charts::SurfaceChartConfig::default()),
        OoxmlChartType::Surface3D => {
            ChartTypeConfig::Surface3D(charts::SurfaceChartConfig::default())
        }
        OoxmlChartType::Stock => ChartTypeConfig::Stock(charts::StockChartConfig::default()),
        OoxmlChartType::OfPie => ChartTypeConfig::OfPie(charts::OfPieChartConfig {
            split_type: spec
                .split_type
                .as_deref()
                .map(charts::SplitType::from_ooxml),
            split_pos: spec.split_value,
            gap_width: spec.gap_width,
            ..Default::default()
        }),
        _ => ChartTypeConfig::Bar(charts::BarChartConfig::default()),
    }
}

/// Inject series into a config template (from round-trip metadata).
/// The config_template stores non-series fields; we overlay series + spec-level values.
fn inject_series_into_config(
    template: &ChartTypeConfig,
    _series: &[charts::ChartSeries],
    spec: &ChartSpec,
) -> ChartTypeConfig {
    match template {
        ChartTypeConfig::Bar(c) => ChartTypeConfig::Bar(charts::BarChartConfig {
            gap_width: spec.gap_width.or(c.gap_width),
            overlap: spec.overlap.or(c.overlap),
            ..c.clone()
        }),
        ChartTypeConfig::Bar3D(c) => ChartTypeConfig::Bar3D(charts::Bar3DChartConfig {
            gap_width: spec.gap_width.or(c.gap_width),
            ..c.clone()
        }),
        ChartTypeConfig::Line(c) => ChartTypeConfig::Line(c.clone()),
        ChartTypeConfig::Line3D(c) => ChartTypeConfig::Line3D(c.clone()),
        ChartTypeConfig::Pie(c) => ChartTypeConfig::Pie(charts::PieChartConfig {
            first_slice_ang: spec.first_slice_angle.or(c.first_slice_ang),
            ..c.clone()
        }),
        ChartTypeConfig::Pie3D(c) => ChartTypeConfig::Pie3D(c.clone()),
        ChartTypeConfig::Doughnut(c) => ChartTypeConfig::Doughnut(charts::DoughnutChartConfig {
            hole_size: spec.doughnut_hole_size.or(c.hole_size),
            first_slice_ang: spec.first_slice_angle.or(c.first_slice_ang),
            ..c.clone()
        }),
        ChartTypeConfig::Area(c) => ChartTypeConfig::Area(c.clone()),
        ChartTypeConfig::Area3D(c) => ChartTypeConfig::Area3D(c.clone()),
        ChartTypeConfig::Scatter(c) => ChartTypeConfig::Scatter(c.clone()),
        ChartTypeConfig::Bubble(c) => ChartTypeConfig::Bubble(charts::BubbleChartConfig {
            bubble_scale: spec.bubble_scale.or(c.bubble_scale),
            ..c.clone()
        }),
        ChartTypeConfig::Radar(c) => ChartTypeConfig::Radar(c.clone()),
        ChartTypeConfig::Surface(c) => ChartTypeConfig::Surface(c.clone()),
        ChartTypeConfig::Surface3D(c) => ChartTypeConfig::Surface3D(c.clone()),
        ChartTypeConfig::Stock(c) => ChartTypeConfig::Stock(c.clone()),
        ChartTypeConfig::OfPie(c) => ChartTypeConfig::OfPie(charts::OfPieChartConfig {
            split_type: spec
                .split_type
                .as_deref()
                .map(charts::SplitType::from_ooxml)
                .or(c.split_type),
            split_pos: spec.split_value.or(c.split_pos),
            gap_width: spec.gap_width.or(c.gap_width),
            ..c.clone()
        }),
        ChartTypeConfig::Combo => ChartTypeConfig::Combo,
    }
}

// =============================================================================
// Series
// =============================================================================

fn build_series(
    sd: &ChartSeriesData,
    fallback_chart_type: &DomainChartType,
    fallback_idx: u32,
) -> charts::ChartSeries {
    let effective_chart_type = sd.r#type.as_ref().unwrap_or(fallback_chart_type);
    let uses_xy = matches!(
        effective_chart_type,
        DomainChartType::Scatter | DomainChartType::Bubble
    );

    // Determine if this series uses scatter/bubble conventions based on data fields
    let has_x_val =
        sd.bubble_size.is_some() || (sd.categories.is_some() && sd.values.is_some() && uses_xy);

    // Series name → SeriesTextSource
    let tx = sd.name.as_ref().map(|n| SeriesTextSource::Value(n.clone()));

    // Value data (val or y_val)
    let val_ref = sd.values.as_ref().map(|f| {
        NumDataSource::Ref(NumRef {
            f: f.clone(),
            ..Default::default()
        })
    });
    let (val, y_val) = if has_x_val {
        (None, val_ref)
    } else {
        (val_ref, None)
    };

    // Category data (cat or x_val)
    let cat_ref = sd.categories.as_ref().map(|f| {
        CatDataSource::StrRef(StrRef {
            f: f.clone(),
            ..Default::default()
        })
    });
    let (cat, x_val) = if has_x_val {
        (None, cat_ref)
    } else {
        (cat_ref, None)
    };

    // Bubble size
    let bubble_size = sd.bubble_size.as_ref().map(|f| {
        NumDataSource::Ref(NumRef {
            f: f.clone(),
            ..Default::default()
        })
    });

    // Marker
    let marker = build_marker(sd);

    // Data points
    let d_pt: Vec<DataPointOverride> = sd
        .points
        .as_ref()
        .map(|pts| pts.iter().map(build_data_point).collect())
        .unwrap_or_default();

    // Trendlines
    let trendline: Vec<Trendline> = sd
        .trendlines
        .as_ref()
        .map(|tls| tls.iter().map(build_trendline).collect())
        .unwrap_or_default();

    // Error bars
    let mut err_bars: Vec<ErrorBars> = Vec::new();
    if let Some(ref eb) = sd.error_bars {
        err_bars.push(build_error_bars(eb));
    }
    if let Some(ref eb) = sd.x_error_bars {
        err_bars.push(build_error_bars(eb));
    }
    if let Some(ref eb) = sd.y_error_bars {
        err_bars.push(build_error_bars(eb));
    }

    // Series-level data labels
    let d_lbls = sd.data_labels.as_ref().map(build_data_labels);

    // Shape properties from format
    let sp_pr = sd.format.as_ref().and_then(build_shape_properties);

    // Bar shape
    let shape = sd.bar_shape.as_deref().map(charts::BarShape::from_ooxml);

    charts::ChartSeries {
        idx: sd.idx.unwrap_or(fallback_idx),
        order: sd.order.unwrap_or(fallback_idx),
        tx,
        sp_pr,
        cat,
        val,
        x_val,
        y_val,
        bubble_size,
        marker,
        smooth: sd.smooth,
        explosion: sd.explosion,
        invert_if_negative: sd.invert_if_negative,
        d_lbls,
        d_pt,
        trendline,
        err_bars,
        shape,
        ..Default::default()
    }
}

fn build_marker(sd: &ChartSeriesData) -> Option<Marker> {
    // Only build marker if there's marker info
    if sd.show_markers.is_none() && sd.marker_size.is_none() && sd.marker_style.is_none() {
        return None;
    }

    let symbol = sd
        .marker_style
        .as_deref()
        .map(MarkerStyle::from_ooxml)
        .or_else(|| {
            sd.show_markers.map(|show| {
                if show {
                    MarkerStyle::Auto
                } else {
                    MarkerStyle::None
                }
            })
        });

    Some(Marker {
        symbol,
        size: sd.marker_size,
        ..Default::default()
    })
}

fn build_data_point(pt: &PointFormatData) -> DataPointOverride {
    let sp_pr = pt
        .visual_format
        .as_ref()
        .and_then(build_shape_properties)
        .or_else(|| {
            // Legacy: simple fill color string
            pt.fill.as_ref().map(|hex| ShapeProperties {
                fill: Some(DrawingFill::Solid(SolidFill {
                    color: DrawingColor::SrgbClr {
                        val: hex.trim_start_matches('#').to_string(),
                        transforms: Vec::new(),
                    },
                })),
                ..Default::default()
            })
        });

    DataPointOverride {
        idx: pt.idx,
        sp_pr,
        ..Default::default()
    }
}

// =============================================================================
// Trendlines
// =============================================================================

fn build_trendline(td: &TrendlineData) -> Trendline {
    let trendline_type = td
        .r#type
        .as_deref()
        .map(TrendlineType::from_ooxml)
        .unwrap_or_default();

    let sp_pr = td.line_format.as_ref().map(|lf| ShapeProperties {
        ln: Some(build_outline(lf)),
        ..Default::default()
    });

    let trendline_lbl = td.label.as_ref().map(build_trendline_label);

    Trendline {
        name: td.name.clone(),
        sp_pr,
        trendline_type,
        order: td.order,
        period: td.period,
        forward: td.forward,
        backward: td.backward,
        intercept: td.intercept,
        disp_r_sqr: td.display_r_squared,
        disp_eq: td.display_equation,
        trendline_lbl,
        ..Default::default()
    }
}

fn build_trendline_label(tll: &TrendlineLabelData) -> TrendlineLabel {
    let tx = tll.text.as_ref().map(|t| build_chart_text_rich(t, None));
    let num_fmt = tll.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: Some(false),
    });
    let sp_pr = tll.format.as_ref().and_then(build_shape_properties);
    let tx_pr = tll.format.as_ref().and_then(build_text_body);

    TrendlineLabel {
        layout: tll.layout.clone().map(Into::into),
        tx,
        num_fmt,
        sp_pr,
        tx_pr,
        ..Default::default()
    }
}

// =============================================================================
// Error Bars
// =============================================================================

fn build_error_bars(eb: &ErrorBarData) -> ErrorBars {
    let err_dir = eb.direction.as_deref().map(ErrorBarDirection::from_ooxml);
    let err_bar_type = eb
        .bar_type
        .as_deref()
        .map(ErrorBarType::from_ooxml)
        .unwrap_or_default();
    let err_val_type = eb
        .value_type
        .as_deref()
        .map(ErrorValueType::from_ooxml)
        .unwrap_or_default();

    let sp_pr = eb.line_format.as_ref().map(|lf| ShapeProperties {
        ln: Some(build_outline(lf)),
        ..Default::default()
    });

    ErrorBars {
        err_dir,
        err_bar_type,
        err_val_type,
        no_end_cap: eb.no_end_cap,
        val: eb.value,
        sp_pr,
        ..Default::default()
    }
}

// =============================================================================
// Axes
// =============================================================================

fn build_axes(spec: &ChartSpec) -> Vec<ChartAxis> {
    let rt = spec.rt.as_ref();

    // If we have axes_ordered from round-trip, build axes in that order
    if let (Some(rt), Some(axes_data)) = (rt, spec.axes.as_ref()) {
        if !rt.axes_ordered.is_empty() {
            return build_axes_from_ordered(axes_data, &rt.axes_ordered);
        }
    }

    // Fallback: build axes from AxisData in standard order
    let Some(axes_data) = spec.axes.as_ref() else {
        return build_default_axes(spec);
    };

    let mut axes = Vec::new();
    let cat_id = 111111111u32;
    let val_id = 222222222u32;

    if let Some(ref cat) = axes_data.category_axis {
        axes.push(build_single_axis(cat, AxisType::Category, cat_id, val_id));
    }
    if let Some(ref val) = axes_data.value_axis {
        axes.push(build_single_axis(val, AxisType::Value, val_id, cat_id));
    }
    if let Some(ref scat) = axes_data.secondary_category_axis {
        axes.push(build_single_axis(
            scat,
            AxisType::Category,
            333333333,
            444444444,
        ));
    }
    if let Some(ref sval) = axes_data.secondary_value_axis {
        axes.push(build_single_axis(
            sval,
            AxisType::Value,
            444444444,
            333333333,
        ));
    }
    if let Some(ref ser) = axes_data.series_axis {
        axes.push(build_single_axis(ser, AxisType::Series, 555555555, cat_id));
    }

    axes
}

fn build_default_axes(spec: &ChartSpec) -> Vec<ChartAxis> {
    if !chart_type_requires_axes(&spec.chart_type) {
        return Vec::new();
    }

    let cat_id = 111111111u32;
    let val_id = 222222222u32;
    let default_axis = SingleAxisData::default();

    if matches!(
        spec.chart_type,
        DomainChartType::Scatter | DomainChartType::Bubble
    ) {
        return vec![
            build_single_axis_with_ids(&default_axis, AxisType::Value, cat_id, val_id),
            build_single_axis_with_ids(&default_axis, AxisType::Value, val_id, cat_id),
        ];
    }

    vec![
        build_single_axis_with_ids(&default_axis, AxisType::Category, cat_id, val_id),
        build_single_axis_with_ids(&default_axis, AxisType::Value, val_id, cat_id),
    ]
}

fn chart_type_requires_axes(chart_type: &DomainChartType) -> bool {
    !matches!(
        chart_type,
        DomainChartType::Pie
            | DomainChartType::Pie3D
            | DomainChartType::Doughnut
            | DomainChartType::OfPie
    )
}

fn build_axes_from_ordered(axes_data: &AxisData, ordered_ids: &[u32]) -> Vec<ChartAxis> {
    // Map axis IDs to their axis data by convention:
    // First pair: cat+val, second pair: secondary cat+val, fifth: series axis
    let all: Vec<(u32, Option<&SingleAxisData>, AxisType)> = ordered_ids
        .iter()
        .enumerate()
        .filter_map(|(i, &id)| {
            let (axis_data, axis_type) = match i {
                0 => (axes_data.category_axis.as_ref(), AxisType::Category),
                1 => (axes_data.value_axis.as_ref(), AxisType::Value),
                2 => (
                    axes_data.secondary_category_axis.as_ref(),
                    AxisType::Category,
                ),
                3 => (axes_data.secondary_value_axis.as_ref(), AxisType::Value),
                4 => (axes_data.series_axis.as_ref(), AxisType::Series),
                _ => return None,
            };
            Some((id, axis_data, axis_type))
        })
        .collect();

    // Pair axes for cross_ax
    let ids: Vec<u32> = all.iter().map(|(id, _, _)| *id).collect();
    let default_sad = SingleAxisData::default();
    all.iter()
        .map(|(id, data, axis_type)| {
            // Determine cross axis ID
            let cross_ax = determine_cross_ax(*id, *axis_type, &ids);
            let sad = data.unwrap_or(&default_sad);
            build_single_axis_with_ids(sad, *axis_type, *id, cross_ax)
        })
        .collect()
}

fn determine_cross_ax(id: u32, _axis_type: AxisType, ids: &[u32]) -> u32 {
    // Find the partner axis (cat<->val pairing)
    let idx = ids.iter().position(|&i| i == id).unwrap_or(0);
    match idx {
        0 => ids.get(1).copied().unwrap_or(0),
        1 => ids.first().copied().unwrap_or(0),
        2 => ids.get(3).copied().unwrap_or(0),
        3 => ids.get(2).copied().unwrap_or(0),
        4 => ids.first().copied().unwrap_or(0), // series axis crosses cat
        _ => 0,
    }
}

fn build_single_axis(
    sad: &SingleAxisData,
    axis_type: AxisType,
    ax_id: u32,
    cross_ax: u32,
) -> ChartAxis {
    build_single_axis_with_ids(sad, axis_type, ax_id, cross_ax)
}

fn build_single_axis_with_ids(
    sad: &SingleAxisData,
    axis_type: AxisType,
    ax_id: u32,
    cross_ax: u32,
) -> ChartAxis {
    // Determine axis type from explicit field or use the parameter
    let effective_type = sad
        .axis_type
        .as_deref()
        .map(|s| match s {
            "catAx" | "category" => AxisType::Category,
            "valAx" | "value" => AxisType::Value,
            "dateAx" | "date" => AxisType::Date,
            "serAx" | "series" => AxisType::Series,
            _ => axis_type,
        })
        .unwrap_or(axis_type);

    let scaling = Scaling {
        orientation: if sad.reverse == Some(true) {
            Orientation::MaxMin
        } else {
            Orientation::MinMax
        },
        min: sad.min,
        max: sad.max,
        log_base: sad.log_base,
        ..Default::default()
    };

    let title = sad
        .title
        .as_ref()
        .map(|t| build_title_element(t, sad.title_format.as_ref()));

    let num_fmt = sad.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: Some(false),
    });

    let major_gridlines = sad.grid_lines.and_then(|show| {
        if show {
            Some(ChartLines {
                sp_pr: sad.gridline_format.as_ref().map(|lf| ShapeProperties {
                    ln: Some(build_outline(lf)),
                    ..Default::default()
                }),
            })
        } else {
            None
        }
    });

    let minor_gridlines = sad.minor_grid_lines.and_then(|show| {
        if show {
            Some(ChartLines {
                sp_pr: sad
                    .minor_gridline_format
                    .as_ref()
                    .map(|lf| ShapeProperties {
                        ln: Some(build_outline(lf)),
                        ..Default::default()
                    }),
            })
        } else {
            None
        }
    });

    let major_tick_mark = sad
        .tick_marks
        .as_deref()
        .map(TickMark::from_ooxml)
        .unwrap_or(TickMark::Cross);

    let minor_tick_mark = sad
        .minor_tick_marks
        .as_deref()
        .map(TickMark::from_ooxml)
        .unwrap_or(TickMark::Cross);

    let tick_lbl_pos = sad
        .tick_label_position
        .as_deref()
        .map(TickLabelPosition::from_ooxml)
        .unwrap_or_default();

    let ax_pos = sad
        .position
        .as_deref()
        .map(ChartAxisPosition::from_ooxml)
        .unwrap_or_else(|| match effective_type {
            AxisType::Category | AxisType::Date => ChartAxisPosition::Bottom,
            AxisType::Value => ChartAxisPosition::Left,
            AxisType::Series => ChartAxisPosition::Bottom,
        });

    let cross_between = sad.cross_between.as_deref().map(CrossBetween::from_ooxml);

    let lbl_algn = sad
        .label_alignment
        .as_deref()
        .map(LabelAlignment::from_ooxml);

    let base_time_unit = sad.base_time_unit.as_deref().map(TimeUnit::from_ooxml);
    let major_time_unit = sad.major_time_unit.as_deref().map(TimeUnit::from_ooxml);
    let minor_time_unit = sad.minor_time_unit.as_deref().map(TimeUnit::from_ooxml);

    let sp_pr = sad.format.as_ref().and_then(build_shape_properties);
    let tx_pr = sad.format.as_ref().and_then(build_text_body);

    // Display units
    let disp_units = build_display_units(sad);

    ChartAxis {
        axis_type: effective_type,
        ax_id,
        scaling,
        delete: !sad.visible,
        ax_pos,
        major_gridlines,
        minor_gridlines,
        title,
        num_fmt,
        major_tick_mark,
        minor_tick_mark,
        tick_lbl_pos,
        sp_pr,
        tx_pr,
        cross_ax,
        cross_between,
        major_unit: sad.major_unit,
        minor_unit: sad.minor_unit,
        disp_units,
        lbl_algn,
        lbl_offset: sad.label_offset,
        no_multi_lvl_lbl: sad.no_multi_level_labels,
        base_time_unit,
        major_time_unit,
        minor_time_unit,
        ..Default::default()
    }
}

fn build_display_units(sad: &SingleAxisData) -> Option<charts::DisplayUnits> {
    let built_in = sad
        .display_unit
        .as_deref()
        .map(|s| charts::DisplayUnitKind::BuiltIn(charts::BuiltInUnit::from_ooxml(s)));
    let custom = sad.custom_display_unit.map(charts::DisplayUnitKind::Custom);
    let kind = built_in.or(custom);

    if kind.is_none() && sad.display_unit_label.is_none() {
        return None;
    }

    let disp_units_lbl = sad
        .display_unit_label
        .as_ref()
        .map(|text| charts::DisplayUnitsLabel {
            tx: Some(build_chart_text_rich(text, None)),
            ..Default::default()
        });

    Some(charts::DisplayUnits {
        kind,
        disp_units_lbl,
        ..Default::default()
    })
}

// =============================================================================
// Title
// =============================================================================

fn build_title(text: Option<&str>, format: Option<&ChartFormatData>) -> Option<charts::Title> {
    let text = text?;
    // Guard against the literal string "undefined" leaking from JS bridge serialization.
    if text == "undefined" || text.is_empty() {
        return None;
    }
    Some(build_title_element(text, format))
}

fn build_title_element(text: &str, format: Option<&ChartFormatData>) -> charts::Title {
    let tx = Some(build_chart_text_rich(
        text,
        format.and_then(|f| f.font.as_ref()),
    ));
    let sp_pr = format.and_then(build_shape_properties);

    charts::Title {
        tx,
        sp_pr,
        ..Default::default()
    }
}

/// Build a ChartText::Rich from a plain string and optional font.
fn build_chart_text_rich(text: &str, font: Option<&ChartFontData>) -> ChartText {
    let def_rpr = font.map(|f| Box::new(build_run_properties(f)));

    let run = TextRunContent::Run(TextRun {
        text: text.to_string(),
        props: font.map(build_run_properties).unwrap_or_default(),
    });

    let para = Paragraph {
        props: ParagraphProperties {
            def_run_props: def_rpr,
            ..Default::default()
        },
        runs: vec![run],
        end_para_rpr: None,
    };

    ChartText::Rich(TextBody {
        body_props: Default::default(),
        list_style: None,
        paragraphs: vec![para],
    })
}

// =============================================================================
// Legend
// =============================================================================

fn build_legend(ld: &LegendData) -> Option<charts::Legend> {
    if !ld.visible && !ld.show {
        return None;
    }

    let legend_pos = Some(match ld.position.as_str() {
        "bottom" | "b" => LegendPosition::Bottom,
        "top" | "t" => LegendPosition::Top,
        "left" | "l" => LegendPosition::Left,
        "right" | "r" => LegendPosition::Right,
        "topRight" | "tr" => LegendPosition::TopRight,
        _ => LegendPosition::Right,
    });

    let legend_entry = ld
        .entries
        .as_ref()
        .map(|entries| entries.iter().map(build_legend_entry).collect())
        .unwrap_or_default();

    let sp_pr = ld.format.as_ref().and_then(build_shape_properties);
    let tx_pr = ld.format.as_ref().and_then(build_text_body);

    Some(charts::Legend {
        legend_pos,
        legend_entry,
        overlay: ld.overlay,
        sp_pr,
        tx_pr,
        ..Default::default()
    })
}

fn build_legend_entry(entry: &LegendEntryData) -> charts::LegendEntry {
    let tx_pr = entry.format.as_ref().and_then(build_text_body);

    charts::LegendEntry {
        idx: entry.idx,
        delete: entry.delete,
        tx_pr,
        ..Default::default()
    }
}

// =============================================================================
// Data Labels
// =============================================================================

fn build_data_labels(dl: &DataLabelData) -> DataLabelOptions {
    let position = dl
        .position
        .as_deref()
        .map(|s| match s {
            "outside" | "outsideEnd" | "outEnd" => DataLabelPosition::OutsideEnd,
            "inside" | "insideEnd" | "inEnd" => DataLabelPosition::InsideEnd,
            "insideBase" | "inBase" => DataLabelPosition::InsideBase,
            "top" | "t" => DataLabelPosition::Top,
            "bottom" | "b" => DataLabelPosition::Bottom,
            "left" | "l" => DataLabelPosition::Left,
            "right" | "r" => DataLabelPosition::Right,
            "center" | "ctr" => DataLabelPosition::Center,
            _ => DataLabelPosition::BestFit,
        })
        .unwrap_or_default();

    let num_fmt = dl.number_format.clone();
    let num_fmt_obj = dl.number_format.as_ref().map(|code| NumFmt {
        format_code: code.clone(),
        source_linked: Some(false),
    });

    let sp_pr = dl.visual_format.as_ref().and_then(build_shape_properties);
    let tx_pr = dl.visual_format.as_ref().and_then(build_text_body);

    DataLabelOptions {
        show_value: dl.show_value.unwrap_or(false),
        show_category: dl.show_category_name.unwrap_or(false),
        show_series_name: dl.show_series_name.unwrap_or(false),
        show_percent: dl.show_percentage.unwrap_or(false),
        show_bubble_size: dl.show_bubble_size.unwrap_or(false),
        show_legend_key: dl.show_legend_key.unwrap_or(false),
        position,
        separator: dl.separator.clone(),
        num_fmt,
        num_fmt_obj,
        sp_pr,
        tx_pr,
        show_leader_lines: dl.show_leader_lines,
        ..Default::default()
    }
}

// =============================================================================
// Data Table
// =============================================================================

fn build_data_table(dt: &ChartDataTableData) -> DataTableConfig {
    let sp_pr = dt.format.as_ref().and_then(build_shape_properties);
    let tx_pr = dt.format.as_ref().and_then(build_text_body);

    DataTableConfig {
        show_horz_border: dt.show_horz_border,
        show_vert_border: dt.show_vert_border,
        show_outline: dt.show_outline,
        show_keys: dt.show_keys,
        sp_pr,
        tx_pr,
        ..Default::default()
    }
}

// =============================================================================
// 3D View
// =============================================================================

fn build_view_3d(v: &ChartView3DData) -> View3D {
    View3D {
        rot_x: v.rot_x.map(|x| x as i8),
        rot_y: v.rot_y.map(|y| y as u16),
        right_angle_axes: v.r_ang_ax,
        perspective: v.perspective.map(|p| p as u8),
        height_percent: v.height_percent.map(|h| h as u16),
        depth_percent: v.depth_percent.map(|d| d as u16),
        ..Default::default()
    }
}

// =============================================================================
// Chart Surface (floor, side wall, back wall)
// =============================================================================

fn build_surface(format: Option<&ChartFormatData>) -> Option<ChartSurface> {
    let fmt = format?;
    let sp_pr = build_shape_properties(fmt)?;
    Some(ChartSurface {
        sp_pr: Some(sp_pr),
        ..Default::default()
    })
}

// =============================================================================
// Formatting builders (inverse of extraction formatters)
// =============================================================================

fn build_shape_properties(fmt: &ChartFormatData) -> Option<ShapeProperties> {
    let fill = fmt.fill.as_ref().map(build_drawing_fill);
    let ln = fmt.line.as_ref().map(build_outline);

    if fill.is_none() && ln.is_none() {
        return None;
    }

    Some(ShapeProperties {
        fill,
        ln,
        ..Default::default()
    })
}

fn build_text_body(fmt: &ChartFormatData) -> Option<TextBody> {
    let font = fmt.font.as_ref()?;
    let rpr = build_run_properties(font);

    let rot = fmt
        .text_rotation
        .map(|deg| StAngle::new((deg * 60000.0) as i32));
    let body_props = TextBodyProperties {
        rot,
        ..Default::default()
    };

    let para = Paragraph {
        props: ParagraphProperties {
            def_run_props: Some(Box::new(rpr)),
            ..Default::default()
        },
        runs: Vec::new(),
        end_para_rpr: None,
    };

    Some(TextBody {
        body_props,
        list_style: None,
        paragraphs: vec![para],
    })
}

fn build_drawing_fill(fill: &ChartFillData) -> DrawingFill {
    match fill {
        ChartFillData::NoFill => DrawingFill::NoFill,
        ChartFillData::Solid {
            color,
            transparency,
        } => {
            let mut dc = build_drawing_color(color);
            // Apply transparency as alpha transform
            if let Some(t) = transparency {
                let alpha_val = ((1.0 - t / 100.0) * 100000.0) as i32;
                add_alpha_transform(&mut dc, alpha_val);
            }
            DrawingFill::Solid(SolidFill { color: dc })
        }
        ChartFillData::Gradient {
            gradient_type,
            angle,
            stops,
        } => {
            let gs_stops: Vec<GradientStop> = stops
                .iter()
                .map(|s| {
                    let mut color = build_drawing_color(&s.color);
                    if let Some(t) = s.transparency {
                        let alpha_val = ((1.0 - t / 100.0) * 100000.0) as i32;
                        add_alpha_transform(&mut color, alpha_val);
                    }
                    GradientStop {
                        position: StPositiveFixedPercentageDecimal::new_clamped(
                            (s.position * 1000.0) as u32,
                        ),
                        color,
                    }
                })
                .collect();

            let lin_ang = angle.map(|a| StAngle::new((a * 60000.0) as i32));
            let path = match gradient_type {
                domain_types::chart::ChartGradientType::Linear => None,
                domain_types::chart::ChartGradientType::Radial => Some(GradientPathType::Circle),
                domain_types::chart::ChartGradientType::Rectangular => Some(GradientPathType::Rect),
            };

            DrawingFill::Gradient(GradientFill {
                stops: gs_stops,
                lin_ang,
                path,
                ..Default::default()
            })
        }
        ChartFillData::Pattern {
            pattern,
            foreground,
            background,
        } => {
            let fg_color = foreground.as_ref().map(build_drawing_color);
            let bg_color = background.as_ref().map(build_drawing_color);
            // Parse pattern string to PresetPatternVal if possible; otherwise leave None
            let preset = PresetPatternVal::from_ooxml(pattern);
            DrawingFill::Pattern(PatternFill {
                preset,
                fg_color,
                bg_color,
            })
        }
    }
}

fn build_outline(line: &ChartLineData) -> Outline {
    let width = line.width.map(|pts| (pts * 12700.0) as i64); // points to EMUs

    let fill = line.color.as_ref().map(|c| {
        let dc = build_drawing_color(c);
        LineFill::Solid(SolidFill { color: dc })
    });

    let dash = line.dash_style.as_ref().map(|ds| {
        let style = match ds {
            ChartDashStyle::Solid => DashStyle::Solid,
            ChartDashStyle::Dot => DashStyle::Dot,
            ChartDashStyle::Dash => DashStyle::Dash,
            ChartDashStyle::DashDot => DashStyle::DashDot,
            ChartDashStyle::LongDash => DashStyle::LongDash,
            ChartDashStyle::LongDashDot => DashStyle::LongDashDot,
            ChartDashStyle::LongDashDotDot => DashStyle::LongDashDotDot,
        };
        LineDash::Preset(style)
    });

    Outline {
        width,
        fill,
        dash,
        ..Default::default()
    }
}

fn build_drawing_color(color: &ChartColorData) -> DrawingColor {
    match color {
        ChartColorData::Hex(hex) => DrawingColor::SrgbClr {
            val: hex.trim_start_matches('#').to_string(),
            transforms: Vec::new(),
        },
        ChartColorData::Theme { theme, tint_shade } => {
            let val = SchemeColor::from_ooxml(theme).unwrap_or(SchemeColor::Accent1);
            let mut transforms = Vec::new();
            if let Some(ts) = tint_shade {
                // Positive = tint (toward white), negative = shade (toward black)
                let ts_val = *ts;
                if ts_val >= 0.0 {
                    transforms.push(ColorTransform::Tint {
                        val: (ts_val * 100000.0) as i32,
                    });
                } else {
                    transforms.push(ColorTransform::Shade {
                        val: ((1.0 + ts_val) * 100000.0) as i32,
                    });
                }
            }
            DrawingColor::SchemeClr { val, transforms }
        }
    }
}

fn add_alpha_transform(color: &mut DrawingColor, alpha_val: i32) {
    match color {
        DrawingColor::SrgbClr { transforms, .. }
        | DrawingColor::SchemeClr { transforms, .. }
        | DrawingColor::HslClr { transforms, .. }
        | DrawingColor::SysClr { transforms, .. }
        | DrawingColor::PrstClr { transforms, .. }
        | DrawingColor::ScrgbClr { transforms, .. } => {
            transforms.push(ColorTransform::Alpha { val: alpha_val });
        }
    }
}

fn build_run_properties(font: &ChartFontData) -> RunProperties {
    let size = font
        .size
        .and_then(|pts| ooxml_types::drawings::StTextFontSize::new((pts * 100.0) as u32));
    let latin = font.name.as_ref().map(|n| TextFont {
        typeface: n.clone(),
        panose: None,
        pitch_family: None,
        charset: None,
    });

    let color = font.color.as_ref().map(build_drawing_color);

    let underline = font.underline.as_ref().map(|u| match u {
        ChartUnderlineStyle::None => TextUnderlineType::None,
        ChartUnderlineStyle::Single => TextUnderlineType::Single,
        ChartUnderlineStyle::Double => TextUnderlineType::Double,
        ChartUnderlineStyle::SingleAccountant => TextUnderlineType::Heavy, // closest match
        ChartUnderlineStyle::DoubleAccountant => TextUnderlineType::Double, // closest match
        ChartUnderlineStyle::Dash => TextUnderlineType::Dash,
        ChartUnderlineStyle::DashLong => TextUnderlineType::DashLong,
        ChartUnderlineStyle::DotDash => TextUnderlineType::DotDash,
        ChartUnderlineStyle::DotDotDash => TextUnderlineType::DotDotDash,
        ChartUnderlineStyle::Dotted => TextUnderlineType::Dotted,
        ChartUnderlineStyle::Heavy => TextUnderlineType::Heavy,
        ChartUnderlineStyle::Wavy => TextUnderlineType::Wavy,
        ChartUnderlineStyle::WavyDouble => TextUnderlineType::WavyDouble,
        ChartUnderlineStyle::WavyHeavy => TextUnderlineType::WavyHeavy,
        ChartUnderlineStyle::Words => TextUnderlineType::Words,
    });

    let strike = font.strikethrough.as_ref().map(|s| match s {
        ChartStrikeStyle::Single => TextStrikeType::SingleStrike,
        ChartStrikeStyle::Double => TextStrikeType::DoubleStrike,
    });

    RunProperties {
        size,
        bold: font.bold,
        italic: font.italic,
        underline,
        strike,
        latin,
        color,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::charts::write_canonical::serialize_chart_space;
    use domain_types::chart::{AnchorPosition, ObjectSize};

    fn minimal_chart_spec(chart_type: DomainChartType, data_range: Option<&str>) -> ChartSpec {
        ChartSpec {
            chart_type,
            title: Some("Revenue".to_string()),
            position: AnchorPosition::default(),
            size: ObjectSize::default(),
            z_index: 0,
            definition: None,
            preserved_chart_xml: None,
            series: Vec::new(),
            sub_type: None,
            legend: None,
            axes: None,
            data_labels: None,
            data_range: data_range.map(str::to_string),
            style: None,
            rounded_corners: None,
            auto_title_deleted: None,
            show_data_labels_over_max: None,
            chart_format: None,
            plot_format: None,
            title_format: None,
            title_rich_text: None,
            title_formula: None,
            data_table: None,
            display_blanks_as: None,
            plot_visible_only: None,
            gap_width: None,
            overlap: None,
            doughnut_hole_size: None,
            first_slice_angle: None,
            bubble_scale: None,
            split_type: None,
            split_value: None,
            bar_shape: None,
            bubble_3d_effect: None,
            wireframe: None,
            surface_top_view: None,
            color_scheme: None,
            category_label_level: None,
            series_name_level: None,
            show_all_field_buttons: None,
            second_plot_size: None,
            vary_by_categories: None,
            title_h_align: None,
            title_v_align: None,
            title_show_shadow: None,
            pivot_options: None,
            view_3d: None,
            floor_format: None,
            side_wall_format: None,
            back_wall_format: None,
            rt: None,
            chart_frame: None,
            is_chart_ex: false,
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
            import_status: None,
        }
    }

    #[test]
    fn data_range_chart_reconstructs_series_and_axes() {
        let spec = minimal_chart_spec(DomainChartType::Column, Some("Data!A1:C4"));
        let xml = String::from_utf8(serialize_chart_space(&reconstruct_chart_space(&spec)))
            .expect("chart XML should be UTF-8");

        assert_eq!(xml.matches("<c:ser>").count(), 2);
        assert!(xml.contains("<c:cat>"));
        assert!(xml.contains("<c:f>Data!A2:A4</c:f>"));
        assert!(xml.contains("<c:f>Data!B2:B4</c:f>"));
        assert!(xml.contains("<c:f>Data!C2:C4</c:f>"));
        assert!(xml.contains("<c:catAx>"));
        assert!(xml.contains("<c:valAx>"));
        assert!(xml.contains("<c:crossAx val=\"222222222\"/>"));
        assert!(xml.contains("<c:crossAx val=\"111111111\"/>"));
    }

    #[test]
    fn explicit_series_keep_distinct_default_idx_order() {
        let mut spec = minimal_chart_spec(DomainChartType::Line, None);
        spec.series = vec![
            chart_series_data(
                None,
                Some("A2:A4".to_string()),
                Some("B2:B4".to_string()),
                0,
            ),
            chart_series_data(
                None,
                Some("A2:A4".to_string()),
                Some("C2:C4".to_string()),
                1,
            ),
        ];
        spec.series[0].idx = None;
        spec.series[0].order = None;
        spec.series[1].idx = None;
        spec.series[1].order = None;

        let xml = String::from_utf8(serialize_chart_space(&reconstruct_chart_space(&spec)))
            .expect("chart XML should be UTF-8");

        assert!(xml.contains("<c:idx val=\"0\"/>"));
        assert!(xml.contains("<c:idx val=\"1\"/>"));
        assert!(xml.contains("<c:order val=\"0\"/>"));
        assert!(xml.contains("<c:order val=\"1\"/>"));
    }

    #[test]
    fn scatter_data_range_uses_xy_axes_and_sources() {
        let spec = minimal_chart_spec(DomainChartType::Scatter, Some("'Sales Data'!A1:B4"));
        let xml = String::from_utf8(serialize_chart_space(&reconstruct_chart_space(&spec)))
            .expect("chart XML should be UTF-8");

        assert!(xml.contains("<c:scatterChart>"));
        assert!(xml.contains("<c:xVal>"));
        assert!(xml.contains("<c:yVal>"));
        assert!(!xml.contains("<c:cat>"));
        assert_eq!(xml.matches("<c:valAx>").count(), 2);
        assert!(xml.contains("<c:f>'Sales Data'!A2:A4</c:f>"));
        assert!(xml.contains("<c:f>'Sales Data'!B2:B4</c:f>"));
    }
}
