use compute_text_measurement::{FontDb, measure_line_height, measure_text_width};

#[test]
fn line_height_matches_font_metrics_formula() {
    let db = FontDb::with_defaults();
    for family in &["Carlito", "Liberation Sans", "Liberation Mono", "Caladea"] {
        let (_, entry) = db.resolve(family).unwrap();
        let face = entry.face().unwrap();

        let upem = face.units_per_em() as f32;
        let ascender = face.ascender() as f32;
        let descender = face.descender() as f32;
        let line_gap = face.line_gap() as f32;

        for &size in &[8.0, 11.0, 14.0, 24.0, 72.0] {
            let expected = (ascender - descender + line_gap) * size / upem;
            let actual = measure_line_height(&face, size);
            assert!(
                (actual - expected).abs() < 0.001,
                "{family} at {size}px: expected {expected}, got {actual}"
            );
        }
    }
}

#[test]
fn line_height_scales_linearly_with_font_size() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve("Carlito").unwrap();
    let face = entry.face().unwrap();

    let h10 = measure_line_height(&face, 10.0);
    let h20 = measure_line_height(&face, 20.0);
    let h30 = measure_line_height(&face, 30.0);

    assert!((h20 / h10 - 2.0).abs() < 0.001, "20/10 should be 2.0");
    assert!((h30 / h10 - 3.0).abs() < 0.001, "30/10 should be 3.0");
}

#[test]
fn line_height_exceeds_font_size() {
    let db = FontDb::with_defaults();
    for family in &["Carlito", "Liberation Sans", "Caladea", "Liberation Serif"] {
        let (_, entry) = db.resolve(family).unwrap();
        let face = entry.face().unwrap();
        let h = measure_line_height(&face, 16.0);
        assert!(
            h > 16.0,
            "{family}: line height {h} should exceed font size 16.0"
        );
    }
}

#[test]
fn line_height_zero_font_size_is_zero() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve("Carlito").unwrap();
    let face = entry.face().unwrap();
    assert_eq!(measure_line_height(&face, 0.0), 0.0);
}

#[test]
fn text_width_empty_string_is_zero() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve("Carlito").unwrap();
    let face = entry.face().unwrap();
    assert_eq!(measure_text_width(&face, 11.0, ""), 0.0);
}

#[test]
fn text_width_scales_linearly_with_font_size() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve("Carlito").unwrap();
    let face = entry.face().unwrap();

    let w10 = measure_text_width(&face, 10.0, "Test string");
    let w20 = measure_text_width(&face, 20.0, "Test string");
    let w50 = measure_text_width(&face, 50.0, "Test string");

    assert!(
        (w20 / w10 - 2.0).abs() < 0.001,
        "Width should double: {w20} / {w10}"
    );
    assert!(
        (w50 / w10 - 5.0).abs() < 0.001,
        "Width should 5x: {w50} / {w10}"
    );
}

#[test]
fn monospace_font_uniform_character_width() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve("Liberation Mono").unwrap();
    let face = entry.face().unwrap();
    let size = 16.0;

    let w_a = measure_text_width(&face, size, "A");
    let w_z = measure_text_width(&face, size, "Z");
    let w_0 = measure_text_width(&face, size, "0");
    let w_space = measure_text_width(&face, size, " ");

    assert!(
        (w_a - w_z).abs() < 0.01,
        "Mono: A ({w_a}) and Z ({w_z}) should match"
    );
    assert!(
        (w_a - w_0).abs() < 0.01,
        "Mono: A ({w_a}) and 0 ({w_0}) should match"
    );
    assert!(
        (w_a - w_space).abs() < 0.01,
        "Mono: A ({w_a}) and space ({w_space}) should match"
    );

    let w_5 = measure_text_width(&face, size, "AAAAA");
    assert!(
        (w_5 - 5.0 * w_a).abs() < 0.01,
        "Mono: 5 chars ({w_5}) should be 5 * single ({}) ",
        5.0 * w_a
    );
}

#[test]
fn proportional_font_different_character_widths() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve("Carlito").unwrap();
    let face = entry.face().unwrap();

    let w_w = measure_text_width(&face, 16.0, "W");
    let w_i = measure_text_width(&face, 16.0, "i");
    assert!(
        w_w > w_i * 1.5,
        "Proportional: W ({w_w}) should be much wider than i ({w_i})"
    );
}

#[test]
fn text_width_positive_for_nonempty() {
    let db = FontDb::with_defaults();
    let (_, entry) = db.resolve("Carlito").unwrap();
    let face = entry.face().unwrap();
    assert!(measure_text_width(&face, 11.0, "x") > 0.0);
    assert!(measure_text_width(&face, 11.0, " ") > 0.0);
}

#[test]
fn bold_text_wider_than_regular() {
    let db = FontDb::with_defaults();
    let (_, regular) = db.resolve_styled("Carlito", false, false).unwrap();
    let (_, bold) = db.resolve_styled("Carlito", true, false).unwrap();
    let regular_face = regular.face().unwrap();
    let bold_face = bold.face().unwrap();
    let rw = measure_text_width(&regular_face, 11.0, "Hello World");
    let bw = measure_text_width(&bold_face, 11.0, "Hello World");
    assert!(bw > rw, "Bold ({bw}) should be wider than regular ({rw})");
}
