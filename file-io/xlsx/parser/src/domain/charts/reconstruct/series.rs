use domain_types::chart::{
    ChartSeriesData, ChartType as DomainChartType, ErrorBarData, PointFormatData, TrendlineData,
    TrendlineLabelData,
};
use ooxml_types::charts::{
    self, CatDataSource, DataPointOverride, ErrorBarDirection, ErrorBarType, ErrorBars,
    ErrorValueType, Marker, MarkerStyle, NumDataSource, NumFmt, NumRef, SeriesTextSource, StrRef,
    Trendline, TrendlineLabel, TrendlineType,
};
use ooxml_types::drawings::{DrawingColor, DrawingFill, ShapeProperties, SolidFill};

use super::{
    elements::{build_chart_text_rich, build_data_labels},
    formatting::{build_outline, build_shape_properties, build_text_body},
};

// =============================================================================
// Series
// =============================================================================

pub(super) fn build_series(
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

pub(super) fn build_marker(sd: &ChartSeriesData) -> Option<Marker> {
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

pub(super) fn build_data_point(pt: &PointFormatData) -> DataPointOverride {
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

pub(super) fn build_trendline(td: &TrendlineData) -> Trendline {
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
        ..Default::default()
    }
}
