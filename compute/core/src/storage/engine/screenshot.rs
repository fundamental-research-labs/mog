//! Headless sheet screenshot — renders a cell range to a PNG buffer.
//!
//! Wires `compute_screenshot::render_sheet_to_png` into the bridge system so
//! that Node.js (via NAPI) and Python (via PyO3) can call it directly.

use cell_types::SheetId;
use compute_screenshot::ScreenshotOptions;

use bridge_core as bridge;

use super::YrsComputeEngine;

#[bridge::api(
    service = "YrsComputeEngine",
    key = "doc_id",
    group = "screenshot",
    fn_prefix = "compute",
    crate_path = "compute_core"
)]
impl YrsComputeEngine {
    /// Capture a PNG screenshot of a cell range.
    ///
    /// Builds `ViewportRenderData` for the requested region, rasterizes it
    /// with the bundled font database, and returns PNG bytes.
    /// `start_row`, `start_col`, `end_row`, `end_col` are **inclusive, 0-based**
    /// (matching the output of `parseCellRange` on the JS side).
    ///
    /// Logically a read — no engine state is authoritatively mutated; the
    /// viewport format palette is an observational cache. Annotated
    /// `#[bridge::read(scope = "range")]` so the gated delegate routes
    /// through `filter_range_values` (a Vec<u8> result is unfiltered by
    /// the range filter — this is fine; fine-grained cell redaction for
    /// screenshots is out of scope for R4).
    #[bridge::read(scope = "range")]
    pub fn capture_screenshot(
        &self,
        sheet_id: &SheetId,
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
        dpr: f64,
        show_headers: bool,
        show_gridlines: bool,
        max_width: Option<u32>,
        max_height: Option<u32>,
    ) -> Vec<u8> {
        // parseCellRange returns inclusive bounds; the viewport builder uses
        // exclusive end.  Convert: inclusive end_row/col → exclusive +1.
        let exc_end_row = end_row + 1;
        let exc_end_col = end_col + 1;

        let mut viewport_data = self.build_viewport_render_data(
            sheet_id,
            start_row,
            start_col,
            exc_end_row,
            exc_end_col,
        );

        // build_position_array now emits viewport_rows + 1 entries — the
        // trailing entry is the sentinel (top edge of `exc_end_row`), which
        // the renderer needs to know the bottom edge of the last cell. No
        // manual append needed: the wire contract carries it inline.

        // Positions from the layout index are absolute (relative to the
        // sheet origin).  Shift them so position[0] = 0, giving the
        // renderer a tight canvas with no blank margin.
        if let Some(&origin) = viewport_data.row_positions.first() {
            for p in &mut viewport_data.row_positions {
                *p -= origin;
            }
        }
        if let Some(&origin) = viewport_data.col_positions.first() {
            for p in &mut viewport_data.col_positions {
                *p -= origin;
            }
        }

        let options = ScreenshotOptions {
            dpr: dpr as f32,
            show_headers,
            show_gridlines,
            max_width,
            max_height,
        };

        compute_screenshot::render_sheet_to_png(&viewport_data, &self.stores.font_db, &options)
    }
}
