use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct RenderChartMarksImageResult {
    bytes: Vec<u8>,
    format: String,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl RenderChartMarksImageResult {
    #[wasm_bindgen(getter)]
    pub fn bytes(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(self.bytes.as_slice())
    }

    #[wasm_bindgen(getter)]
    pub fn format(&self) -> String {
        self.format.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
}

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen(js_name = render_chart_marks_image)]
pub fn render_chart_marks_image(
    request_json: String,
) -> Result<RenderChartMarksImageResult, JsValue> {
    let rendered = compute_chart_render::render_chart_marks_image_from_json(&request_json)
        .map_err(|error| JsValue::from_str(&format!("chart render failed: {error}")))?;

    let format = match rendered.format {
        compute_chart_render::ChartImageFormat::Png => "png",
        compute_chart_render::ChartImageFormat::Jpeg => "jpeg",
    }
    .to_string();

    Ok(RenderChartMarksImageResult {
        bytes: rendered.bytes,
        format,
        width: rendered.width,
        height: rendered.height,
    })
}
