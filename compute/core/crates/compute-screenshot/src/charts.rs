use tiny_skia::Color;

use crate::canvas::{CssRect, SheetCanvas};
use crate::colors;
use crate::text;
use compute_text_measurement::FontDb;

const DEFAULT_SERIES_COLORS: [&str; 6] = [
    "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47",
];

#[derive(Debug, Clone, PartialEq)]
pub struct ChartOverlay {
    /// Pixel bounds relative to the captured sheet data origin.
    pub rect: CssRect,
    pub chart_type: String,
    pub title: Option<String>,
    pub colors: Vec<String>,
    pub series_names: Vec<String>,
    pub series_count: usize,
    pub point_count: usize,
    pub z_index: i32,
}

pub fn render_chart_overlays(
    canvas: &mut SheetCanvas,
    charts: &[ChartOverlay],
    offset_x: f32,
    offset_y: f32,
    font_db: &FontDb,
) {
    let mut sorted = charts.to_vec();
    sorted.sort_by_key(|chart| chart.z_index);

    for chart in &sorted {
        if chart.rect.w < 8.0 || chart.rect.h < 8.0 {
            continue;
        }
        render_chart_overlay(canvas, chart, offset_x, offset_y, font_db);
    }
}

fn render_chart_overlay(
    canvas: &mut SheetCanvas,
    chart: &ChartOverlay,
    offset_x: f32,
    offset_y: f32,
    font_db: &FontDb,
) {
    let x = chart.rect.x + offset_x;
    let y = chart.rect.y + offset_y;
    let w = chart.rect.w;
    let h = chart.rect.h;

    canvas.set_clip(x, y, w, h);
    canvas.fill_rect(x, y, w, h, colors::WHITE);
    canvas.stroke_rect(x, y, w, h, Color::from_rgba8(0xC8, 0xC8, 0xC8, 0xFF), 1.0);

    let title_h = if chart.title.as_ref().is_some_and(|title| !title.is_empty()) {
        (h * 0.13).clamp(18.0, 34.0)
    } else {
        (h * 0.06).clamp(8.0, 18.0)
    };
    let legend_w = if chart.series_count > 1 {
        (w * 0.16).clamp(44.0, 90.0)
    } else {
        0.0
    };

    if let Some(title) = chart.title.as_ref().filter(|title| !title.is_empty()) {
        let title_font_size = (h * 0.045).clamp(10.0, 14.0);
        let title_x = x + w * 0.5;
        let title_y = y + (title_h * 0.58).clamp(12.0, 22.0);
        render_centered_text(
            canvas,
            font_db,
            title,
            title_x,
            title_y,
            title_font_size,
            colors::BLACK,
        );
    }

    let plot = CssRect::new(
        x + (w * 0.12).clamp(26.0, 58.0),
        y + title_h,
        (w - (w * 0.18).clamp(42.0, 80.0) - legend_w).max(24.0),
        (h - title_h - (h * 0.16).clamp(24.0, 52.0)).max(20.0),
    );

    canvas.stroke_line(
        plot.x,
        plot.y + plot.h,
        plot.x + plot.w,
        plot.y + plot.h,
        colors::BLACK,
        1.0,
    );
    canvas.stroke_line(plot.x, plot.y, plot.x, plot.y + plot.h, colors::BLACK, 1.0);

    let normalized = normalized_chart_type(&chart.chart_type);
    if normalized.contains("pie") || normalized.contains("doughnut") {
        render_pie_like(canvas, plot, chart);
    } else if normalized.contains("line")
        || normalized.contains("scatter")
        || normalized.contains("combo")
    {
        render_column_like(canvas, plot, chart, normalized.contains("combo"));
        render_line_like(canvas, plot, chart);
    } else {
        render_column_like(canvas, plot, chart, false);
    }

    if legend_w > 0.0 {
        render_legend(
            canvas,
            chart,
            x + w - legend_w + 10.0,
            plot.y + 4.0,
            legend_w - 18.0,
            font_db,
        );
    }

    canvas.clear_clip();
}

fn render_column_like(canvas: &mut SheetCanvas, plot: CssRect, chart: &ChartOverlay, muted: bool) {
    let point_count = chart.point_count.clamp(3, 8);
    let series_count = chart.series_count.clamp(1, 3);
    let group_w = plot.w / point_count as f32;
    let bar_gap = 2.0;
    let bar_w = ((group_w - 8.0) / series_count as f32 - bar_gap).max(3.0);

    for p in 0..point_count {
        for s in 0..series_count {
            let value = pseudo_value(p, s);
            let bar_h = (plot.h * value).max(2.0);
            let bx = plot.x + p as f32 * group_w + 5.0 + s as f32 * (bar_w + bar_gap);
            let by = plot.y + plot.h - bar_h;
            let mut color = series_color(chart, s);
            if muted && s > 0 {
                color = Color::from_rgba8(0xD9, 0xE2, 0xF3, 0xFF);
            }
            canvas.fill_rect(bx, by, bar_w, bar_h, color);
        }
    }
}

fn render_line_like(canvas: &mut SheetCanvas, plot: CssRect, chart: &ChartOverlay) {
    let point_count = chart.point_count.clamp(3, 8);
    let color = series_color(chart, 1);
    let mut prev: Option<(f32, f32)> = None;

    for p in 0..point_count {
        let x = plot.x + (p as f32 + 0.5) * (plot.w / point_count as f32);
        let y = plot.y + plot.h - plot.h * pseudo_value(p, 1);
        if let Some((px, py)) = prev {
            canvas.stroke_line(px, py, x, y, color, 2.0);
        }
        canvas.fill_rect(x - 2.0, y - 2.0, 4.0, 4.0, color);
        prev = Some((x, y));
    }
}

fn render_pie_like(canvas: &mut SheetCanvas, plot: CssRect, chart: &ChartOverlay) {
    let cx = plot.x + plot.w / 2.0;
    let cy = plot.y + plot.h / 2.0;
    let radius = (plot.w.min(plot.h) * 0.38).max(8.0);
    let slices = chart.point_count.clamp(3, 6);

    for i in 0..slices {
        let color = series_color(chart, i);
        let x = cx - radius + (i % 3) as f32 * radius * 0.65;
        let y = cy - radius + (i / 3) as f32 * radius * 0.65;
        canvas.fill_rect(x, y, radius * 0.6, radius * 0.6, color);
    }
}

fn render_legend(
    canvas: &mut SheetCanvas,
    chart: &ChartOverlay,
    x: f32,
    y: f32,
    w: f32,
    font_db: &FontDb,
) {
    for s in 0..chart.series_count.clamp(1, 4) {
        let row_y = y + s as f32 * 14.0;
        canvas.fill_rect(x, row_y, 10.0, 10.0, series_color(chart, s));
        let label = chart
            .series_names
            .get(s)
            .map(String::as_str)
            .filter(|name| !name.is_empty())
            .unwrap_or("Series");
        let text = if label == "Series" {
            format!("Series {}", s + 1)
        } else {
            label.to_string()
        };
        render_text(
            canvas,
            font_db,
            OverlayText {
                text: &text,
                x: x + 14.0,
                baseline_y: row_y + 9.0,
                font_size: 9.0,
                max_width: (w - 14.0).max(12.0),
                color: Color::from_rgba8(0x33, 0x33, 0x33, 0xFF),
            },
        );
    }
}

struct OverlayText<'a> {
    text: &'a str,
    x: f32,
    baseline_y: f32,
    font_size: f32,
    max_width: f32,
    color: Color,
}

fn render_centered_text(
    canvas: &mut SheetCanvas,
    font_db: &FontDb,
    text_value: &str,
    center_x: f32,
    baseline_y: f32,
    font_size: f32,
    color: Color,
) {
    let Some((_, entry)) = font_db.resolve_styled("Carlito", false, false) else {
        return;
    };
    let Some(buzz_face) = entry.face() else {
        return;
    };
    let Ok(ttf_face) = ttf_parser::Face::parse(entry.data(), entry.index()) else {
        return;
    };
    let text_w = text::measure_text_advance(&buzz_face, font_size, text_value);
    text::render_text(
        canvas,
        &buzz_face,
        &ttf_face,
        text::TextRun {
            font_size,
            text: text_value,
            x: center_x - text_w / 2.0,
            y: baseline_y,
            color,
        },
    );
}

fn render_text(canvas: &mut SheetCanvas, font_db: &FontDb, run: OverlayText<'_>) {
    let Some((_, entry)) = font_db.resolve_styled("Carlito", false, false) else {
        return;
    };
    let Some(buzz_face) = entry.face() else {
        return;
    };
    let Ok(ttf_face) = ttf_parser::Face::parse(entry.data(), entry.index()) else {
        return;
    };
    let rendered = fit_text_to_width(&buzz_face, run.font_size, run.text, run.max_width);
    if rendered.is_empty() {
        return;
    }
    text::render_text(
        canvas,
        &buzz_face,
        &ttf_face,
        text::TextRun {
            font_size: run.font_size,
            text: &rendered,
            x: run.x,
            y: run.baseline_y,
            color: run.color,
        },
    );
}

fn fit_text_to_width(
    face: &rustybuzz::Face<'_>,
    font_size: f32,
    text_value: &str,
    max_width: f32,
) -> String {
    if text::measure_text_advance(face, font_size, text_value) <= max_width {
        return text_value.to_string();
    }

    let mut fitted = String::new();
    for ch in text_value.chars() {
        let mut candidate = fitted.clone();
        candidate.push(ch);
        if text::measure_text_advance(face, font_size, &candidate) > max_width {
            break;
        }
        fitted = candidate;
    }
    fitted
}

fn series_color(chart: &ChartOverlay, index: usize) -> Color {
    chart
        .colors
        .get(index)
        .and_then(|color| colors::css_hex_to_color(color))
        .or_else(|| {
            colors::css_hex_to_color(DEFAULT_SERIES_COLORS[index % DEFAULT_SERIES_COLORS.len()])
        })
        .unwrap_or(Color::from_rgba8(0x44, 0x72, 0xC4, 0xFF))
}

fn normalized_chart_type(chart_type: &str) -> String {
    chart_type.to_ascii_lowercase()
}

fn pseudo_value(point_index: usize, series_index: usize) -> f32 {
    const VALUES: [[f32; 8]; 3] = [
        [0.45, 0.78, 0.56, 0.88, 0.64, 0.72, 0.38, 0.68],
        [0.58, 0.62, 0.74, 0.82, 0.70, 0.52, 0.80, 0.60],
        [0.35, 0.50, 0.66, 0.42, 0.76, 0.58, 0.70, 0.48],
    ];
    VALUES[series_index % VALUES.len()][point_index % VALUES[0].len()]
}
