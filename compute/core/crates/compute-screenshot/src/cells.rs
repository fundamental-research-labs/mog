use compute_text_measurement::FontDb;
use compute_wire::{ViewportRenderCell, ViewportRenderData, flags as render_flags};
use domain_types::CellFormat;

use crate::borders::{self, CellBorderRefs};
use crate::canvas::{CssRect, SheetCanvas};
use crate::colors;
use crate::text;

/// Default font size in points (Calibri 11pt equivalent).
const DEFAULT_FONT_SIZE: f32 = 11.0;
/// Default font family.
const DEFAULT_FONT_FAMILY: &str = "Calibri";
/// Cell horizontal padding in CSS pixels.
const CELL_PADDING: f32 = 4.0;

/// Render all cells from ViewportRenderData onto the canvas.
///
/// `offset_x` / `offset_y` shift the data area (e.g., to account for headers).
/// `row_positions` / `col_positions` are cumulative pixel offsets from the data origin.
pub fn render_cells(
    canvas: &mut SheetCanvas,
    data: &ViewportRenderData,
    row_positions: &[f64],
    col_positions: &[f64],
    offset_x: f32,
    offset_y: f32,
    font_db: &FontDb,
) {
    // Pass 1: fills. Text overflow must be painted after all adjacent blank
    // cell fills, otherwise those fills cover the overflowed glyphs.
    for cell in &data.cells {
        let Some(rect) = cell_rect(data, cell, row_positions, col_positions, offset_x, offset_y)
        else {
            continue;
        };

        let format = data
            .format_palette
            .get(cell.format_idx as usize)
            .cloned()
            .unwrap_or_default();

        render_cell_fill(
            canvas,
            rect.x,
            rect.y,
            rect.w,
            rect.h,
            &format,
            cell.bg_color_override,
        );
    }

    // Pass 2: borders. The live grid paints borders before text so overflowed
    // labels remain readable across same-filled blank cells.
    for cell in &data.cells {
        let Some(rect) = cell_rect(data, cell, row_positions, col_positions, offset_x, offset_y)
        else {
            continue;
        };

        let format = data
            .format_palette
            .get(cell.format_idx as usize)
            .cloned()
            .unwrap_or_default();

        if let Some(ref borders) = format.borders {
            borders::render_cell_borders(
                canvas,
                rect,
                CellBorderRefs {
                    top: borders.top.as_ref(),
                    right: borders.right.as_ref(),
                    bottom: borders.bottom.as_ref(),
                    left: borders.left.as_ref(),
                },
            );
        }
    }

    // Pass 3: text. This pass can safely draw into adjacent empty cells.
    for cell in &data.cells {
        let Some(rect) = cell_rect(data, cell, row_positions, col_positions, offset_x, offset_y)
        else {
            continue;
        };

        let Some(ref text_str) = cell.formatted else {
            continue;
        };

        let format = data
            .format_palette
            .get(cell.format_idx as usize)
            .cloned()
            .unwrap_or_default();

        render_cell_text(
            canvas,
            CellText {
                cell,
                data,
                col_positions,
                rect,
                text: text_str,
                format: &format,
                font_color_override: cell.font_color_override,
                font_db,
            },
        );
    }
}

fn cell_rect(
    data: &ViewportRenderData,
    cell: &ViewportRenderCell,
    row_positions: &[f64],
    col_positions: &[f64],
    offset_x: f32,
    offset_y: f32,
) -> Option<CssRect> {
    let local_row = cell.row.checked_sub(data.start_row)? as usize;
    let local_col = cell.col.checked_sub(data.start_col)? as usize;

    if local_row + 1 >= row_positions.len() || local_col + 1 >= col_positions.len() {
        return None;
    }

    let rect = CssRect::new(
        col_positions[local_col] as f32 + offset_x,
        row_positions[local_row] as f32 + offset_y,
        (col_positions[local_col + 1] - col_positions[local_col]) as f32,
        (row_positions[local_row + 1] - row_positions[local_row]) as f32,
    );

    if rect.w < 0.5 || rect.h < 0.5 {
        return None;
    }

    Some(rect)
}

/// Render cell background fill.
fn render_cell_fill(
    canvas: &mut SheetCanvas,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    format: &CellFormat,
    bg_color_override: u32,
) {
    // CF override takes precedence
    if let Some(color) = colors::rgba_to_color(bg_color_override) {
        canvas.fill_rect(x, y, w, h, color);
        return;
    }

    // Explicit fill from format
    if let Some(ref bg) = format.background_color
        && let Some(color) = colors::css_hex_to_color(bg)
    {
        // Only fill if pattern is Solid or absent (default=solid).
        use ooxml_types::styles::PatternType;
        let is_solid = matches!(format.pattern_type, None | Some(PatternType::Solid));
        if is_solid {
            canvas.fill_rect(x, y, w, h, color);
        }
    }
}

struct CellText<'a> {
    cell: &'a ViewportRenderCell,
    data: &'a ViewportRenderData,
    col_positions: &'a [f64],
    rect: CssRect,
    text: &'a str,
    format: &'a CellFormat,
    font_color_override: u32,
    font_db: &'a FontDb,
}

/// Render cell text with alignment.
fn render_cell_text(canvas: &mut SheetCanvas, cell_text: CellText<'_>) {
    if cell_text.text.is_empty() {
        return;
    }

    let rect = cell_text.rect;
    let format = cell_text.format;
    let family = format.font_family.as_deref().unwrap_or(DEFAULT_FONT_FAMILY);
    let bold = format.bold.unwrap_or(false);
    let italic = format.italic.unwrap_or(false);
    let font_size = format
        .font_size
        .map(|fs| fs.points() as f32)
        .unwrap_or(DEFAULT_FONT_SIZE);

    let (_, entry) = match cell_text.font_db.resolve_styled(family, bold, italic) {
        Some(e) => e,
        None => return,
    };
    let buzz_face = match entry.face() {
        Some(f) => f,
        None => return,
    };
    let ttf_face = match ttf_parser::Face::parse(entry.data(), entry.index()) {
        Ok(f) => f,
        Err(_) => return,
    };

    // Determine text color
    let text_color = colors::rgba_to_color(cell_text.font_color_override)
        .or_else(|| {
            format
                .font_color
                .as_deref()
                .and_then(colors::css_hex_to_color)
        })
        .unwrap_or(colors::BLACK);

    let text_w = text::measure_text_advance(&buzz_face, font_size, cell_text.text);
    let ascender = text::ascender_px(&buzz_face, font_size);
    let line_h = text::line_height_px(&buzz_face, font_size);
    let clip_rect = text_clip_rect(&cell_text, text_w);

    // Horizontal alignment
    use domain_types::CellVerticalAlign;
    use ooxml_types::styles::HorizontalAlign;
    let h_align = format.horizontal_align.unwrap_or(HorizontalAlign::General);
    let text_x = match h_align {
        HorizontalAlign::Center | HorizontalAlign::CenterContinuous => {
            rect.x + (rect.w - text_w) / 2.0
        }
        HorizontalAlign::Right => rect.x + rect.w - text_w - CELL_PADDING,
        _ => rect.x + CELL_PADDING, // Left, General, Fill, Justify, Distributed
    };

    // Vertical alignment
    let v_align = format.vertical_align.unwrap_or(CellVerticalAlign::Bottom);
    let text_y = match v_align {
        CellVerticalAlign::Top => rect.y + ascender + 2.0,
        CellVerticalAlign::Middle => rect.y + (rect.h - line_h) / 2.0 + ascender,
        _ => rect.y + rect.h - (line_h - ascender) - 2.0, // Bottom default, Justify, Distributed
    };

    canvas.set_clip(clip_rect.x, clip_rect.y, clip_rect.w, clip_rect.h);
    text::render_text(
        canvas,
        &buzz_face,
        &ttf_face,
        text::TextRun {
            font_size,
            text: cell_text.text,
            x: text_x,
            y: text_y,
            color: text_color,
        },
    );
    canvas.clear_clip();
}

fn text_clip_rect(cell_text: &CellText<'_>, text_w: f32) -> CssRect {
    let rect = cell_text.rect;
    let required_w = text_w + CELL_PADDING * 2.0;

    if required_w <= rect.w
        || !cell_value_can_overflow(cell_text.cell)
        || cell_text.format.wrap_text.unwrap_or(false)
        || cell_text.format.shrink_to_fit.unwrap_or(false)
        || cell_in_merge(cell_text.data, cell_text.cell.row, cell_text.cell.col)
    {
        return rect;
    }

    use ooxml_types::styles::HorizontalAlign;
    match cell_text
        .format
        .horizontal_align
        .unwrap_or(HorizontalAlign::General)
    {
        HorizontalAlign::Right => overflow_left_clip_rect(cell_text, required_w),
        HorizontalAlign::Center | HorizontalAlign::CenterContinuous => {
            overflow_center_clip_rect(cell_text, required_w)
        }
        HorizontalAlign::Fill | HorizontalAlign::Distributed => rect,
        // Text-valued General cells are left-aligned in Excel.
        HorizontalAlign::General | HorizontalAlign::Left | HorizontalAlign::Justify => {
            overflow_right_clip_rect(cell_text, required_w)
        }
    }
}

fn overflow_right_clip_rect(cell_text: &CellText<'_>, required_w: f32) -> CssRect {
    let mut clip = cell_text.rect;
    let row = cell_text.cell.row;
    let max_col = cell_text.data.start_col + cell_text.data.viewport_cols.saturating_sub(1);

    let mut col = cell_text.cell.col + 1;
    while col <= max_col && clip.w < required_w {
        if !cell_empty_for_overflow(cell_text.data, row, col)
            || cell_in_merge(cell_text.data, row, col)
        {
            break;
        }

        if let Some(width) = col_width(cell_text.data, cell_text.col_positions, col) {
            clip.w += width;
        }
        col += 1;
    }

    clip
}

fn overflow_left_clip_rect(cell_text: &CellText<'_>, required_w: f32) -> CssRect {
    let mut clip = cell_text.rect;
    let row = cell_text.cell.row;
    let min_col = cell_text.data.start_col;
    let mut col = cell_text.cell.col;

    while col > min_col && clip.w < required_w {
        col -= 1;
        if !cell_empty_for_overflow(cell_text.data, row, col)
            || cell_in_merge(cell_text.data, row, col)
        {
            break;
        }

        if let Some(width) = col_width(cell_text.data, cell_text.col_positions, col) {
            clip.x -= width;
            clip.w += width;
        }
    }

    clip
}

fn overflow_center_clip_rect(cell_text: &CellText<'_>, required_w: f32) -> CssRect {
    let mut clip = cell_text.rect;
    let row = cell_text.cell.row;
    let min_col = cell_text.data.start_col;
    let max_col = cell_text.data.start_col + cell_text.data.viewport_cols.saturating_sub(1);
    let mut left_col = cell_text.cell.col;
    let mut right_col = cell_text.cell.col + 1;

    while clip.w < required_w {
        let need_left = clip.x > cell_text.rect.x + (cell_text.rect.w - required_w) / 2.0;
        let mut extended = false;

        if need_left && left_col > min_col {
            let candidate = left_col - 1;
            if cell_empty_for_overflow(cell_text.data, row, candidate)
                && !cell_in_merge(cell_text.data, row, candidate)
                && let Some(width) = col_width(cell_text.data, cell_text.col_positions, candidate)
            {
                clip.x -= width;
                clip.w += width;
                left_col = candidate;
                extended = true;
            }
        }

        if clip.w >= required_w {
            break;
        }

        if right_col <= max_col
            && cell_empty_for_overflow(cell_text.data, row, right_col)
            && !cell_in_merge(cell_text.data, row, right_col)
            && let Some(width) = col_width(cell_text.data, cell_text.col_positions, right_col)
        {
            clip.w += width;
            right_col += 1;
            extended = true;
        }

        if !extended {
            break;
        }
    }

    clip
}

fn col_width(data: &ViewportRenderData, col_positions: &[f64], col: u32) -> Option<f32> {
    let local_col = col.checked_sub(data.start_col)? as usize;
    if local_col + 1 >= col_positions.len() {
        return None;
    }
    let width = (col_positions[local_col + 1] - col_positions[local_col]) as f32;
    if width < 0.5 { None } else { Some(width) }
}

fn cell_value_can_overflow(cell: &ViewportRenderCell) -> bool {
    (cell.flags & render_flags::VALUE_TYPE_MASK) == render_flags::VALUE_TYPE_TEXT
        && cell
            .formatted
            .as_deref()
            .is_some_and(|text| !text.is_empty())
}

fn cell_empty_for_overflow(data: &ViewportRenderData, row: u32, col: u32) -> bool {
    let Some(cell) = cell_at(data, row, col) else {
        return true;
    };

    match cell.flags & render_flags::VALUE_TYPE_MASK {
        render_flags::VALUE_TYPE_NULL => true,
        render_flags::VALUE_TYPE_TEXT => cell.formatted.as_deref().is_none_or(str::is_empty),
        _ => false,
    }
}

fn cell_at(data: &ViewportRenderData, row: u32, col: u32) -> Option<&ViewportRenderCell> {
    if row < data.start_row
        || col < data.start_col
        || row >= data.start_row + data.viewport_rows
        || col >= data.start_col + data.viewport_cols
    {
        return None;
    }

    let rel_row = row - data.start_row;
    let rel_col = col - data.start_col;
    let idx = (rel_row * data.viewport_cols + rel_col) as usize;
    if let Some(cell) = data.cells.get(idx)
        && cell.row == row
        && cell.col == col
    {
        return Some(cell);
    }

    data.cells
        .iter()
        .find(|cell| cell.row == row && cell.col == col)
}

fn cell_in_merge(data: &ViewportRenderData, row: u32, col: u32) -> bool {
    data.merges.iter().any(|merge| {
        row >= merge.start_row
            && row <= merge.end_row
            && col >= merge.start_col
            && col <= merge.end_col
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::*;
    use compute_wire::{
        RenderViewportMerge, ViewportRenderCell, ViewportRenderData, flags as render_flags,
    };

    fn make_viewport_data(cells: Vec<ViewportRenderCell>) -> ViewportRenderData {
        ViewportRenderData {
            cells,
            format_palette: vec![CellFormat::default()],
            merges: vec![],
            row_dimensions: vec![],
            col_dimensions: vec![],
            viewport_rows: 5,
            viewport_cols: 5,
            start_row: 0,
            start_col: 0,
            row_positions: vec![0.0, 20.0, 40.0, 60.0, 80.0, 100.0],
            col_positions: vec![0.0, 64.0, 128.0, 192.0, 256.0, 320.0],
        }
    }

    fn make_cell(row: u32, col: u32, text: &str) -> ViewportRenderCell {
        ViewportRenderCell {
            row,
            col,
            format_idx: 0,
            flags: if text.is_empty() {
                render_flags::VALUE_TYPE_NULL
            } else {
                render_flags::VALUE_TYPE_TEXT
            },
            number_value: f64::NAN,
            formatted: if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            },
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }
    }

    fn make_cell_with_format(
        row: u32,
        col: u32,
        text: &str,
        format_idx: u16,
    ) -> ViewportRenderCell {
        ViewportRenderCell {
            row,
            col,
            format_idx,
            flags: if text.is_empty() {
                render_flags::VALUE_TYPE_NULL
            } else {
                render_flags::VALUE_TYPE_TEXT
            },
            number_value: f64::NAN,
            formatted: if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            },
            error: None,
            bg_color_override: 0,
            font_color_override: 0,
            cf_extras: None,
        }
    }

    #[test]
    fn render_cell_text_position() {
        let db = shared_font_db();
        let data = make_viewport_data(vec![make_cell(0, 0, "Hello")]);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Text should be within cell A1 (x: 0..64, y: 0..20)
        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected rendered text in cell A1");
        let (left, right) = bounds.unwrap();

        // Default alignment is left with CELL_PADDING=4
        assert!(
            (2..=6).contains(&left),
            "text left edge at {left}, expected near CELL_PADDING (4)"
        );

        // Measure expected width and compare
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        let expected_w = text::measure_text_advance(&face, DEFAULT_FONT_SIZE, "Hello");
        let rendered_w = (right - left + 1) as f32;
        assert!(
            (rendered_w - expected_w).abs() < 5.0,
            "rendered width {rendered_w} vs measured {expected_w}"
        );

        // No text in adjacent cell B1 (x: 64..128)
        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 66, 128, 200).is_none(),
            "no text should leak into cell B1"
        );
    }

    #[test]
    fn cell_fill_exact_rect() {
        let db = shared_font_db();
        let format = CellFormat {
            background_color: Some("#00FF00".to_string()),
            ..Default::default()
        };
        let cell = make_cell_with_format(0, 0, "", 1);
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Cell A1 is [0..64) × [0..20) — should be filled with green
        assert_rect_filled(
            &canvas,
            PixelRect::new(1, 1, 62, 18),
            GREEN_RGB,
            0,
            "cell A1 green fill",
        );

        // Adjacent cell B1 should remain white
        assert_pixel_white(&canvas, 66, 10, "cell B1 should be white");
        // Cell below A2 should be white
        assert_pixel_white(&canvas, 32, 22, "cell A2 should be white");
    }

    #[test]
    fn cf_bg_override_takes_precedence() {
        let db = shared_font_db();
        // Format has green background, but CF override is red
        let format = CellFormat {
            background_color: Some("#00FF00".to_string()),
            ..Default::default()
        };
        let mut cell = make_cell_with_format(0, 0, "", 1);
        cell.bg_color_override = 0xFF0000FF; // Red, fully opaque
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Cell A1 should be red (override wins), not green
        assert_rect_filled(
            &canvas,
            PixelRect::new(1, 1, 62, 18),
            RED_RGB,
            0,
            "CF override = red",
        );
    }

    #[test]
    fn horizontal_alignment_center() {
        let db = shared_font_db();
        let format = CellFormat {
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
            ..Default::default()
        };
        let cell = make_cell_with_format(0, 0, "Hi", 1);
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected centered text in cell A1");
        let (left, right) = bounds.unwrap();
        let text_center = (left + right) / 2;
        // Cell center is at x=32
        assert!(
            text_center.abs_diff(32) <= 5,
            "centered text center at {text_center}, expected near 32"
        );
    }

    #[test]
    fn horizontal_alignment_right() {
        let db = shared_font_db();
        let format = CellFormat {
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Right),
            ..Default::default()
        };
        let cell = make_cell_with_format(0, 0, "Hi", 1);
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected right-aligned text in cell A1");
        let (_left, right) = bounds.unwrap();
        // Right edge of cell is x=63, minus CELL_PADDING(4) → text should end near 59
        assert!(
            (55..=63).contains(&right),
            "right-aligned text ends at {right}, expected near 59"
        );
    }

    #[test]
    fn font_color_override() {
        let db = shared_font_db();
        // Format specifies black font, CF override is blue
        let format = CellFormat {
            font_color: Some("#000000".to_string()),
            ..Default::default()
        };
        let mut cell = make_cell_with_format(0, 0, "X", 1);
        cell.font_color_override = 0x0000FFFF; // Blue, fully opaque
        let mut data = make_viewport_data(vec![cell]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        // Find a dark pixel in the text region and verify it's blue
        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "expected text in cell A1");
        let (left, right) = bounds.unwrap();
        let mid_x = (left + right) / 2;
        // Find a row with a dark pixel at mid_x
        let mut found_blue = false;
        for py in 0..20 {
            let (r, g, b, _) = canvas.pixel_at(mid_x, py);
            if b > 200 && r < 50 && g < 50 {
                found_blue = true;
                break;
            }
            // Anti-aliased pixels will have some blue bias
            if b > r.saturating_add(20) && b > g.saturating_add(20) && b > 100 {
                found_blue = true;
                break;
            }
        }
        assert!(found_blue, "text should be blue (font_color_override)");
    }

    #[test]
    fn text_overflows_right_into_empty_adjacent_cells() {
        let db = shared_font_db();
        let long_text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let blank_fill = CellFormat {
            background_color: Some("#F5F5F5".to_string()),
            ..Default::default()
        };
        let mut data = make_viewport_data(vec![
            make_cell(0, 0, long_text),
            make_cell_with_format(0, 1, "", 1),
            make_cell_with_format(0, 2, "", 1),
        ]);
        data.format_palette.push(blank_fill);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        let overflow_bounds = find_text_horizontal_bounds(&canvas, 0, 20, 66, 192, 120);
        assert!(
            overflow_bounds.is_some(),
            "long text should render into adjacent empty cells"
        );
        let (_left, right) = overflow_bounds.unwrap();
        assert!(
            right > 90,
            "expected overflow text well past A1 boundary, right={right}"
        );

        let bounds = find_text_horizontal_bounds(&canvas, 0, 20, 0, 64, 200);
        assert!(bounds.is_some(), "text should be rendered inside cell");
    }

    #[test]
    fn text_overflow_stops_at_non_empty_adjacent_cell() {
        let db = shared_font_db();
        let blocker_format = CellFormat {
            font_color: Some("#FFFFFF".to_string()),
            ..Default::default()
        };
        let mut data = make_viewport_data(vec![
            make_cell(0, 0, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
            make_cell_with_format(0, 1, "occupied", 1),
        ]);
        data.format_palette.push(blocker_format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 66, 128, 120).is_none(),
            "source text must not overflow into a non-empty adjacent cell"
        );
    }

    #[test]
    fn right_aligned_text_overflows_left_into_empty_adjacent_cells() {
        let db = shared_font_db();
        let format = CellFormat {
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Right),
            ..Default::default()
        };
        let mut data = make_viewport_data(vec![
            make_cell(0, 0, ""),
            make_cell(0, 1, ""),
            make_cell_with_format(0, 2, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 1),
        ]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 64, 126, 120).is_some(),
            "right-aligned long text should render left into adjacent empty cells"
        );
    }

    #[test]
    fn centered_text_overflows_both_directions_into_empty_adjacent_cells() {
        let db = shared_font_db();
        let format = CellFormat {
            horizontal_align: Some(ooxml_types::styles::HorizontalAlign::Center),
            ..Default::default()
        };
        let mut data = make_viewport_data(vec![
            make_cell(0, 0, ""),
            make_cell_with_format(0, 1, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 1),
            make_cell(0, 2, ""),
            make_cell(0, 3, ""),
        ]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 8, 64, 120).is_some(),
            "centered long text should render left into adjacent empty cells"
        );
        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 128, 192, 120).is_some(),
            "centered long text should render right into adjacent empty cells"
        );
    }

    #[test]
    fn wrapped_text_does_not_overflow_into_adjacent_cells() {
        let db = shared_font_db();
        let format = CellFormat {
            wrap_text: Some(true),
            ..Default::default()
        };
        let mut data = make_viewport_data(vec![
            make_cell_with_format(0, 0, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 1),
            make_cell(0, 1, ""),
        ]);
        data.format_palette.push(format);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 66, 128, 120).is_none(),
            "wrapped text must stay clipped to its source cell"
        );
    }

    #[test]
    fn text_in_merge_does_not_overflow_past_merge_bounds() {
        let db = shared_font_db();
        let mut data = make_viewport_data(vec![
            make_cell(0, 0, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
            make_cell(0, 1, ""),
        ]);
        data.merges.push(RenderViewportMerge {
            start_row: 0,
            start_col: 0,
            end_row: 0,
            end_col: 0,
        });
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        render_cells(
            &mut canvas,
            &data,
            &data.row_positions,
            &data.col_positions,
            0.0,
            0.0,
            db,
        );

        assert!(
            find_text_horizontal_bounds(&canvas, 0, 20, 66, 128, 120).is_none(),
            "merged cells use merge rendering and must not also overflow as plain cells"
        );
    }

    #[test]
    fn hidden_cell_skipped() {
        let db = shared_font_db();
        let data = make_viewport_data(vec![make_cell(0, 0, "Hidden")]);
        let mut canvas = SheetCanvas::new(320, 100, 1.0);
        // Use zero-height row to simulate hidden
        let rows = vec![0.0, 0.0, 40.0, 60.0, 80.0, 100.0];
        render_cells(&mut canvas, &data, &rows, &data.col_positions, 0.0, 0.0, db);
        // Cell at row 0 has zero height → no text rendered
        // The first row area should remain entirely white
        assert_rect_white(&canvas, 0, 0, 64, 1, "hidden cell row should be white");
    }
}
