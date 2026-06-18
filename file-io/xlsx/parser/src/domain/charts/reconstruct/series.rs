use domain_types::chart::{
    ChartBorderData, ChartColorData, ChartDashStyle, ChartFillData, ChartFormatData, ChartLineData,
    ChartSeriesCategoryLevelsCacheData, ChartSeriesCategorySourceTypeData, ChartSeriesData,
    ChartSeriesDimensionSourceKindData, ChartSeriesPointCacheData, ChartSeriesXRoleData,
    ChartType as DomainChartType, ErrorBarData, ErrorBarSourceData, PointFormatData, TrendlineData,
    TrendlineLabelData,
};
use ooxml_types::charts::{
    self, CatDataSource, ChartLines, DataPointOverride, ErrorBarDirection, ErrorBarType, ErrorBars,
    ErrorValueType, Marker, MarkerStyle, NumData, NumDataSource, NumFmt, NumPoint, NumRef,
    SeriesTextSource, StrData, StrPoint, StrRef, Trendline, TrendlineLabel, TrendlineType,
};
use ooxml_types::drawings::{DrawingColor, DrawingFill, ShapeProperties, SolidFill};

use super::{
    elements::{
        apply_default_shadow_to_shape_properties, build_chart_text_rich, build_data_label_override,
        build_data_labels,
    },
    formatting::{build_drawing_color, build_outline, build_shape_properties, build_text_body},
    text_body_fidelity::{
        preserve_imported_data_label_text_properties,
        preserve_imported_optional_data_label_options_text_properties,
    },
};

// =============================================================================
// Series
// =============================================================================

pub(super) fn build_series(
    sd: &ChartSeriesData,
    fallback_chart_type: &DomainChartType,
    fallback_idx: u32,
    synthesize_modeled_defaults: bool,
) -> charts::ChartSeries {
    let effective_chart_type = sd.r#type.as_ref().unwrap_or(fallback_chart_type);
    let uses_xy = matches!(
        effective_chart_type,
        DomainChartType::Scatter | DomainChartType::Bubble
    );

    // Determine if this series uses scatter/bubble conventions based on data fields
    let has_x_val = sd.x_role == Some(ChartSeriesXRoleData::Quantitative)
        || sd.bubble_size.is_some()
        || (sd.categories.is_some() && sd.values.is_some() && uses_xy);

    // Series name → SeriesTextSource. Prefer the imported live reference so
    // round-tripping preserves c:tx/c:strRef when Excel omitted a string cache.
    let tx = build_series_text(sd);

    // Value data (val or y_val)
    let val_ref = build_num_data_source(
        sd.values.as_deref(),
        sd.value_cache.as_ref(),
        sd.value_source_kind,
    );
    let (val, y_val) = if has_x_val {
        (None, val_ref)
    } else {
        (val_ref, None)
    };

    // Category data (cat or x_val)
    let cat_ref = build_cat_data_source(
        sd.categories.as_deref(),
        sd.category_cache.as_ref(),
        sd.category_levels.as_ref(),
        sd.category_label_format.as_ref(),
        sd.category_source_kind,
        sd.category_source_type,
        uses_xy,
    );
    let (cat, x_val) = if has_x_val {
        (None, cat_ref)
    } else {
        (cat_ref, None)
    };

    // Bubble size
    let bubble_size = build_num_data_source(
        sd.bubble_size.as_deref(),
        sd.bubble_size_cache.as_ref(),
        sd.bubble_size_source_kind,
    );

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
        .map(|tls| {
            tls.iter()
                .filter(|trendline| trendline.show != Some(false))
                .map(build_trendline)
                .collect()
        })
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

    // Series-level and per-point data labels
    let mut d_lbls = sd.data_labels.as_ref().map(build_data_labels);
    apply_series_leader_lines(&mut d_lbls, sd);
    let point_labels: Vec<_> = sd
        .points
        .as_ref()
        .map(|points| {
            points
                .iter()
                .filter_map(|point| {
                    point
                        .data_label
                        .as_ref()
                        .map(|label| build_data_label_override(point.idx, label))
                })
                .collect()
        })
        .unwrap_or_default();
    if !point_labels.is_empty() {
        d_lbls
            .get_or_insert_with(Default::default)
            .d_lbl
            .extend(point_labels);
    }

    // Shape properties from explicit format, legacy color, or modeled chart defaults.
    let sp_pr = apply_default_shadow_to_shape_properties(
        build_series_shape_properties(sd, effective_chart_type)
            .or_else(|| {
                synthesize_modeled_defaults
                    .then(|| {
                        default_series_shape_properties(sd, effective_chart_type, fallback_idx)
                    })
                    .flatten()
            }),
        sd.show_shadow,
    );

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
        bubble_3d: sd.bubble_3d,
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

fn apply_series_leader_lines(d_lbls: &mut Option<charts::DataLabelOptions>, sd: &ChartSeriesData) {
    let line = sd
        .leader_line_format
        .as_ref()
        .and_then(|format| format.line.as_ref());
    if line.is_none() && sd.show_leader_lines.is_none() {
        return;
    }

    let labels = d_lbls.get_or_insert_with(Default::default);
    if let Some(show) = sd.show_leader_lines {
        labels.show_leader_lines = Some(show);
    }
    if let Some(line) = line {
        labels.leader_lines = Some(ChartLines {
            sp_pr: Some(ShapeProperties {
                ln: Some(build_outline(line)),
                ..Default::default()
            }),
        });
    }
}

pub(super) fn preserve_imported_series_text_body_properties(
    target: &mut charts::ChartSeries,
    imported: &charts::ChartSeries,
) {
    preserve_imported_optional_data_label_options_text_properties(
        &mut target.d_lbls,
        imported.d_lbls.as_ref(),
    );

    for label in &mut target.d_lbl {
        let imported_label = imported
            .d_lbl
            .iter()
            .find(|candidate| candidate.idx == label.idx);
        preserve_imported_data_label_text_properties(label, imported_label);
    }
}

fn build_series_shape_properties(
    sd: &ChartSeriesData,
    chart_type: &DomainChartType,
) -> Option<ShapeProperties> {
    let mut sp_pr = sd.format.as_ref().and_then(build_shape_properties);
    if let Some(legacy) = build_legacy_series_color_shape_properties(sd, chart_type) {
        merge_series_shape_properties(&mut sp_pr, legacy);
    }
    sp_pr
}

fn merge_series_shape_properties(target: &mut Option<ShapeProperties>, source: ShapeProperties) {
    let Some(target) = target.as_mut() else {
        *target = Some(source);
        return;
    };

    if target.fill.is_none() {
        target.fill = source.fill;
    }
    match (&mut target.ln, source.ln) {
        (None, source_line) => target.ln = source_line,
        (Some(target_line), Some(source_line)) => {
            if target_line.fill.is_none() {
                target_line.fill = source_line.fill;
            }
            if target_line.width.is_none() {
                target_line.width = source_line.width;
            }
        }
        (Some(_), None) => {}
    }
}

fn build_legacy_series_color_shape_properties(
    sd: &ChartSeriesData,
    chart_type: &DomainChartType,
) -> Option<ShapeProperties> {
    sd.color.as_ref().map(|hex| {
        if chart_type_uses_default_line(chart_type) || sd.show_lines == Some(true) {
            series_line_shape_properties(hex, sd.line_width)
        } else {
            series_fill_shape_properties(hex)
        }
    })
}

fn default_series_shape_properties(
    sd: &ChartSeriesData,
    chart_type: &DomainChartType,
    fallback_idx: u32,
) -> Option<ShapeProperties> {
    let color = EXCEL_ACCENT_PALETTE[fallback_idx as usize % EXCEL_ACCENT_PALETTE.len()];
    if chart_type_uses_default_fill(chart_type) {
        return Some(series_fill_shape_properties(color));
    }
    if chart_type_uses_default_line(chart_type) || sd.show_lines == Some(true) {
        return Some(series_line_shape_properties(color, sd.line_width));
    }
    None
}

const EXCEL_ACCENT_PALETTE: [&str; 6] =
    ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

fn chart_type_uses_default_fill(chart_type: &DomainChartType) -> bool {
    matches!(
        chart_type,
        DomainChartType::Bar
            | DomainChartType::Bar3D
            | DomainChartType::Column
            | DomainChartType::Column3D
            | DomainChartType::Area
            | DomainChartType::Area3D
            | DomainChartType::Pie
            | DomainChartType::Pie3D
            | DomainChartType::Doughnut
            | DomainChartType::OfPie
            | DomainChartType::Bubble
    )
}

fn chart_type_uses_default_line(chart_type: &DomainChartType) -> bool {
    matches!(
        chart_type,
        DomainChartType::Line
            | DomainChartType::Line3D
            | DomainChartType::Radar
            | DomainChartType::Stock
    )
}

fn series_fill_shape_properties(hex: &str) -> ShapeProperties {
    ShapeProperties {
        fill: Some(DrawingFill::Solid(SolidFill {
            color: DrawingColor::SrgbClr {
                val: hex.trim_start_matches('#').to_string(),
                transforms: Vec::new(),
            },
        })),
        ..Default::default()
    }
}

fn series_line_shape_properties(hex: &str, width: Option<f64>) -> ShapeProperties {
    ShapeProperties {
        ln: Some(build_outline(&ChartLineData {
            color: Some(ChartColorData::Hex(hex.to_string())),
            width: Some(width.unwrap_or(2.25)),
            dash_style: None,
            transparency: None,
            no_fill: None,
        })),
        ..Default::default()
    }
}

fn build_series_text(sd: &ChartSeriesData) -> Option<SeriesTextSource> {
    if let Some(name_ref) = sd
        .name_ref
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return Some(SeriesTextSource::StrRef(StrRef {
            f: name_ref.to_string(),
            str_cache: sd.name.as_ref().map(|name| StrData {
                pt_count: Some(1),
                pts: vec![StrPoint {
                    idx: 0,
                    v: name.clone(),
                }],
                extensions: vec![],
            }),
            extensions: vec![],
        }));
    }
    sd.name
        .as_ref()
        .map(|name| SeriesTextSource::Value(name.clone()))
}

fn build_num_data_source(
    formula: Option<&str>,
    cache: Option<&ChartSeriesPointCacheData>,
    source_kind: Option<ChartSeriesDimensionSourceKindData>,
) -> Option<NumDataSource> {
    if source_kind == Some(ChartSeriesDimensionSourceKindData::Literal) {
        return cache
            .filter(|cache| point_cache_has_payload(cache))
            .map(num_data_from_cache)
            .map(NumDataSource::Lit);
    }

    if let Some(formula) = formula {
        return Some(NumDataSource::Ref(NumRef {
            f: formula.to_string(),
            num_cache: point_cache_payload(cache).map(num_data_from_cache),
            ..Default::default()
        }));
    }

    if source_kind == Some(ChartSeriesDimensionSourceKindData::Ref) {
        return None;
    }

    cache
        .filter(|cache| point_cache_has_payload(cache))
        .map(num_data_from_cache)
        .map(NumDataSource::Lit)
}

fn build_cat_data_source(
    formula: Option<&str>,
    cache: Option<&ChartSeriesPointCacheData>,
    category_levels: Option<&ChartSeriesCategoryLevelsCacheData>,
    category_label_format: Option<&domain_types::chart::CategoryLabelFormatData>,
    source_kind: Option<ChartSeriesDimensionSourceKindData>,
    source_type: Option<ChartSeriesCategorySourceTypeData>,
    force_numeric: bool,
) -> Option<CatDataSource> {
    let numeric_category = force_numeric
        || match source_type {
            Some(ChartSeriesCategorySourceTypeData::Number) => true,
            Some(
                ChartSeriesCategorySourceTypeData::String
                | ChartSeriesCategorySourceTypeData::MultiLevelString,
            ) => false,
            None => category_cache_is_numeric(cache, category_label_format),
        };

    if source_kind == Some(ChartSeriesDimensionSourceKindData::Literal) {
        return cache
            .filter(|cache| point_cache_has_payload(cache))
            .map(|cache| {
                if numeric_category {
                    CatDataSource::NumLit(num_data_from_category_cache(
                        cache,
                        category_label_format,
                    ))
                } else {
                    CatDataSource::StrLit(str_data_from_cache(cache))
                }
            });
    }

    if let Some(formula) = formula {
        if let Some(levels) = category_levels {
            return Some(CatDataSource::MultiLvlStrRef(charts::MultiLvlStrRef {
                f: formula.to_string(),
                multi_lvl_str_cache: category_levels_cache_payload(Some(levels))
                    .map(multi_lvl_str_data_from_cache),
                ..Default::default()
            }));
        }
    }

    if let Some(formula) = formula {
        return if numeric_category {
            Some(CatDataSource::NumRef(NumRef {
                f: formula.to_string(),
                num_cache: point_cache_payload(cache)
                    .map(|cache| num_data_from_category_cache(cache, category_label_format)),
                ..Default::default()
            }))
        } else {
            Some(CatDataSource::StrRef(StrRef {
                f: formula.to_string(),
                str_cache: point_cache_payload(cache).map(str_data_from_cache),
                ..Default::default()
            }))
        };
    }

    if source_kind == Some(ChartSeriesDimensionSourceKindData::Ref) {
        return None;
    }

    cache
        .filter(|cache| point_cache_has_payload(cache))
        .map(|cache| {
            if numeric_category {
                CatDataSource::NumLit(num_data_from_category_cache(cache, category_label_format))
            } else {
                CatDataSource::StrLit(str_data_from_cache(cache))
            }
        })
}

fn point_cache_has_payload(cache: &ChartSeriesPointCacheData) -> bool {
    cache.point_count.is_some() || cache.format_code.is_some() || !cache.points.is_empty()
}

fn point_cache_payload(
    cache: Option<&ChartSeriesPointCacheData>,
) -> Option<&ChartSeriesPointCacheData> {
    cache.filter(|cache| point_cache_has_payload(cache))
}

fn category_levels_cache_has_payload(cache: &ChartSeriesCategoryLevelsCacheData) -> bool {
    cache.point_count.is_some()
        || cache
            .levels
            .iter()
            .any(|level| level.point_count.is_some() || !level.points.is_empty())
}

fn category_levels_cache_payload(
    cache: Option<&ChartSeriesCategoryLevelsCacheData>,
) -> Option<&ChartSeriesCategoryLevelsCacheData> {
    cache.filter(|cache| category_levels_cache_has_payload(cache))
}

fn multi_lvl_str_data_from_cache(
    cache: &ChartSeriesCategoryLevelsCacheData,
) -> charts::MultiLvlStrData {
    charts::MultiLvlStrData {
        pt_count: cache.point_count,
        levels: cache
            .levels
            .iter()
            .map(|level| StrData {
                pt_count: level.point_count,
                pts: level
                    .points
                    .iter()
                    .map(|point| StrPoint {
                        idx: point.idx,
                        v: point.value.clone(),
                    })
                    .collect(),
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    }
}

fn num_data_from_cache(cache: &ChartSeriesPointCacheData) -> NumData {
    NumData {
        format_code: cache.format_code.clone(),
        pt_count: cache.point_count,
        pts: cache
            .points
            .iter()
            .map(|point| NumPoint {
                idx: point.idx,
                v: point.value.clone(),
                format_code: point.format_code.clone(),
            })
            .collect(),
        ..Default::default()
    }
}

fn category_cache_is_numeric(
    cache: Option<&ChartSeriesPointCacheData>,
    category_label_format: Option<&domain_types::chart::CategoryLabelFormatData>,
) -> bool {
    category_label_format.is_some()
        || cache.is_some_and(|cache| {
            cache.format_code.is_some()
                || cache.points.iter().any(|point| point.format_code.is_some())
        })
}

fn num_data_from_category_cache(
    cache: &ChartSeriesPointCacheData,
    category_label_format: Option<&domain_types::chart::CategoryLabelFormatData>,
) -> NumData {
    let mut data = num_data_from_cache(cache);
    if let Some(format) = category_label_format {
        data.format_code = format.format_code.clone().or(data.format_code);
        if let Some(points) = format.points.as_ref() {
            for point in &mut data.pts {
                if let Some(format_point) = points.iter().find(|format_point| {
                    format_point.idx == point.idx && format_point.format_code.is_some()
                }) {
                    point.format_code = format_point
                        .format_code
                        .clone()
                        .or(point.format_code.clone());
                }
            }
        }
    }
    data
}

fn str_data_from_cache(cache: &ChartSeriesPointCacheData) -> StrData {
    StrData {
        pt_count: cache.point_count,
        pts: cache
            .points
            .iter()
            .map(|point| StrPoint {
                idx: point.idx,
                v: point.value.clone(),
            })
            .collect(),
        ..Default::default()
    }
}

pub(super) fn build_marker(sd: &ChartSeriesData) -> Option<Marker> {
    // Only build marker if there's marker info
    if sd.show_markers.is_none()
        && sd.marker_size.is_none()
        && sd.marker_style.is_none()
        && sd.marker_background_color.is_none()
        && sd.marker_foreground_color.is_none()
        && sd.marker_line_format.is_none()
    {
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
        sp_pr: build_marker_shape_properties(
            sd.marker_background_color.as_ref(),
            sd.marker_foreground_color.as_ref(),
            sd.marker_line_format.as_ref(),
        ),
        ..Default::default()
    })
}

pub(super) fn build_data_point(pt: &PointFormatData) -> DataPointOverride {
    let sp_pr = build_point_shape_properties(pt);

    DataPointOverride {
        idx: pt.idx,
        invert_if_negative: pt.invert_if_negative,
        marker: build_point_marker(pt),
        bubble_3d: pt.bubble_3d,
        explosion: pt.explosion,
        sp_pr,
        ..Default::default()
    }
}

fn build_point_shape_properties(pt: &PointFormatData) -> Option<ShapeProperties> {
    let mut format = pt.visual_format.clone().unwrap_or(ChartFormatData {
        fill: None,
        line: None,
        font: None,
        text_rotation: None,
        text_vertical_type: None,
        shadow: None,
    });

    if format.fill.is_none() {
        format.fill = point_fill_from_legacy_hex(pt.fill.as_deref());
    }
    merge_point_line_alias(&mut format.line, pt.line_format.as_ref());
    if let Some(border_line) = pt.border.as_ref().and_then(point_border_to_line) {
        merge_point_line_alias(&mut format.line, Some(&border_line));
    }

    build_shape_properties(&format)
}

fn point_fill_from_legacy_hex(hex: Option<&str>) -> Option<ChartFillData> {
    let value = point_hex_color(hex?)?;
    Some(ChartFillData::Solid {
        color: ChartColorData::Hex(value),
        transparency: None,
    })
}

fn point_border_to_line(border: &ChartBorderData) -> Option<ChartLineData> {
    let line = ChartLineData {
        color: border
            .color
            .as_ref()
            .and_then(|color| point_hex_color(color))
            .map(ChartColorData::Hex),
        width: border.width,
        dash_style: border
            .style
            .as_deref()
            .and_then(chart_dash_style_from_border_style),
        transparency: None,
        no_fill: None,
    };

    point_line_has_content(&line).then_some(line)
}

fn point_hex_color(value: &str) -> Option<String> {
    let value = value.trim().trim_start_matches('#');
    (!value.is_empty()).then(|| value.to_string())
}

fn chart_dash_style_from_border_style(style: &str) -> Option<ChartDashStyle> {
    serde_json::from_value(serde_json::Value::String(style.to_string())).ok()
}

fn merge_point_line_alias(target: &mut Option<ChartLineData>, source: Option<&ChartLineData>) {
    let Some(source) = source.filter(|line| point_line_has_content(line)) else {
        return;
    };

    let Some(target) = target.as_mut() else {
        *target = Some(source.clone());
        return;
    };

    if target.color.is_none() {
        target.color = source.color.clone();
    }
    if target.width.is_none() {
        target.width = source.width;
    }
    if target.dash_style.is_none() {
        target.dash_style = source.dash_style.clone();
    }
    if target.transparency.is_none() {
        target.transparency = source.transparency;
    }
    if target.no_fill.is_none() {
        target.no_fill = source.no_fill;
    }
}

fn point_line_has_content(line: &ChartLineData) -> bool {
    line.color.is_some()
        || line.width.is_some()
        || line.dash_style.is_some()
        || line.transparency.is_some()
        || line.no_fill.is_some()
}

fn build_point_marker(pt: &PointFormatData) -> Option<Marker> {
    if pt.marker_size.is_none()
        && pt.marker_style.is_none()
        && pt.marker_background_color.is_none()
        && pt.marker_foreground_color.is_none()
        && pt.marker_line_format.is_none()
    {
        return None;
    }

    Some(Marker {
        symbol: pt.marker_style.as_deref().map(MarkerStyle::from_ooxml),
        size: pt.marker_size,
        sp_pr: build_marker_shape_properties(
            pt.marker_background_color.as_ref(),
            pt.marker_foreground_color.as_ref(),
            pt.marker_line_format.as_ref(),
        ),
        ..Default::default()
    })
}

fn build_marker_shape_properties(
    fill: Option<&domain_types::chart::ChartColorData>,
    line_color: Option<&domain_types::chart::ChartColorData>,
    line_format: Option<&ChartLineData>,
) -> Option<ShapeProperties> {
    let line = marker_line_from_aliases(line_color, line_format);
    if fill.is_none() && line.is_none() {
        return None;
    }

    Some(ShapeProperties {
        fill: fill.map(|color| {
            DrawingFill::Solid(SolidFill {
                color: build_drawing_color(color),
            })
        }),
        ln: line.as_ref().map(build_outline),
        ..Default::default()
    })
}

fn marker_line_from_aliases(
    color: Option<&domain_types::chart::ChartColorData>,
    line_format: Option<&ChartLineData>,
) -> Option<ChartLineData> {
    let mut line = line_format.cloned().unwrap_or(ChartLineData {
        color: None,
        width: None,
        dash_style: None,
        transparency: None,
        no_fill: None,
    });

    if line.color.is_none() {
        line.color = color.cloned();
    }

    point_line_has_content(&line).then_some(line)
}

// =============================================================================
// Trendlines
// =============================================================================

pub(super) fn build_trendline(td: &TrendlineData) -> Trendline {
    let trendline_type = td
        .r#type
        .as_deref()
        .map(trendline_type_from_public)
        .unwrap_or_default();

    let line_format = trendline_line_format(td);
    let sp_pr = line_format.as_ref().map(|lf| ShapeProperties {
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

fn trendline_type_from_public(value: &str) -> TrendlineType {
    match value {
        "exponential" | "exp" => TrendlineType::Exponential,
        "linear" => TrendlineType::Linear,
        "logarithmic" | "log" => TrendlineType::Logarithmic,
        "moving-average" | "movingAvg" => TrendlineType::MovingAverage,
        "polynomial" | "poly" => TrendlineType::Polynomial,
        "power" => TrendlineType::Power,
        _ => TrendlineType::from_ooxml(value),
    }
}

fn trendline_line_format(td: &TrendlineData) -> Option<ChartLineData> {
    let mut line = td.line_format.clone().unwrap_or(ChartLineData {
        color: None,
        width: None,
        dash_style: None,
        transparency: None,
        no_fill: None,
    });

    if line.color.is_none() {
        line.color = td
            .color
            .as_deref()
            .and_then(point_hex_color)
            .map(ChartColorData::Hex);
    }
    if line.width.is_none() {
        line.width = td.line_width;
    }

    point_line_has_content(&line).then_some(line)
}

pub(super) fn build_trendline_label(tll: &TrendlineLabelData) -> TrendlineLabel {
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

pub(super) fn build_error_bars(eb: &ErrorBarData) -> ErrorBars {
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
        plus: eb.plus_source.as_ref().map(build_error_bar_source),
        minus: eb.minus_source.as_ref().map(build_error_bar_source),
        ..Default::default()
    }
}

fn build_error_bar_source(source: &ErrorBarSourceData) -> NumDataSource {
    let cache = source.cache.as_ref().map(build_num_data_from_point_cache);
    if let Some(formula) = source.formula.as_ref() {
        NumDataSource::Ref(NumRef {
            f: formula.clone(),
            num_cache: cache,
            ..Default::default()
        })
    } else {
        NumDataSource::Lit(cache.unwrap_or_default())
    }
}

fn build_num_data_from_point_cache(cache: &ChartSeriesPointCacheData) -> NumData {
    NumData {
        format_code: cache.format_code.clone(),
        pt_count: cache.point_count,
        pts: cache
            .points
            .iter()
            .map(|point| NumPoint {
                idx: point.idx,
                v: point.value.clone(),
                format_code: point.format_code.clone(),
            })
            .collect(),
        extensions: Vec::new(),
    }
}
