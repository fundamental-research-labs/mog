//! N-API bindings for chart mark rasterization.
//!
//! Chart semantics stay in TypeScript: callers pass the mark IR produced by
//! IChartBridge.getMarksAtSize(). This native entry point only rasterizes that
//! typed, versioned request into encoded image bytes.

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct RenderChartMarksImageResult {
    pub bytes: Buffer,
    pub format: String,
    pub width: u32,
    pub height: u32,
}

#[napi(js_name = "render_chart_marks_image")]
pub fn render_chart_marks_image(request_json: String) -> Result<RenderChartMarksImageResult> {
    let rendered = compute_chart_render::render_chart_marks_image_from_json(&request_json)
        .map_err(|e| Error::from_reason(format!("chart render failed: {e}")))?;

    let format = match rendered.format {
        compute_chart_render::ChartImageFormat::Png => "png",
        compute_chart_render::ChartImageFormat::Jpeg => "jpeg",
    }
    .to_string();

    Ok(RenderChartMarksImageResult {
        bytes: Buffer::from(rendered.bytes),
        format,
        width: rendered.width,
        height: rendered.height,
    })
}
