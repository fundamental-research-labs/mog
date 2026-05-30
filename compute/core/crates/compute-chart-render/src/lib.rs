use std::f32::consts::PI;

use compute_text_measurement::FontDb;
use image::ExtendedColorType;
use image::codecs::jpeg::JpegEncoder;
use rustybuzz::UnicodeBuffer;
use serde::Deserialize;
use tiny_skia::{Color, FillRule, Paint, Path, PathBuilder, Pixmap, Rect, Stroke, Transform};
use ttf_parser::GlyphId;

#[derive(Debug, thiserror::Error)]
pub enum ChartRenderError {
    #[error("invalid chart render request JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("unsupported chart image request version {0}")]
    UnsupportedVersion(u32),
    #[error("{0}")]
    InvalidRequest(String),
    #[error("unsupported chart image format {0}")]
    UnsupportedFormat(String),
    #[error("unsupported chart mark type {0}")]
    UnsupportedMark(String),
    #[error("invalid chart mark: {0}")]
    InvalidMark(String),
    #[error("invalid chart color {0}")]
    InvalidColor(String),
    #[error("image encode failed: {0}")]
    Encode(String),
}

pub type Result<T> = std::result::Result<T, ChartRenderError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChartImageFormat {
    Png,
    Jpeg,
}

pub struct RenderedChartImage {
    pub bytes: Vec<u8>,
    pub format: ChartImageFormat,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderChartMarksRequest {
    pub version: u32,
    pub marks: Vec<RawMark>,
    pub options: RenderChartMarksOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderChartMarksOptions {
    pub format: String,
    pub width: f64,
    pub height: f64,
    pub pixel_ratio: f64,
    pub background_color: String,
    pub quality: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawStyle {
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub stroke_dash: Option<Vec<f64>>,
    pub opacity: Option<f64>,
    pub corner_radius: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawMark {
    #[serde(rename = "type")]
    pub mark_type: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub path: Option<String>,
    pub inner_radius: Option<f64>,
    pub outer_radius: Option<f64>,
    pub start_angle: Option<f64>,
    pub end_angle: Option<f64>,
    pub text: Option<String>,
    pub font_size: Option<f64>,
    pub font_family: Option<String>,
    pub text_align: Option<String>,
    pub text_baseline: Option<String>,
    pub rotation: Option<f64>,
    pub font_weight: Option<serde_json::Value>,
    pub shape: Option<String>,
    pub size: Option<f64>,
    pub style: Option<RawStyle>,
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub stroke_width: Option<f64>,
    pub opacity: Option<f64>,
}

#[derive(Debug, Clone)]
struct MarkStyle {
    fill: Option<String>,
    stroke: Option<String>,
    stroke_width: f32,
    stroke_dash: Option<Vec<f32>>,
    opacity: f32,
    corner_radius: f32,
}

struct RenderSurface {
    pixmap: Pixmap,
    dpr: f32,
    font_db: FontDb,
}

pub fn render_chart_marks_image_from_json(request_json: &str) -> Result<RenderedChartImage> {
    let request: RenderChartMarksRequest = serde_json::from_str(request_json)?;
    render_chart_marks_image(&request)
}

pub fn render_chart_marks_image(request: &RenderChartMarksRequest) -> Result<RenderedChartImage> {
    if request.version != 1 {
        return Err(ChartRenderError::UnsupportedVersion(request.version));
    }
    let options = NormalizedRenderOptions::new(&request.options)?;
    if request.marks.is_empty() {
        return Err(ChartRenderError::InvalidRequest(
            "chart mark array must not be empty".to_string(),
        ));
    }

    let mut surface =
        RenderSurface::new(options.physical_width, options.physical_height, options.dpr)?;
    surface.fill_background(options.background_color);
    for (index, mark) in request.marks.iter().enumerate() {
        surface.render_mark(mark, index)?;
    }

    let bytes = match options.format {
        ChartImageFormat::Png => encode_png(&surface.pixmap)?,
        ChartImageFormat::Jpeg => encode_jpeg(&surface.pixmap, options.jpeg_quality)?,
    };

    Ok(RenderedChartImage {
        bytes,
        format: options.format,
        width: options.physical_width,
        height: options.physical_height,
    })
}

#[derive(Clone, Copy)]
struct NormalizedRenderOptions {
    format: ChartImageFormat,
    dpr: f32,
    physical_width: u32,
    physical_height: u32,
    background_color: Color,
    jpeg_quality: u8,
}

impl NormalizedRenderOptions {
    fn new(options: &RenderChartMarksOptions) -> Result<Self> {
        let format = match options.format.as_str() {
            "png" => ChartImageFormat::Png,
            "jpeg" => ChartImageFormat::Jpeg,
            other => return Err(ChartRenderError::UnsupportedFormat(other.to_string())),
        };
        let width = finite_positive("width", options.width)?;
        let height = finite_positive("height", options.height)?;
        let dpr = finite_positive("pixelRatio", options.pixel_ratio)?;
        let physical_width = physical_dimension("width * pixelRatio", width * dpr)?;
        let physical_height = physical_dimension("height * pixelRatio", height * dpr)?;
        let background_color = parse_required_color(&options.background_color, 1.0)?;
        let jpeg_quality = match options.quality {
            Some(quality) => {
                if !(0.0..=1.0).contains(&quality) || !quality.is_finite() {
                    return Err(ChartRenderError::InvalidRequest(
                        "quality must be a finite number between 0 and 1".to_string(),
                    ));
                }
                (quality * 100.0).round().clamp(1.0, 100.0) as u8
            }
            None => 92,
        };

        Ok(Self {
            format,
            dpr: dpr as f32,
            physical_width,
            physical_height,
            background_color,
            jpeg_quality,
        })
    }
}

impl RenderSurface {
    fn new(width: u32, height: u32, dpr: f32) -> Result<Self> {
        let pixmap = Pixmap::new(width.max(1), height.max(1)).ok_or_else(|| {
            ChartRenderError::InvalidRequest(format!(
                "unable to allocate {width}x{height} chart image"
            ))
        })?;
        Ok(Self {
            pixmap,
            dpr,
            font_db: FontDb::with_defaults(),
        })
    }

    fn fill_background(&mut self, color: Color) {
        self.pixmap.fill(color);
    }

    fn render_mark(&mut self, mark: &RawMark, index: usize) -> Result<()> {
        match mark.mark_type.as_str() {
            "rect" => self.render_rect(mark, index),
            "path" | "line" | "area" => self.render_path(mark, index),
            "arc" => self.render_arc(mark, index),
            "symbol" => self.render_symbol(mark, index),
            "text" => self.render_text(mark, index),
            other => Err(ChartRenderError::UnsupportedMark(other.to_string())),
        }
    }

    fn render_rect(&mut self, mark: &RawMark, index: usize) -> Result<()> {
        let x = required_f32(mark.x, index, "x")?;
        let y = required_f32(mark.y, index, "y")?;
        let width = required_f32(mark.width, index, "width")?;
        let height = required_f32(mark.height, index, "height")?;
        let style = mark_style(mark)?;
        if width <= 0.0 || height <= 0.0 {
            return Ok(());
        }
        let path = if style.corner_radius > 0.0 {
            rounded_rect_path(x, y, width, height, style.corner_radius, self.dpr)
        } else {
            rect_path(x, y, width, height, self.dpr)
        };
        self.fill_and_stroke_path(&path, &style)
    }

    fn render_path(&mut self, mark: &RawMark, index: usize) -> Result<()> {
        let x = optional_f32(mark.x, 0.0, index, "x")?;
        let y = optional_f32(mark.y, 0.0, index, "y")?;
        let path_data = mark
            .path
            .as_deref()
            .ok_or_else(|| invalid_mark(index, "path mark requires path"))?;
        let path = parse_svg_path(path_data, x, y, self.dpr)?;
        let style = mark_style(mark)?;
        self.fill_and_stroke_path(&path, &style)
    }

    fn render_arc(&mut self, mark: &RawMark, index: usize) -> Result<()> {
        let x = required_f32(mark.x, index, "x")?;
        let y = required_f32(mark.y, index, "y")?;
        let inner_radius = optional_f32(mark.inner_radius, 0.0, index, "innerRadius")?;
        let outer_radius = required_f32(mark.outer_radius, index, "outerRadius")?;
        let start_angle = required_f32(mark.start_angle, index, "startAngle")?;
        let end_angle = required_f32(mark.end_angle, index, "endAngle")?;
        if outer_radius <= 0.0 || (end_angle - start_angle).abs() <= f32::EPSILON {
            return Ok(());
        }
        let path = arc_path(
            x,
            y,
            inner_radius.max(0.0),
            outer_radius,
            start_angle,
            end_angle,
            self.dpr,
        )?;
        let style = mark_style(mark)?;
        self.fill_and_stroke_path(&path, &style)
    }

    fn render_symbol(&mut self, mark: &RawMark, index: usize) -> Result<()> {
        let x = required_f32(mark.x, index, "x")?;
        let y = required_f32(mark.y, index, "y")?;
        let size = required_f32(mark.size, index, "size")?;
        if size <= 0.0 {
            return Ok(());
        }
        let shape = mark.shape.as_deref().unwrap_or("circle");
        let path = symbol_path(shape, x, y, size, self.dpr)?;
        let style = mark_style(mark)?;
        self.fill_and_stroke_path(&path, &style)
    }

    fn render_text(&mut self, mark: &RawMark, index: usize) -> Result<()> {
        let text = mark
            .text
            .as_deref()
            .ok_or_else(|| invalid_mark(index, "text mark requires text"))?;
        if text.is_empty() {
            return Ok(());
        }
        let x = required_f32(mark.x, index, "x")?;
        let y = required_f32(mark.y, index, "y")?;
        let font_size = required_f32(mark.font_size, index, "fontSize")?;
        let family = normalize_font_family(mark.font_family.as_deref().unwrap_or("Carlito"));
        let bold = is_bold_font_weight(mark.font_weight.as_ref());
        let (_, entry) = self
            .font_db
            .resolve_styled(&family, bold, false)
            .or_else(|| self.font_db.resolve("Carlito"))
            .ok_or_else(|| {
                ChartRenderError::InvalidMark("no bundled font available".to_string())
            })?;
        let buzz_face = entry.face().ok_or_else(|| {
            ChartRenderError::InvalidMark("unable to parse chart font".to_string())
        })?;
        let ttf_face = ttf_parser::Face::parse(entry.data(), entry.index()).map_err(|e| {
            ChartRenderError::InvalidMark(format!("unable to parse TTF font: {e:?}"))
        })?;
        let style = mark_style(mark)?;
        let fill = parse_optional_color(style.fill.as_deref(), style.opacity)?;
        let stroke = parse_optional_color(style.stroke.as_deref(), style.opacity)?;
        if fill.is_none() && stroke.is_none() {
            return Ok(());
        }

        let width = measure_text_advance(&buzz_face, font_size, text);
        let metrics = font_metrics(&buzz_face, font_size);
        let align = mark.text_align.as_deref().unwrap_or("left");
        let baseline = mark.text_baseline.as_deref().unwrap_or("top");
        let local_x = match align {
            "center" => -width / 2.0,
            "right" => -width,
            "left" => 0.0,
            other => {
                return Err(invalid_mark(
                    index,
                    &format!("unsupported textAlign {other}"),
                ));
            }
        };
        let local_baseline = match baseline {
            "top" => metrics.ascender,
            "middle" => (metrics.ascender - metrics.descender) / 2.0,
            "bottom" => -metrics.descender,
            other => {
                return Err(invalid_mark(
                    index,
                    &format!("unsupported textBaseline {other}"),
                ));
            }
        };
        let rotation = optional_f32(mark.rotation, 0.0, index, "rotation")?;
        draw_text_run(
            &mut self.pixmap,
            &buzz_face,
            &ttf_face,
            TextDraw {
                text,
                x,
                y,
                local_x,
                local_baseline,
                font_size,
                dpr: self.dpr,
                rotation,
                fill,
                stroke,
                stroke_width: style.stroke_width,
            },
        );
        Ok(())
    }

    fn fill_and_stroke_path(&mut self, path: &Path, style: &MarkStyle) -> Result<()> {
        if let Some(color) = parse_optional_color(style.fill.as_deref(), style.opacity)? {
            let mut paint = Paint::default();
            paint.set_color(color);
            paint.anti_alias = true;
            self.pixmap
                .fill_path(path, &paint, FillRule::Winding, Transform::identity(), None);
        }
        if let Some(color) = parse_optional_color(style.stroke.as_deref(), style.opacity)? {
            let mut paint = Paint::default();
            paint.set_color(color);
            paint.anti_alias = true;
            let dash = style.stroke_dash.as_ref().and_then(|dash| {
                tiny_skia::StrokeDash::new(dash.iter().map(|v| v * self.dpr).collect(), 0.0)
            });
            let stroke = Stroke {
                width: style.stroke_width.max(0.0) * self.dpr,
                dash,
                ..Default::default()
            };
            self.pixmap
                .stroke_path(path, &paint, &stroke, Transform::identity(), None);
        }
        Ok(())
    }
}

fn finite_positive(name: &str, value: f64) -> Result<f64> {
    if !value.is_finite() || value <= 0.0 {
        return Err(ChartRenderError::InvalidRequest(format!(
            "{name} must be a finite positive number"
        )));
    }
    Ok(value)
}

fn physical_dimension(name: &str, value: f64) -> Result<u32> {
    let rounded = value.round();
    if !rounded.is_finite() || rounded <= 0.0 || rounded > u32::MAX as f64 {
        return Err(ChartRenderError::InvalidRequest(format!(
            "{name} must resolve to a positive pixel dimension"
        )));
    }
    if (value - rounded).abs() > f64::EPSILON * value.abs().max(1.0) * 8.0 {
        return Err(ChartRenderError::InvalidRequest(format!(
            "{name} must resolve to an integer physical pixel dimension"
        )));
    }
    Ok(rounded as u32)
}

fn required_f32(value: Option<f64>, index: usize, field: &str) -> Result<f32> {
    optional_f32(value, f64::NAN, index, field).and_then(|v| {
        if v.is_nan() {
            Err(invalid_mark(index, &format!("missing {field}")))
        } else {
            Ok(v)
        }
    })
}

fn optional_f32(value: Option<f64>, default_value: f64, index: usize, field: &str) -> Result<f32> {
    let value = value.unwrap_or(default_value);
    if !value.is_finite() {
        return Err(invalid_mark(index, &format!("{field} must be finite")));
    }
    Ok(value as f32)
}

fn invalid_mark(index: usize, reason: &str) -> ChartRenderError {
    ChartRenderError::InvalidMark(format!("mark {index}: {reason}"))
}

fn mark_style(mark: &RawMark) -> Result<MarkStyle> {
    let nested = mark.style.as_ref();
    let opacity = nested
        .and_then(|s| s.opacity)
        .or(mark.opacity)
        .unwrap_or(1.0);
    if !opacity.is_finite() || !(0.0..=1.0).contains(&opacity) {
        return Err(ChartRenderError::InvalidMark(
            "style.opacity must be a finite number between 0 and 1".to_string(),
        ));
    }

    let stroke_width = nested
        .and_then(|s| s.stroke_width)
        .or(mark.stroke_width)
        .unwrap_or(1.0);
    if !stroke_width.is_finite() || stroke_width < 0.0 {
        return Err(ChartRenderError::InvalidMark(
            "style.strokeWidth must be a finite non-negative number".to_string(),
        ));
    }

    let corner_radius = nested.and_then(|s| s.corner_radius).unwrap_or(0.0);
    if !corner_radius.is_finite() || corner_radius < 0.0 {
        return Err(ChartRenderError::InvalidMark(
            "style.cornerRadius must be a finite non-negative number".to_string(),
        ));
    }

    let stroke_dash = match nested.and_then(|s| s.stroke_dash.as_ref()) {
        Some(values) => {
            let mut dash = Vec::with_capacity(values.len());
            for value in values {
                if !value.is_finite() || *value < 0.0 {
                    return Err(ChartRenderError::InvalidMark(
                        "style.strokeDash must contain finite non-negative numbers".to_string(),
                    ));
                }
                dash.push(*value as f32);
            }
            Some(dash)
        }
        None => None,
    };

    Ok(MarkStyle {
        fill: nested
            .and_then(|s| s.fill.clone())
            .or_else(|| mark.fill.clone()),
        stroke: nested
            .and_then(|s| s.stroke.clone())
            .or_else(|| mark.stroke.clone()),
        stroke_width: stroke_width as f32,
        stroke_dash,
        opacity: opacity as f32,
        corner_radius: corner_radius as f32,
    })
}

fn rect_path(x: f32, y: f32, width: f32, height: f32, dpr: f32) -> Path {
    let rect =
        Rect::from_xywh(x * dpr, y * dpr, width * dpr, height * dpr).expect("positive finite rect");
    PathBuilder::from_rect(rect)
}

fn rounded_rect_path(x: f32, y: f32, width: f32, height: f32, radius: f32, dpr: f32) -> Path {
    let r = radius.min(width / 2.0).min(height / 2.0) * dpr;
    let x = x * dpr;
    let y = y * dpr;
    let width = width * dpr;
    let height = height * dpr;
    let mut builder = PathBuilder::new();
    builder.move_to(x + r, y);
    builder.line_to(x + width - r, y);
    builder.quad_to(x + width, y, x + width, y + r);
    builder.line_to(x + width, y + height - r);
    builder.quad_to(x + width, y + height, x + width - r, y + height);
    builder.line_to(x + r, y + height);
    builder.quad_to(x, y + height, x, y + height - r);
    builder.line_to(x, y + r);
    builder.quad_to(x, y, x + r, y);
    builder.close();
    builder.finish().expect("rounded rect path")
}

fn arc_path(
    x: f32,
    y: f32,
    inner_radius: f32,
    outer_radius: f32,
    start_angle: f32,
    end_angle: f32,
    dpr: f32,
) -> Result<Path> {
    let span = end_angle - start_angle;
    let segments = ((span.abs() / (PI / 32.0)).ceil() as usize).clamp(2, 256);
    let cx = x * dpr;
    let cy = y * dpr;
    let outer = outer_radius * dpr;
    let inner = inner_radius.min(outer_radius).max(0.0) * dpr;
    let mut builder = PathBuilder::new();

    for i in 0..=segments {
        let t = start_angle + span * (i as f32 / segments as f32) - PI / 2.0;
        let px = cx + t.cos() * outer;
        let py = cy + t.sin() * outer;
        if i == 0 {
            if inner <= 0.0 {
                builder.move_to(cx, cy);
                builder.line_to(px, py);
            } else {
                builder.move_to(px, py);
            }
        } else {
            builder.line_to(px, py);
        }
    }

    if inner > 0.0 {
        for i in (0..=segments).rev() {
            let t = start_angle + span * (i as f32 / segments as f32) - PI / 2.0;
            builder.line_to(cx + t.cos() * inner, cy + t.sin() * inner);
        }
    } else {
        builder.line_to(cx, cy);
    }
    builder.close();
    builder
        .finish()
        .ok_or_else(|| ChartRenderError::InvalidMark("arc produced no path".to_string()))
}

fn symbol_path(shape: &str, x: f32, y: f32, size: f32, dpr: f32) -> Result<Path> {
    let x = x * dpr;
    let y = y * dpr;
    let size = size * dpr * dpr;
    let mut builder = PathBuilder::new();
    match shape {
        "circle" => {
            builder.push_circle(x, y, (size / PI).sqrt());
        }
        "square" => {
            let side = size.sqrt();
            let half = side / 2.0;
            let rect = Rect::from_xywh(x - half, y - half, side, side).ok_or_else(|| {
                ChartRenderError::InvalidMark("invalid square symbol".to_string())
            })?;
            builder.push_rect(rect);
        }
        "diamond" => {
            let side = size.sqrt();
            let half_diag = side * 2.0_f32.sqrt() / 2.0;
            builder.move_to(x, y - half_diag);
            builder.line_to(x + half_diag, y);
            builder.line_to(x, y + half_diag);
            builder.line_to(x - half_diag, y);
            builder.close();
        }
        "cross" => {
            let radius = (size / PI).sqrt() * 1.2;
            let arm = radius * 0.35;
            builder
                .push_rect(Rect::from_xywh(x - radius, y - arm / 2.0, radius * 2.0, arm).unwrap());
            builder
                .push_rect(Rect::from_xywh(x - arm / 2.0, y - radius, arm, radius * 2.0).unwrap());
        }
        "triangle-up" | "triangle-down" => {
            let side = (4.0 * size / 3.0_f32.sqrt()).sqrt();
            let height = side * 3.0_f32.sqrt() / 2.0;
            let offset = height / 3.0;
            if shape == "triangle-up" {
                builder.move_to(x, y - height + offset);
                builder.line_to(x + side / 2.0, y + offset);
                builder.line_to(x - side / 2.0, y + offset);
            } else {
                builder.move_to(x, y + height - offset);
                builder.line_to(x + side / 2.0, y - offset);
                builder.line_to(x - side / 2.0, y - offset);
            }
            builder.close();
        }
        other => {
            return Err(ChartRenderError::InvalidMark(format!(
                "unsupported symbol shape {other}"
            )));
        }
    }
    builder
        .finish()
        .ok_or_else(|| ChartRenderError::InvalidMark("symbol produced no path".to_string()))
}

#[derive(Debug)]
enum PathToken {
    Command(char),
    Number(f32),
}

fn tokenize_path(data: &str) -> Result<Vec<PathToken>> {
    let chars: Vec<char> = data.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0usize;
    while i < chars.len() {
        let ch = chars[i];
        if ch.is_ascii_whitespace() || ch == ',' {
            i += 1;
            continue;
        }
        if ch.is_ascii_alphabetic() {
            tokens.push(PathToken::Command(ch));
            i += 1;
            continue;
        }
        let start = i;
        if chars[i] == '+' || chars[i] == '-' {
            i += 1;
        }
        while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
            i += 1;
        }
        if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
            i += 1;
            if i < chars.len() && (chars[i] == '+' || chars[i] == '-') {
                i += 1;
            }
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
        }
        if start == i {
            return Err(ChartRenderError::InvalidMark(format!(
                "invalid path token near {ch}"
            )));
        }
        let raw: String = chars[start..i].iter().collect();
        let number = raw
            .parse::<f32>()
            .map_err(|_| ChartRenderError::InvalidMark(format!("invalid path number {raw}")))?;
        if !number.is_finite() {
            return Err(ChartRenderError::InvalidMark(format!(
                "path number {raw} is not finite"
            )));
        }
        tokens.push(PathToken::Number(number));
    }
    Ok(tokens)
}

fn parse_svg_path(data: &str, offset_x: f32, offset_y: f32, dpr: f32) -> Result<Path> {
    let tokens = tokenize_path(data)?;
    let mut builder = PathBuilder::new();
    let mut i = 0usize;
    let mut current_x = 0.0f32;
    let mut current_y = 0.0f32;
    let mut last_cx = 0.0f32;
    let mut last_cy = 0.0f32;
    let mut last_cmd: Option<char> = None;

    while i < tokens.len() {
        let cmd = match tokens.get(i) {
            Some(PathToken::Command(cmd)) => {
                i += 1;
                *cmd
            }
            _ => {
                return Err(ChartRenderError::InvalidMark(
                    "path data must contain commands".to_string(),
                ));
            }
        };
        let upper = cmd.to_ascii_uppercase();
        let relative = cmd.is_ascii_lowercase();
        let mut args = Vec::new();
        while i < tokens.len() {
            match tokens.get(i) {
                Some(PathToken::Number(v)) => {
                    args.push(*v);
                    i += 1;
                }
                Some(PathToken::Command(_)) => break,
                None => break,
            }
        }

        let point = |x: f32, y: f32| ((x + offset_x) * dpr, (y + offset_y) * dpr);
        let resolve = |cx: f32, cy: f32, x: f32, y: f32| {
            if relative { (cx + x, cy + y) } else { (x, y) }
        };

        match upper {
            'M' => {
                validate_path_arity(upper, args.len(), 2, true)?;
                for (pair_index, pair) in args.chunks_exact(2).enumerate() {
                    let (x, y) = resolve(current_x, current_y, pair[0], pair[1]);
                    let (px, py) = point(x, y);
                    if pair_index == 0 {
                        builder.move_to(px, py);
                    } else {
                        builder.line_to(px, py);
                    }
                    current_x = x;
                    current_y = y;
                }
            }
            'L' => {
                validate_path_arity(upper, args.len(), 2, true)?;
                for pair in args.chunks_exact(2) {
                    let (x, y) = resolve(current_x, current_y, pair[0], pair[1]);
                    let (px, py) = point(x, y);
                    builder.line_to(px, py);
                    current_x = x;
                    current_y = y;
                }
            }
            'H' => {
                validate_path_arity(upper, args.len(), 1, true)?;
                for arg in args {
                    let x = if relative { current_x + arg } else { arg };
                    let (px, py) = point(x, current_y);
                    builder.line_to(px, py);
                    current_x = x;
                }
            }
            'V' => {
                validate_path_arity(upper, args.len(), 1, true)?;
                for arg in args {
                    let y = if relative { current_y + arg } else { arg };
                    let (px, py) = point(current_x, y);
                    builder.line_to(px, py);
                    current_y = y;
                }
            }
            'C' => {
                validate_path_arity(upper, args.len(), 6, true)?;
                for chunk in args.chunks_exact(6) {
                    let (x1, y1) = resolve(current_x, current_y, chunk[0], chunk[1]);
                    let (x2, y2) = resolve(current_x, current_y, chunk[2], chunk[3]);
                    let (x, y) = resolve(current_x, current_y, chunk[4], chunk[5]);
                    let (x1p, y1p) = point(x1, y1);
                    let (x2p, y2p) = point(x2, y2);
                    let (xp, yp) = point(x, y);
                    builder.cubic_to(x1p, y1p, x2p, y2p, xp, yp);
                    last_cx = x2;
                    last_cy = y2;
                    current_x = x;
                    current_y = y;
                }
            }
            'S' => {
                validate_path_arity(upper, args.len(), 4, true)?;
                for chunk in args.chunks_exact(4) {
                    let (x1, y1) = if matches!(last_cmd, Some('C' | 'S')) {
                        (2.0 * current_x - last_cx, 2.0 * current_y - last_cy)
                    } else {
                        (current_x, current_y)
                    };
                    let (x2, y2) = resolve(current_x, current_y, chunk[0], chunk[1]);
                    let (x, y) = resolve(current_x, current_y, chunk[2], chunk[3]);
                    let (x1p, y1p) = point(x1, y1);
                    let (x2p, y2p) = point(x2, y2);
                    let (xp, yp) = point(x, y);
                    builder.cubic_to(x1p, y1p, x2p, y2p, xp, yp);
                    last_cx = x2;
                    last_cy = y2;
                    current_x = x;
                    current_y = y;
                }
            }
            'Q' => {
                validate_path_arity(upper, args.len(), 4, true)?;
                for chunk in args.chunks_exact(4) {
                    let (x1, y1) = resolve(current_x, current_y, chunk[0], chunk[1]);
                    let (x, y) = resolve(current_x, current_y, chunk[2], chunk[3]);
                    let (x1p, y1p) = point(x1, y1);
                    let (xp, yp) = point(x, y);
                    builder.quad_to(x1p, y1p, xp, yp);
                    last_cx = x1;
                    last_cy = y1;
                    current_x = x;
                    current_y = y;
                }
            }
            'T' => {
                validate_path_arity(upper, args.len(), 2, true)?;
                for pair in args.chunks_exact(2) {
                    let (x1, y1) = if matches!(last_cmd, Some('Q' | 'T')) {
                        (2.0 * current_x - last_cx, 2.0 * current_y - last_cy)
                    } else {
                        (current_x, current_y)
                    };
                    let (x, y) = resolve(current_x, current_y, pair[0], pair[1]);
                    let (x1p, y1p) = point(x1, y1);
                    let (xp, yp) = point(x, y);
                    builder.quad_to(x1p, y1p, xp, yp);
                    last_cx = x1;
                    last_cy = y1;
                    current_x = x;
                    current_y = y;
                }
            }
            'A' => {
                validate_path_arity(upper, args.len(), 7, true)?;
                for chunk in args.chunks_exact(7) {
                    validate_svg_arc_flags(chunk[3], chunk[4])?;
                    let (x, y) = resolve(current_x, current_y, chunk[5], chunk[6]);
                    push_svg_arc(
                        &mut builder,
                        current_x,
                        current_y,
                        chunk[0],
                        chunk[1],
                        chunk[2],
                        chunk[3] == 1.0,
                        chunk[4] == 1.0,
                        x,
                        y,
                        offset_x,
                        offset_y,
                        dpr,
                    );
                    current_x = x;
                    current_y = y;
                }
            }
            'Z' => {
                validate_path_arity(upper, args.len(), 0, false)?;
                builder.close()
            }
            other => {
                return Err(ChartRenderError::InvalidMark(format!(
                    "unsupported path command {other}"
                )));
            }
        }
        last_cmd = Some(upper);
    }

    builder
        .finish()
        .ok_or_else(|| ChartRenderError::InvalidMark("path produced no geometry".to_string()))
}

fn validate_path_arity(
    command: char,
    arg_count: usize,
    unit: usize,
    require_nonempty: bool,
) -> Result<()> {
    if require_nonempty && arg_count == 0 {
        return Err(ChartRenderError::InvalidMark(format!(
            "path command {command} requires arguments"
        )));
    }
    if unit == 0 {
        if arg_count != 0 {
            return Err(ChartRenderError::InvalidMark(format!(
                "path command {command} does not accept arguments"
            )));
        }
        return Ok(());
    }
    if !arg_count.is_multiple_of(unit) {
        return Err(ChartRenderError::InvalidMark(format!(
            "path command {command} has incomplete argument set"
        )));
    }
    Ok(())
}

fn validate_svg_arc_flags(large_arc: f32, sweep: f32) -> Result<()> {
    if !(large_arc == 0.0 || large_arc == 1.0) || !(sweep == 0.0 || sweep == 1.0) {
        return Err(ChartRenderError::InvalidMark(
            "path command A requires arc flags to be 0 or 1".to_string(),
        ));
    }
    Ok(())
}

struct SvgArcCenter {
    cx: f32,
    cy: f32,
    theta1: f32,
    dtheta: f32,
    rx: f32,
    ry: f32,
    phi: f32,
}

#[allow(clippy::too_many_arguments)]
fn svg_arc_endpoint_to_center(
    x1: f32,
    y1: f32,
    rx: f32,
    ry: f32,
    phi_degrees: f32,
    large_arc: bool,
    sweep: bool,
    x2: f32,
    y2: f32,
) -> Option<SvgArcCenter> {
    if rx == 0.0 || ry == 0.0 {
        return None;
    }

    let mut rx = rx.abs();
    let mut ry = ry.abs();
    let phi = phi_degrees.to_radians();
    let cos_phi = phi.cos();
    let sin_phi = phi.sin();

    let dx = (x1 - x2) / 2.0;
    let dy = (y1 - y2) / 2.0;
    let x1p = cos_phi * dx + sin_phi * dy;
    let y1p = -sin_phi * dx + cos_phi * dy;

    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if lambda > 1.0 {
        let scale = lambda.sqrt();
        rx *= scale;
        ry *= scale;
    }

    let rx_sq = rx * rx;
    let ry_sq = ry * ry;
    let x1p_sq = x1p * x1p;
    let y1p_sq = y1p * y1p;
    let denom = rx_sq * y1p_sq + ry_sq * x1p_sq;
    if denom == 0.0 {
        return None;
    }
    let sign = if large_arc == sweep { -1.0 } else { 1.0 };
    let sq = ((rx_sq * ry_sq - rx_sq * y1p_sq - ry_sq * x1p_sq) / denom).max(0.0);
    let coef = sign * sq.sqrt();
    let cxp = coef * ((rx * y1p) / ry);
    let cyp = coef * (-(ry * x1p) / rx);

    let cx = cos_phi * cxp - sin_phi * cyp + (x1 + x2) / 2.0;
    let cy = sin_phi * cxp + cos_phi * cyp + (y1 + y2) / 2.0;
    let theta1 = ((y1p - cyp) / ry).atan2((x1p - cxp) / rx);
    let mut dtheta = ((-y1p - cyp) / ry).atan2((-x1p - cxp) / rx) - theta1;

    if !sweep && dtheta > 0.0 {
        dtheta -= 2.0 * PI;
    } else if sweep && dtheta < 0.0 {
        dtheta += 2.0 * PI;
    }

    Some(SvgArcCenter {
        cx,
        cy,
        theta1,
        dtheta,
        rx,
        ry,
        phi,
    })
}

#[allow(clippy::too_many_arguments)]
fn push_svg_arc(
    builder: &mut PathBuilder,
    current_x: f32,
    current_y: f32,
    rx: f32,
    ry: f32,
    phi_degrees: f32,
    large_arc: bool,
    sweep: bool,
    x: f32,
    y: f32,
    offset_x: f32,
    offset_y: f32,
    dpr: f32,
) {
    let Some(arc) = svg_arc_endpoint_to_center(
        current_x,
        current_y,
        rx,
        ry,
        phi_degrees,
        large_arc,
        sweep,
        x,
        y,
    ) else {
        builder.line_to((x + offset_x) * dpr, (y + offset_y) * dpr);
        return;
    };

    let segments = ((arc.dtheta.abs() / (PI / 32.0)).ceil() as usize).clamp(2, 256);
    let cos_phi = arc.phi.cos();
    let sin_phi = arc.phi.sin();
    for i in 1..=segments {
        let theta = arc.theta1 + arc.dtheta * (i as f32 / segments as f32);
        let px = arc.cx + arc.rx * cos_phi * theta.cos() - arc.ry * sin_phi * theta.sin();
        let py = arc.cy + arc.rx * sin_phi * theta.cos() + arc.ry * cos_phi * theta.sin();
        builder.line_to((px + offset_x) * dpr, (py + offset_y) * dpr);
    }
}

fn parse_required_color(value: &str, opacity: f32) -> Result<Color> {
    parse_optional_color(Some(value), opacity)?
        .ok_or_else(|| ChartRenderError::InvalidColor(format!("{value} is not a visible color")))
}

fn parse_optional_color(value: Option<&str>, opacity: f32) -> Result<Option<Color>> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let raw = raw.trim();
    if raw.is_empty() || raw.eq_ignore_ascii_case("none") {
        return Ok(None);
    }
    let color = if raw.eq_ignore_ascii_case("transparent") {
        Color::from_rgba8(0, 0, 0, 0)
    } else if raw.starts_with('#') {
        parse_hex_color(raw)?
    } else if raw.to_ascii_lowercase().starts_with("rgb(")
        || raw.to_ascii_lowercase().starts_with("rgba(")
    {
        parse_rgb_color(raw)?
    } else {
        parse_named_color(raw)?
    };
    Ok(Some(apply_opacity(color, opacity)?))
}

fn parse_hex_color(raw: &str) -> Result<Color> {
    let hex = raw.trim_start_matches('#');
    let parse = |s: &str| {
        u8::from_str_radix(s, 16).map_err(|_| ChartRenderError::InvalidColor(raw.to_string()))
    };
    match hex.len() {
        3 => Ok(Color::from_rgba8(
            parse(&hex[0..1])? * 17,
            parse(&hex[1..2])? * 17,
            parse(&hex[2..3])? * 17,
            255,
        )),
        6 => Ok(Color::from_rgba8(
            parse(&hex[0..2])?,
            parse(&hex[2..4])?,
            parse(&hex[4..6])?,
            255,
        )),
        8 => Ok(Color::from_rgba8(
            parse(&hex[0..2])?,
            parse(&hex[2..4])?,
            parse(&hex[4..6])?,
            parse(&hex[6..8])?,
        )),
        _ => Err(ChartRenderError::InvalidColor(raw.to_string())),
    }
}

fn parse_rgb_color(raw: &str) -> Result<Color> {
    let start = raw
        .find('(')
        .ok_or_else(|| ChartRenderError::InvalidColor(raw.to_string()))?;
    let end = raw
        .rfind(')')
        .ok_or_else(|| ChartRenderError::InvalidColor(raw.to_string()))?;
    let parts: Vec<&str> = raw[start + 1..end].split(',').map(str::trim).collect();
    if parts.len() != 3 && parts.len() != 4 {
        return Err(ChartRenderError::InvalidColor(raw.to_string()));
    }
    let channel = |part: &str| -> Result<u8> {
        if let Some(percent) = part.strip_suffix('%') {
            let value = percent
                .parse::<f32>()
                .map_err(|_| ChartRenderError::InvalidColor(raw.to_string()))?;
            Ok((value.clamp(0.0, 100.0) * 2.55).round() as u8)
        } else {
            let value = part
                .parse::<f32>()
                .map_err(|_| ChartRenderError::InvalidColor(raw.to_string()))?;
            Ok(value.round().clamp(0.0, 255.0) as u8)
        }
    };
    let alpha = if parts.len() == 4 {
        let value = parts[3]
            .parse::<f32>()
            .map_err(|_| ChartRenderError::InvalidColor(raw.to_string()))?;
        (value.clamp(0.0, 1.0) * 255.0).round() as u8
    } else {
        255
    };
    Ok(Color::from_rgba8(
        channel(parts[0])?,
        channel(parts[1])?,
        channel(parts[2])?,
        alpha,
    ))
}

fn parse_named_color(raw: &str) -> Result<Color> {
    let color = match raw.to_ascii_lowercase().as_str() {
        "black" => (0, 0, 0),
        "white" => (255, 255, 255),
        "red" => (255, 0, 0),
        "green" => (0, 128, 0),
        "blue" => (0, 0, 255),
        "gray" | "grey" => (128, 128, 128),
        "silver" => (192, 192, 192),
        "orange" => (255, 165, 0),
        "yellow" => (255, 255, 0),
        "purple" => (128, 0, 128),
        "pink" => (255, 192, 203),
        "brown" => (165, 42, 42),
        "cyan" | "aqua" => (0, 255, 255),
        "magenta" | "fuchsia" => (255, 0, 255),
        other => return Err(ChartRenderError::InvalidColor(other.to_string())),
    };
    Ok(Color::from_rgba8(color.0, color.1, color.2, 255))
}

fn apply_opacity(color: Color, opacity: f32) -> Result<Color> {
    Color::from_rgba(
        color.red(),
        color.green(),
        color.blue(),
        color.alpha() * opacity.clamp(0.0, 1.0),
    )
    .ok_or_else(|| ChartRenderError::InvalidColor("invalid alpha".to_string()))
}

struct TextMetrics {
    ascender: f32,
    descender: f32,
}

fn font_metrics(face: &rustybuzz::Face<'_>, font_size: f32) -> TextMetrics {
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return TextMetrics {
            ascender: font_size,
            descender: font_size * 0.2,
        };
    }
    TextMetrics {
        ascender: face.ascender() as f32 * font_size / upem,
        descender: -(face.descender() as f32) * font_size / upem,
    }
}

fn measure_text_advance(face: &rustybuzz::Face<'_>, font_size: f32, text: &str) -> f32 {
    if text.is_empty() {
        return 0.0;
    }
    let upem = face.units_per_em() as f32;
    if upem == 0.0 {
        return 0.0;
    }
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    let output = rustybuzz::shape(face, &[], buffer);
    let total: i32 = output.glyph_positions().iter().map(|p| p.x_advance).sum();
    total as f32 * font_size / upem
}

struct OutlineAdapter {
    builder: PathBuilder,
    scale: f32,
}

impl OutlineAdapter {
    fn new(scale: f32) -> Self {
        Self {
            builder: PathBuilder::new(),
            scale,
        }
    }

    fn finish(self) -> Option<Path> {
        self.builder.finish()
    }
}

impl ttf_parser::OutlineBuilder for OutlineAdapter {
    fn move_to(&mut self, x: f32, y: f32) {
        self.builder.move_to(x * self.scale, -y * self.scale);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.builder.line_to(x * self.scale, -y * self.scale);
    }

    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.builder.quad_to(
            x1 * self.scale,
            -y1 * self.scale,
            x * self.scale,
            -y * self.scale,
        );
    }

    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.builder.cubic_to(
            x1 * self.scale,
            -y1 * self.scale,
            x2 * self.scale,
            -y2 * self.scale,
            x * self.scale,
            -y * self.scale,
        );
    }

    fn close(&mut self) {
        self.builder.close();
    }
}

fn glyph_outline_to_path(
    face: &ttf_parser::Face<'_>,
    glyph_id: GlyphId,
    scale: f32,
) -> Option<Path> {
    let mut adapter = OutlineAdapter::new(scale);
    face.outline_glyph(glyph_id, &mut adapter)?;
    adapter.finish()
}

struct TextDraw<'a> {
    text: &'a str,
    x: f32,
    y: f32,
    local_x: f32,
    local_baseline: f32,
    font_size: f32,
    dpr: f32,
    rotation: f32,
    fill: Option<Color>,
    stroke: Option<Color>,
    stroke_width: f32,
}

fn draw_text_run(
    pixmap: &mut Pixmap,
    buzz_face: &rustybuzz::Face<'_>,
    ttf_face: &ttf_parser::Face<'_>,
    run: TextDraw<'_>,
) {
    let upem = buzz_face.units_per_em() as f32;
    if upem == 0.0 {
        return;
    }
    let scale = run.font_size / upem;
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(run.text);
    let output = rustybuzz::shape(buzz_face, &[], buffer);
    let positions = output.glyph_positions();
    let infos = output.glyph_infos();
    let mut cursor_x = run.local_x;
    let rotate_degrees = run.rotation.to_degrees();
    let pivot_x = run.x * run.dpr;
    let pivot_y = run.y * run.dpr;

    for (info, pos) in infos.iter().zip(positions.iter()) {
        let glyph_id = GlyphId(info.glyph_id as u16);
        if let Some(path) = glyph_outline_to_path(ttf_face, glyph_id, scale * run.dpr) {
            let tx = (run.x + cursor_x + pos.x_offset as f32 * scale) * run.dpr;
            let ty = (run.y + run.local_baseline - pos.y_offset as f32 * scale) * run.dpr;
            let transform = if run.rotation == 0.0 {
                Transform::from_translate(tx, ty)
            } else {
                Transform::from_translate(tx, ty).post_rotate_at(rotate_degrees, pivot_x, pivot_y)
            };
            if let Some(fill) = run.fill {
                let mut paint = Paint::default();
                paint.set_color(fill);
                paint.anti_alias = true;
                pixmap.fill_path(&path, &paint, FillRule::Winding, transform, None);
            }
            if let Some(stroke_color) = run.stroke {
                let mut paint = Paint::default();
                paint.set_color(stroke_color);
                paint.anti_alias = true;
                let stroke = Stroke {
                    width: run.stroke_width.max(0.0) * run.dpr,
                    ..Default::default()
                };
                pixmap.stroke_path(&path, &paint, &stroke, transform, None);
            }
        }
        cursor_x += pos.x_advance as f32 * scale;
    }
}

fn normalize_font_family(raw: &str) -> String {
    raw.split(',')
        .next()
        .unwrap_or(raw)
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn is_bold_font_weight(value: Option<&serde_json::Value>) -> bool {
    match value {
        Some(serde_json::Value::String(s)) => s.eq_ignore_ascii_case("bold"),
        Some(serde_json::Value::Number(n)) => n.as_u64().is_some_and(|v| v >= 600),
        _ => false,
    }
}

fn encode_png(pixmap: &Pixmap) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, pixmap.width(), pixmap.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|e| ChartRenderError::Encode(e.to_string()))?;
        writer
            .write_image_data(pixmap.data())
            .map_err(|e| ChartRenderError::Encode(e.to_string()))?;
    }
    Ok(buf)
}

fn encode_jpeg(pixmap: &Pixmap, quality: u8) -> Result<Vec<u8>> {
    let mut rgb = Vec::with_capacity((pixmap.width() * pixmap.height() * 3) as usize);
    for px in pixmap.data().chunks_exact(4) {
        rgb.push(px[0]);
        rgb.push(px[1]);
        rgb.push(px[2]);
    }
    let mut buf = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut buf, quality);
    encoder
        .encode(
            &rgb,
            pixmap.width(),
            pixmap.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|e| ChartRenderError::Encode(e.to_string()))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(marks: Vec<serde_json::Value>) -> RenderChartMarksRequest {
        serde_json::from_value(serde_json::json!({
            "version": 1,
            "marks": marks,
            "options": {
                "format": "png",
                "width": 240,
                "height": 160,
                "pixelRatio": 1,
                "backgroundColor": "#ffffff"
            }
        }))
        .unwrap()
    }

    fn decode_png(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
        let decoder = png::Decoder::new(bytes);
        let mut reader = decoder.read_info().unwrap();
        let mut data = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut data).unwrap();
        data.truncate(info.buffer_size());
        (info.width, info.height, data)
    }

    fn nonwhite_pixels(data: &[u8]) -> usize {
        data.chunks_exact(4)
            .filter(|px| px[3] > 0 && (px[0] < 245 || px[1] < 245 || px[2] < 245))
            .count()
    }

    #[test]
    fn renders_conformance_mark_families_to_nonblank_png() {
        let req = request(vec![
            serde_json::json!({
                "type": "rect",
                "x": 12,
                "y": 20,
                "width": 40,
                "height": 80,
                "style": { "fill": "#4472c4", "stroke": "#1f3d73", "strokeWidth": 2 }
            }),
            serde_json::json!({
                "type": "path",
                "x": 0,
                "y": 0,
                "path": "M70,100 L105,40 L145,78 L185,28",
                "style": { "fill": "none", "stroke": "#c00000", "strokeWidth": 4 }
            }),
            serde_json::json!({
                "type": "path",
                "x": 0,
                "y": 0,
                "path": "M70,120 L110,90 L150,105 L190,72 L190,130 L70,130 Z",
                "style": { "fill": "rgba(112, 173, 71, 0.45)", "stroke": "#70ad47", "strokeWidth": 1 }
            }),
            serde_json::json!({
                "type": "arc",
                "x": 56,
                "y": 124,
                "innerRadius": 12,
                "outerRadius": 28,
                "startAngle": 0,
                "endAngle": 4.7,
                "style": { "fill": "#ed7d31", "stroke": "#ffffff", "strokeWidth": 1 }
            }),
            serde_json::json!({
                "type": "symbol",
                "x": 198,
                "y": 96,
                "shape": "diamond",
                "size": 160,
                "style": { "fill": "#7030a0", "stroke": "#222222", "strokeWidth": 1, "opacity": 0.85 }
            }),
            serde_json::json!({
                "type": "text",
                "x": 120,
                "y": 8,
                "text": "Sales",
                "fontSize": 16,
                "fontFamily": "Carlito",
                "fontWeight": "bold",
                "textAlign": "center",
                "textBaseline": "top",
                "style": { "fill": "#333333" }
            }),
        ]);

        let rendered = render_chart_marks_image(&req).unwrap();
        assert_eq!(rendered.format, ChartImageFormat::Png);
        assert_eq!(&rendered.bytes[..8], b"\x89PNG\r\n\x1a\n");
        let (width, height, data) = decode_png(&rendered.bytes);
        assert_eq!((width, height), (240, 160));
        assert!(nonwhite_pixels(&data) > 500);
    }

    #[test]
    fn rejects_empty_marks_and_unsupported_format() {
        let empty = request(vec![]);
        assert!(matches!(
            render_chart_marks_image(&empty),
            Err(ChartRenderError::InvalidRequest(_))
        ));

        let mut svg = request(vec![serde_json::json!({
            "type": "rect",
            "x": 0,
            "y": 0,
            "width": 10,
            "height": 10,
            "style": { "fill": "#000000" }
        })]);
        svg.options.format = "svg".to_string();
        assert!(matches!(
            render_chart_marks_image(&svg),
            Err(ChartRenderError::UnsupportedFormat(_))
        ));
    }

    #[test]
    fn renders_jpeg_when_requested() {
        let mut req = request(vec![serde_json::json!({
            "type": "rect",
            "x": 5,
            "y": 5,
            "width": 30,
            "height": 30,
            "style": { "fill": "#0000ff" }
        })]);
        req.options.format = "jpeg".to_string();
        req.options.quality = Some(0.75);

        let rendered = render_chart_marks_image(&req).unwrap();
        assert_eq!(rendered.format, ChartImageFormat::Jpeg);
        assert_eq!(&rendered.bytes[..2], &[0xff, 0xd8]);
    }
}
