use compute_text_measurement::{
    FontDb, cell_measure, measure_cell_height, measure_cell_width, measure_line_height,
    measure_rotated_cell, measure_text_width,
};

#[test]
fn cell_width_empty_text_is_zero() {
    let db = FontDb::with_defaults();
    assert_eq!(
        measure_cell_width(&db, "Carlito", 11.0, false, false, 0, ""),
        0.0
    );
}

#[test]
fn cell_width_equals_raw_width_plus_padding() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
    let face = entry.face().unwrap();

    let font_size_pt = 11.0;
    let font_size_px = font_size_pt * 4.0 / 3.0;
    let raw_width = measure_text_width(&face, font_size_px, "Hello");
    let expected = raw_width + cell_measure::CELL_PADDING * 2.0 + cell_measure::AUTOFIT_PADDING;

    let actual = measure_cell_width(&db, "Carlito", font_size_pt, false, false, 0, "Hello");
    assert!(
        (actual - expected).abs() < 0.01,
        "Cell width {actual} should equal raw+padding {expected}"
    );
}

#[test]
fn cell_width_indent_adds_indent_width_per_level() {
    let db = FontDb::with_defaults();
    let w0 = measure_cell_width(&db, "Carlito", 11.0, false, false, 0, "Hello");
    let w1 = measure_cell_width(&db, "Carlito", 11.0, false, false, 1, "Hello");
    let w3 = measure_cell_width(&db, "Carlito", 11.0, false, false, 3, "Hello");

    let indent = cell_measure::INDENT_WIDTH;
    assert!(
        (w1 - w0 - indent).abs() < 0.01,
        "1 indent should add {indent}: got {} difference",
        w1 - w0
    );
    assert!(
        (w3 - w0 - 3.0 * indent).abs() < 0.01,
        "3 indents should add {}: got {} difference",
        3.0 * indent,
        w3 - w0
    );
}

#[test]
fn cell_width_multiline_uses_widest_line() {
    let db = FontDb::with_defaults();
    let narrow = "i";
    let wide = "WWWWWWWW";
    let multiline = format!("{narrow}\n{wide}");

    let w_multi = measure_cell_width(&db, "Carlito", 11.0, false, false, 0, &multiline);
    let w_wide = measure_cell_width(&db, "Carlito", 11.0, false, false, 0, wide);

    assert!(
        (w_multi - w_wide).abs() < 0.01,
        "Multiline ({w_multi}) should equal widest line ({w_wide})"
    );
}

#[test]
fn cell_height_empty_text_is_zero() {
    let db = FontDb::with_defaults();
    assert_eq!(
        measure_cell_height(&db, "Carlito", 11.0, false, false, false, "", 100.0),
        0.0
    );
}

#[test]
fn cell_height_single_line_equals_line_height_plus_padding() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
    let face = entry.face().unwrap();

    let font_size_pt = 11.0;
    let font_size_px = font_size_pt * 4.0 / 3.0;
    let line_h = measure_line_height(&face, font_size_px);
    let expected = line_h + cell_measure::CELL_PADDING * 2.0;

    let actual = measure_cell_height(
        &db,
        "Carlito",
        font_size_pt,
        false,
        false,
        false,
        "Hello",
        500.0,
    );
    assert!(
        (actual - expected).abs() < 0.01,
        "Single-line height {actual} should be line_height+padding {expected}"
    );
}

#[test]
fn cell_height_explicit_newlines_multiply_line_height() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
    let face = entry.face().unwrap();

    let font_size_px = 11.0 * 4.0 / 3.0;
    let line_h = measure_line_height(&face, font_size_px);
    let padding = cell_measure::CELL_PADDING * 2.0;

    let h1 = measure_cell_height(&db, "Carlito", 11.0, false, false, false, "A", 500.0);
    let h2 = measure_cell_height(&db, "Carlito", 11.0, false, false, false, "A\nB", 500.0);
    let h3 = measure_cell_height(&db, "Carlito", 11.0, false, false, false, "A\nB\nC", 500.0);

    assert!(
        (h1 - (1.0 * line_h + padding)).abs() < 0.01,
        "1 line: {h1} vs {}",
        1.0 * line_h + padding
    );
    assert!(
        (h2 - (2.0 * line_h + padding)).abs() < 0.01,
        "2 lines: {h2} vs {}",
        2.0 * line_h + padding
    );
    assert!(
        (h3 - (3.0 * line_h + padding)).abs() < 0.01,
        "3 lines: {h3} vs {}",
        3.0 * line_h + padding
    );
}

#[test]
fn cell_height_with_wrap_exceeds_without_wrap() {
    let db = FontDb::with_defaults();
    let text = "Hello World this is a long sentence that should wrap";

    let h_nowrap = measure_cell_height(&db, "Carlito", 11.0, false, false, false, text, 100.0);
    let h_wrap = measure_cell_height(&db, "Carlito", 11.0, false, false, true, text, 100.0);

    assert!(
        h_wrap > h_nowrap,
        "Wrapped ({h_wrap}) should be taller than unwrapped ({h_nowrap})"
    );
}

#[test]
fn cell_height_wrap_narrow_width_produces_more_lines() {
    let db = FontDb::with_defaults();
    let text = "Hello World foo bar baz";

    let h_wide = measure_cell_height(&db, "Carlito", 11.0, false, false, true, text, 500.0);
    let h_narrow = measure_cell_height(&db, "Carlito", 11.0, false, false, true, text, 50.0);

    assert!(
        h_narrow > h_wide,
        "Narrow ({h_narrow}) should be taller than wide ({h_wide})"
    );
}

#[test]
fn cell_width_missing_font_returns_zero() {
    let db = FontDb::default();
    assert_eq!(
        measure_cell_width(&db, "Nonexistent", 11.0, false, false, 0, "Hello"),
        0.0
    );
}

#[test]
fn cell_height_missing_font_returns_fallback() {
    let db = FontDb::default();
    let font_size_pt = 11.0;
    let font_size_px = font_size_pt * 4.0 / 3.0;
    let expected = font_size_px * cell_measure::DEFAULT_LINE_HEIGHT_FACTOR;

    let h = measure_cell_height(
        &db,
        "Nonexistent",
        font_size_pt,
        false,
        false,
        false,
        "Hello",
        100.0,
    );
    assert!(
        (h - expected).abs() < 0.01,
        "Missing font height {h} should be fallback {expected}"
    );
}

#[test]
fn rotated_cell_zero_degrees_matches_standard() {
    let db = FontDb::with_defaults();
    let text = "Hello";
    let (rw, rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 0);
    let w = measure_cell_width(&db, "Carlito", 11.0, false, false, 0, text);
    let h = measure_cell_height(&db, "Carlito", 11.0, false, false, false, text, 0.0);

    assert!((rw - w).abs() < 0.01, "rot0 width {rw} != cell width {w}");
    assert!((rh - h).abs() < 0.01, "rot0 height {rh} != cell height {h}");
}

#[test]
fn rotated_cell_90_degrees_swaps_dimensions() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
    let face = entry.face().unwrap();

    let font_size_px = 11.0 * 4.0 / 3.0;
    let text_w = measure_text_width(&face, font_size_px, "Hello");
    let line_h = measure_line_height(&face, font_size_px);
    let pad2 = cell_measure::CELL_PADDING * 2.0;

    let expected_w = line_h + pad2 + cell_measure::AUTOFIT_PADDING;
    let expected_h = text_w + pad2;

    let (rw, rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, "Hello", 90);

    assert!(
        (rw - expected_w).abs() < 0.1,
        "90 degree width: {rw} vs expected {expected_w}"
    );
    assert!(
        (rh - expected_h).abs() < 0.1,
        "90 degree height: {rh} vs expected {expected_h}"
    );
}

#[test]
fn rotated_cell_45_degrees_symmetric() {
    let db = FontDb::with_defaults();
    let (rw, rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, "Hello", 45);

    let diff = rw - rh;
    assert!(
        (diff - cell_measure::AUTOFIT_PADDING).abs() < 0.1,
        "At 45 degrees, width-height diff ({diff}) should equal AUTOFIT_PADDING ({})",
        cell_measure::AUTOFIT_PADDING
    );
}

#[test]
fn rotated_cell_255_vertical_stacking() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
    let face = entry.face().unwrap();

    let text = "Hello";
    let font_size_px = 11.0 * 4.0 / 3.0;
    let line_h = measure_line_height(&face, font_size_px);
    let pad2 = cell_measure::CELL_PADDING * 2.0;

    let expected_w = font_size_px + pad2;
    let expected_h = 5.0 * line_h + pad2;

    let (rw, rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 255);

    assert!(
        (rw - expected_w).abs() < 0.1,
        "255 width: {rw} vs expected {expected_w}"
    );
    assert!(
        (rh - expected_h).abs() < 0.1,
        "255 height: {rh} vs expected {expected_h}"
    );
}

#[test]
fn rotated_cell_empty_text_zero_rotation() {
    let db = FontDb::with_defaults();
    let (rw, _rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, "", 90);
    assert_eq!(rw, 0.0, "Empty text width should be 0");
}

#[test]
fn rotated_cell_complementary_angles_swap() {
    let db = FontDb::with_defaults();
    let text = "Test";
    let (w30, h30) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 30);
    let (w60, h60) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 60);

    let autofit = cell_measure::AUTOFIT_PADDING;
    assert!(
        ((w30 - autofit) - h60).abs() < 0.5,
        "w(30)-autofit={} should approximate h(60)={h60}",
        w30 - autofit
    );
    assert!(
        (h30 - (w60 - autofit)).abs() < 0.5,
        "h(30)={h30} should approximate w(60)-autofit={}",
        w60 - autofit
    );
}

#[test]
fn rotated_cell_missing_font_returns_zero() {
    let db = FontDb::default();
    let (w, h) = measure_rotated_cell(&db, "Nonexistent", 11.0, false, false, "Hello", 90);
    assert_eq!(
        (w, h),
        (0.0, 0.0),
        "Missing font in rotation should return (0,0)"
    );
}

#[test]
fn rotated_cell_clockwise_rotation_over_90() {
    let db = FontDb::with_defaults();
    let text = "Hello";
    let (w45, h45) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 45);
    let (w135, h135) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 135);

    assert!(
        (w45 - w135).abs() < 0.1,
        "rotation 45 width ({w45}) should match 135 width ({w135})"
    );
    assert!(
        (h45 - h135).abs() < 0.1,
        "rotation 45 height ({h45}) should match 135 height ({h135})"
    );
}

#[test]
fn rotated_cell_180_degrees_is_horizontal() {
    let db = FontDb::with_defaults();
    let text = "Hello";
    let (w90, h90) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 90);
    let (w180, h180) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 180);

    assert!(
        (w90 - w180).abs() < 0.1,
        "rotation 90 width ({w90}) should match 180 width ({w180})"
    );
    assert!(
        (h90 - h180).abs() < 0.1,
        "rotation 90 height ({h90}) should match 180 height ({h180})"
    );
}
