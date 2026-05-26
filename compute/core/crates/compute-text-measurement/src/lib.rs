pub mod cache;
pub mod cell_measure;
pub mod error;
pub mod font_db;
pub mod shaper;
pub(crate) mod wrap;

pub use cache::MeasurementCache;
pub use cell_measure::{measure_cell_height, measure_cell_width, measure_rotated_cell};
pub use error::*;
pub use font_db::FontDb;
pub use shaper::{measure_line_height, measure_text_width};

#[cfg(test)]
mod tests {
    use super::*;

    // =======================================================================
    // measure_line_height — verify against raw font metrics formula
    // =======================================================================

    #[test]
    fn line_height_matches_font_metrics_formula() {
        // First principle: line_height = (ascender - descender + line_gap) * font_size / upem
        // We read the raw metrics from the Face and verify the function reproduces them.
        let db = FontDb::with_defaults();
        for family in &["Carlito", "Liberation Sans", "Liberation Mono", "Caladea"] {
            let (_, entry) = db.resolve(family).unwrap();
            let face = entry.face().unwrap();

            let upem = face.units_per_em() as f32;
            let ascender = face.ascender() as f32;
            let descender = face.descender() as f32; // negative
            let line_gap = face.line_gap() as f32;

            for &size in &[8.0, 11.0, 14.0, 24.0, 72.0] {
                let expected = (ascender - descender + line_gap) * size / upem;
                let actual = shaper::measure_line_height(&face, size);
                assert!(
                    (actual - expected).abs() < 0.001,
                    "{family} at {size}px: expected {expected}, got {actual}"
                );
            }
        }
    }

    #[test]
    fn line_height_scales_linearly_with_font_size() {
        // First principle: line_height(k * s) = k * line_height(s)
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();

        let h10 = shaper::measure_line_height(&face, 10.0);
        let h20 = shaper::measure_line_height(&face, 20.0);
        let h30 = shaper::measure_line_height(&face, 30.0);

        assert!((h20 / h10 - 2.0).abs() < 0.001, "20/10 should be 2.0");
        assert!((h30 / h10 - 3.0).abs() < 0.001, "30/10 should be 3.0");
    }

    #[test]
    fn line_height_exceeds_font_size() {
        // First principle: for any reasonable font, ascender + |descender| > upem,
        // so line_height > font_size.
        let db = FontDb::with_defaults();
        for family in &["Carlito", "Liberation Sans", "Caladea", "Liberation Serif"] {
            let (_, entry) = db.resolve(family).unwrap();
            let face = entry.face().unwrap();
            let h = shaper::measure_line_height(&face, 16.0);
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
        assert_eq!(shaper::measure_line_height(&face, 0.0), 0.0);
    }

    // =======================================================================
    // measure_text_width — linearity, monospace invariant, empty string
    // =======================================================================

    #[test]
    fn text_width_empty_string_is_zero() {
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        assert_eq!(measure_text_width(&face, 11.0, ""), 0.0);
    }

    #[test]
    fn text_width_scales_linearly_with_font_size() {
        // First principle: width(text, k*s) = k * width(text, s)
        // because the formula is sum(x_advance) * font_size / upem
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
        // First principle: in a monospace font, every glyph has the same advance.
        // So width("AAA") = 3 * width("A"), and width("A") = width("Z") = width("0").
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Liberation Mono").unwrap();
        let face = entry.face().unwrap();
        let size = 16.0;

        let w_a = measure_text_width(&face, size, "A");
        let w_z = measure_text_width(&face, size, "Z");
        let w_0 = measure_text_width(&face, size, "0");
        let w_space = measure_text_width(&face, size, " ");

        // All single ASCII characters should have the same width in monospace
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

        // N characters should have exactly N * single width
        let w_5 = measure_text_width(&face, size, "AAAAA");
        assert!(
            (w_5 - 5.0 * w_a).abs() < 0.01,
            "Mono: 5 chars ({w_5}) should be 5 * single ({}) ",
            5.0 * w_a
        );
    }

    #[test]
    fn proportional_font_different_character_widths() {
        // First principle: in a proportional font, 'W' is wider than 'i'.
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

    // =======================================================================
    // measure_cell_width — padding arithmetic, indent, multiline
    // =======================================================================

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
        // First principle: cell_width = text_width(px) + 2*CELL_PADDING + AUTOFIT_PADDING
        // where text is measured at font_size_pt * 4/3 (pt to px conversion)
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
        // First principle: each indent level adds INDENT_WIDTH pixels
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
        // First principle: for text with \n, width = max(line widths) + padding
        let db = FontDb::with_defaults();
        let narrow = "i";
        let wide = "WWWWWWWW";
        let multiline = format!("{narrow}\n{wide}");

        let w_multi = measure_cell_width(&db, "Carlito", 11.0, false, false, 0, &multiline);
        let w_wide = measure_cell_width(&db, "Carlito", 11.0, false, false, 0, wide);

        // Multiline width should match the wider line's width
        assert!(
            (w_multi - w_wide).abs() < 0.01,
            "Multiline ({w_multi}) should equal widest line ({w_wide})"
        );
    }

    // =======================================================================
    // measure_cell_height — padding, newlines, wrapping
    // =======================================================================

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
        // First principle: height = 1 * line_height(px) + 2 * CELL_PADDING
        // where line_height is computed at font_size_pt * 4/3
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
        let face = entry.face().unwrap();

        let font_size_pt = 11.0;
        let font_size_px = font_size_pt * 4.0 / 3.0;
        let line_h = shaper::measure_line_height(&face, font_size_px);
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
        // First principle: N newlines in text → (N+1) lines
        // height = (N+1) * line_height + 2 * CELL_PADDING
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
        let face = entry.face().unwrap();

        let font_size_px = 11.0 * 4.0 / 3.0;
        let line_h = shaper::measure_line_height(&face, font_size_px);
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
        // First principle: if text is wider than available_width, wrapping produces
        // more lines → taller cell. Use a very narrow width to force wrapping.
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
        // First principle: narrower width → more wrapped lines → taller
        let db = FontDb::with_defaults();
        let text = "Hello World foo bar baz";

        let h_wide = measure_cell_height(&db, "Carlito", 11.0, false, false, true, text, 500.0);
        let h_narrow = measure_cell_height(&db, "Carlito", 11.0, false, false, true, text, 50.0);

        assert!(
            h_narrow > h_wide,
            "Narrow ({h_narrow}) should be taller than wide ({h_wide})"
        );
    }

    // =======================================================================
    // measure_rotated_cell — identity at 0°, trig at 90°/45°, vertical at 255
    // =======================================================================

    #[test]
    fn rotated_cell_zero_degrees_matches_standard() {
        // First principle: rotation=0 should produce identical results to
        // calling measure_cell_width + measure_cell_height separately.
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
        // First principle: at 90° rotation, cos(90°)=0, sin(90°)=1.
        // rotated_w = text_w * 0 + line_h * 1 + 2*padding + autofit
        //           = line_h + 2*padding + autofit
        // rotated_h = text_w * 1 + line_h * 0 + 2*padding
        //           = text_w + 2*padding
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
        let face = entry.face().unwrap();

        let font_size_px = 11.0 * 4.0 / 3.0;
        let text_w = measure_text_width(&face, font_size_px, "Hello");
        let line_h = shaper::measure_line_height(&face, font_size_px);
        let pad2 = cell_measure::CELL_PADDING * 2.0;

        let expected_w = line_h + pad2 + cell_measure::AUTOFIT_PADDING;
        let expected_h = text_w + pad2;

        let (rw, rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, "Hello", 90);

        assert!(
            (rw - expected_w).abs() < 0.1,
            "90° width: {rw} vs expected {expected_w}"
        );
        assert!(
            (rh - expected_h).abs() < 0.1,
            "90° height: {rh} vs expected {expected_h}"
        );
    }

    #[test]
    fn rotated_cell_45_degrees_symmetric() {
        // First principle: at 45°, sin = cos = √2/2.
        // rotated_w = (text_w + line_h) * √2/2 + 2*padding + autofit
        // rotated_h = (text_w + line_h) * √2/2 + 2*padding
        // Therefore: rotated_w - rotated_h = AUTOFIT_PADDING
        let db = FontDb::with_defaults();
        let (rw, rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, "Hello", 45);

        let diff = rw - rh;
        assert!(
            (diff - cell_measure::AUTOFIT_PADDING).abs() < 0.1,
            "At 45°, width-height diff ({diff}) should equal AUTOFIT_PADDING ({})",
            cell_measure::AUTOFIT_PADDING
        );
    }

    #[test]
    fn rotated_cell_255_vertical_stacking() {
        // First principle: rotation=255 is Excel's "vertical stacked text".
        // width = font_size_px + 2*CELL_PADDING
        // height = char_count * line_height + 2*CELL_PADDING
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve_styled("Carlito", false, false).unwrap();
        let face = entry.face().unwrap();

        let text = "Hello"; // 5 characters
        let font_size_px = 11.0 * 4.0 / 3.0;
        let line_h = shaper::measure_line_height(&face, font_size_px);
        let pad2 = cell_measure::CELL_PADDING * 2.0;

        let expected_w = font_size_px + pad2;
        let expected_h = 5.0 * line_h + pad2;

        let (rw, rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 255);

        assert!(
            (rw - expected_w).abs() < 0.1,
            "255° width: {rw} vs expected {expected_w}"
        );
        assert!(
            (rh - expected_h).abs() < 0.1,
            "255° height: {rh} vs expected {expected_h}"
        );
    }

    #[test]
    fn rotated_cell_empty_text_zero_rotation() {
        // Empty text at any rotation should behave like standard empty measurement
        let db = FontDb::with_defaults();
        let (rw, _rh) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, "", 90);
        // Empty text + rotation=0 path (the function treats empty as rotation=0)
        assert_eq!(rw, 0.0, "Empty text width should be 0");
    }

    #[test]
    fn rotated_cell_complementary_angles_swap() {
        // First principle: rotating by angle θ then by (90-θ) should swap
        // the text_width and line_height contributions.
        // At θ: w_component = text_w * cos(θ) + line_h * sin(θ)
        // At 90-θ: w_component = text_w * sin(θ) + line_h * cos(θ) = h_component at θ
        let db = FontDb::with_defaults();
        let text = "Test";
        let (w30, h30) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 30);
        let (w60, h60) = measure_rotated_cell(&db, "Carlito", 11.0, false, false, text, 60);

        // w30 - autofit_padding ≈ h60 (both have 2*padding, only w has autofit)
        // h30 ≈ w60 - autofit_padding
        let autofit = cell_measure::AUTOFIT_PADDING;
        assert!(
            ((w30 - autofit) - h60).abs() < 0.5,
            "w(30)-autofit={} should ≈ h(60)={h60}",
            w30 - autofit
        );
        assert!(
            (h30 - (w60 - autofit)).abs() < 0.5,
            "h(30)={h30} should ≈ w(60)-autofit={}",
            w60 - autofit
        );
    }

    // =======================================================================
    // wrap_text — line counting from first principles
    // =======================================================================

    #[test]
    fn wrap_empty_text_returns_one_line() {
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        assert_eq!(wrap::wrap_text(&face, 16.0, "", 100.0), 1);
    }

    #[test]
    fn wrap_zero_width_returns_one_line() {
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        assert_eq!(wrap::wrap_text(&face, 16.0, "Hello", 0.0), 1);
        assert_eq!(wrap::wrap_text(&face, 16.0, "Hello", -10.0), 1);
    }

    #[test]
    fn wrap_short_text_fits_in_one_line() {
        // If text width < max_width, should be 1 line
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();
        let w = measure_text_width(&face, 16.0, "Hi");
        assert_eq!(wrap::wrap_text(&face, 16.0, "Hi", w + 50.0), 1);
    }

    #[test]
    fn wrap_explicit_newlines_produce_lines() {
        // First principle: N newlines → at least N+1 lines
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();

        assert_eq!(
            wrap::wrap_text(&face, 16.0, "A\nB", 1000.0),
            2,
            "One newline → 2 lines"
        );
        assert_eq!(
            wrap::wrap_text(&face, 16.0, "A\nB\nC", 1000.0),
            3,
            "Two newlines → 3 lines"
        );
        assert_eq!(
            wrap::wrap_text(&face, 16.0, "\n", 1000.0),
            2,
            "Single newline → 2 lines (empty paragraph + empty paragraph)"
        );
    }

    #[test]
    fn wrap_two_words_forced_to_two_lines() {
        // Use monospace font so we can predict exact widths.
        // If each word is W px wide and max_width < 2W (but >= W), we get 2 lines.
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Liberation Mono").unwrap();
        let face = entry.face().unwrap();

        let word_w = measure_text_width(&face, 16.0, "AAAA");
        let space_w = measure_text_width(&face, 16.0, " ");
        let total = word_w * 2.0 + space_w;

        // Width that fits one word + space but not two words
        let max_width = word_w + space_w + 1.0;
        assert!(
            max_width < total,
            "Sanity: max_width {max_width} < total {total}"
        );

        let lines = wrap::wrap_text(&face, 16.0, "AAAA AAAA", max_width);
        assert_eq!(lines, 2, "Two words exceeding width should wrap to 2 lines");
    }

    // =======================================================================
    // MeasurementCache — eviction, keying, Default
    // =======================================================================

    #[test]
    fn cache_miss_returns_none() {
        let cache = MeasurementCache::new();
        assert_eq!(cache.get(0, 11.0, "anything"), None);
    }

    #[test]
    fn cache_hit_returns_stored_value() {
        let mut cache = MeasurementCache::new();
        cache.put(0, 11.0, "Hello", 42.5);
        assert_eq!(cache.get(0, 11.0, "Hello"), Some(42.5));
    }

    #[test]
    fn cache_distinguishes_font_id_and_size() {
        let mut cache = MeasurementCache::new();
        cache.put(0, 11.0, "Hello", 42.5);
        assert_eq!(cache.get(1, 11.0, "Hello"), None, "different font_id");
        assert_eq!(cache.get(0, 12.0, "Hello"), None, "different font_size");
        assert_eq!(cache.get(0, 11.0, "World"), None, "different text");
    }

    #[test]
    fn cache_eviction_at_capacity() {
        // First principle: at MAX_CACHE_SIZE (10,000), inserting one more
        // should trigger eviction (clear). The new entry should be retrievable
        // but old entries should be gone.
        let mut cache = MeasurementCache::new();
        for i in 0..10_000u16 {
            cache.put(i, 11.0, "x", i as f32);
        }
        // Should still work — at capacity but not over
        assert_eq!(cache.get(0, 11.0, "x"), Some(0.0), "entry 0 before evict");

        // This insertion triggers the clear
        cache.put(0, 99.0, "trigger", 999.0);
        assert_eq!(
            cache.get(0, 99.0, "trigger"),
            Some(999.0),
            "new entry exists"
        );
        // Old entries were cleared
        assert_eq!(cache.get(0, 11.0, "x"), None, "old entry 0 was evicted");
    }

    #[test]
    fn cache_clear_removes_all() {
        let mut cache = MeasurementCache::new();
        cache.put(0, 11.0, "A", 1.0);
        cache.put(1, 12.0, "B", 2.0);
        cache.clear();
        assert_eq!(cache.get(0, 11.0, "A"), None);
        assert_eq!(cache.get(1, 12.0, "B"), None);
    }

    #[test]
    fn cache_default_is_empty() {
        let cache = MeasurementCache::default();
        assert_eq!(cache.get(0, 11.0, "anything"), None);
    }

    // =======================================================================
    // FontDb — fallbacks, styled resolution, CJK detection
    // =======================================================================

    #[test]
    fn all_default_fonts_load_successfully() {
        let db = FontDb::with_defaults();
        for family in &[
            "Carlito",
            "Caladea",
            "Liberation Sans",
            "Liberation Serif",
            "Liberation Mono",
        ] {
            let result = db.resolve(family);
            assert!(result.is_some(), "Font '{family}' should be loaded");
            let (_, entry) = result.unwrap();
            assert!(
                entry.face().is_some(),
                "Font '{family}' should parse to a valid Face"
            );
        }
    }

    #[test]
    fn font_fallback_chains_resolve() {
        let db = FontDb::with_defaults();
        // Each commercial font should fall back to its metric-compatible OSS equivalent
        let chains = [
            ("Calibri", "carlito"),
            ("Cambria", "caladea"),
            ("Arial", "liberation sans"),
            ("Helvetica", "liberation sans"),
            ("Times New Roman", "liberation serif"),
            ("Times", "liberation serif"),
            ("Courier New", "liberation mono"),
            ("Courier", "liberation mono"),
        ];
        for (commercial, oss) in chains {
            let (id_via_fallback, _) = db.resolve(commercial).unwrap();
            let (id_direct, _) = db.resolve(oss).unwrap();
            assert_eq!(
                id_via_fallback, id_direct,
                "{commercial} should resolve to same font_id as {oss}"
            );
        }
    }

    #[test]
    fn font_unknown_family_falls_back_to_carlito() {
        // First principle: unknown families default to Carlito (the Calibri substitute)
        let db = FontDb::with_defaults();
        let (id_unknown, _) = db.resolve("Totally Unknown Font").unwrap();
        let (id_carlito, _) = db.resolve("Carlito").unwrap();
        assert_eq!(
            id_unknown, id_carlito,
            "Unknown font should default to Carlito"
        );
    }

    #[test]
    fn resolve_styled_falls_through_to_base() {
        // If we request a style variant that doesn't exist for a fallback font,
        // resolve_styled should fall through to the unstyled base.
        let db = FontDb::with_defaults();
        // "Calibri bold" won't exist directly, but it should resolve through
        // the fallback chain to "carlito bold"
        let result = db.resolve_styled("Calibri", true, false);
        assert!(result.is_some(), "Calibri bold should resolve via fallback");
    }

    #[test]
    fn resolve_styled_returns_correct_variant() {
        // The styled and unstyled variants should be different font_ids
        let db = FontDb::with_defaults();
        let (id_regular, _) = db.resolve_styled("Carlito", false, false).unwrap();
        let (id_bold, _) = db.resolve_styled("Carlito", true, false).unwrap();
        let (id_italic, _) = db.resolve_styled("Carlito", false, true).unwrap();
        let (id_bi, _) = db.resolve_styled("Carlito", true, true).unwrap();

        // All four variants should be distinct
        let ids = [id_regular, id_bold, id_italic, id_bi];
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                assert_ne!(ids[i], ids[j], "Variant {i} and {j} should differ");
            }
        }
    }

    #[test]
    fn cjk_detection_covers_all_ranges() {
        // CJK Unified Ideographs
        assert!(FontDb::needs_cjk("你"));
        // CJK Extension A
        assert!(FontDb::needs_cjk("\u{3400}"));
        // Hiragana
        assert!(FontDb::needs_cjk("あ"));
        // Katakana
        assert!(FontDb::needs_cjk("ア"));
        // Hangul
        assert!(FontDb::needs_cjk("한"));
        // Fullwidth Latin
        assert!(FontDb::needs_cjk("\u{FF21}")); // Ａ (fullwidth A)
        // CJK Symbols
        assert!(FontDb::needs_cjk("\u{3001}")); // 、(ideographic comma)

        // Non-CJK
        assert!(!FontDb::needs_cjk("Hello"));
        assert!(!FontDb::needs_cjk("123"));
        assert!(!FontDb::needs_cjk("αβγ")); // Greek
        assert!(!FontDb::needs_cjk(""));
    }

    #[test]
    fn load_defaults_idempotent() {
        let mut db = FontDb::new();
        db.load_defaults();
        let (id1, _) = db.resolve("Carlito").unwrap();
        db.load_defaults(); // second call should be no-op
        let (id2, _) = db.resolve("Carlito").unwrap();
        assert_eq!(id1, id2, "load_defaults should be idempotent");
    }

    #[test]
    fn font_db_default_has_no_fonts() {
        let db = FontDb::default(); // default() calls new(), not with_defaults()
        // Unknown font can't resolve because there's no Carlito to fall back to
        // Actually, resolve() tries Carlito as default, which won't exist
        // So it should return None
        assert!(
            db.resolve("Anything").is_none(),
            "Empty FontDb should resolve nothing"
        );
    }

    #[test]
    fn case_insensitive_resolution() {
        let db = FontDb::with_defaults();
        let (id_lower, _) = db.resolve("carlito").unwrap();
        let (id_upper, _) = db.resolve("CARLITO").unwrap();
        let (id_mixed, _) = db.resolve("Carlito").unwrap();
        assert_eq!(id_lower, id_upper);
        assert_eq!(id_lower, id_mixed);
    }

    // =======================================================================
    // wrap_text — force-break, CJK breaking, mixed newlines+wrap
    // =======================================================================

    #[test]
    fn wrap_force_break_unbreakable_token() {
        // First principle: a single token with no whitespace or CJK that exceeds
        // max_width should still count as 1 line — the algorithm cannot break
        // inside a Latin word. But two such tokens separated by a space should
        // produce 2 lines even if each individually overflows.
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Liberation Mono").unwrap();
        let face = entry.face().unwrap();

        let char_w = measure_text_width(&face, 16.0, "A");
        // A 10-char word at ~char_w each, in a column that fits 5 chars
        let max_width = char_w * 5.0;

        // Single long word: no break possible → 1 line (overflows)
        assert_eq!(
            wrap::wrap_text(&face, 16.0, "AAAAAAAAAA", max_width),
            1,
            "Unbreakable word should be 1 line"
        );

        // Two long words separated by space: force-break at the space → 2 lines
        assert_eq!(
            wrap::wrap_text(&face, 16.0, "AAAAAAAAAA AAAAAAAAAA", max_width),
            2,
            "Two overflowing words should force-break to 2 lines"
        );
    }

    #[test]
    fn wrap_cjk_characters_break_individually() {
        // First principle: each CJK character is an individual break opportunity.
        // So N CJK characters in a column that fits only 1 character should
        // produce N lines (each char on its own line).
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();

        // Measure a single CJK char (the font may use a fallback glyph, but
        // the break logic depends on Unicode properties, not glyph availability)
        let cjk_w = measure_text_width(&face, 16.0, "你");
        // Allow exactly 1 CJK character per line
        let max_width = cjk_w * 1.5;

        // 3 CJK chars should wrap to 3 lines
        let lines = wrap::wrap_text(&face, 16.0, "你好世", max_width);
        assert_eq!(lines, 3, "3 CJK chars in narrow column should be 3 lines");
    }

    #[test]
    fn wrap_mixed_latin_and_cjk() {
        // First principle: CJK chars are break points but Latin words are not.
        // "Hi你好" should have breaks around the CJK chars but not within "Hi".
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Carlito").unwrap();
        let face = entry.face().unwrap();

        // Wide enough for "Hi" + one CJK char but not "Hi" + two CJK chars
        let hi_w = measure_text_width(&face, 16.0, "Hi");
        let cjk_w = measure_text_width(&face, 16.0, "你");
        let max_width = hi_w + cjk_w * 1.5;

        // "Hi你好" should break between the two CJK chars → 2 lines
        let lines = wrap::wrap_text(&face, 16.0, "Hi你好", max_width);
        assert_eq!(lines, 2, "Should break between CJK chars: 'Hi你' + '好'");
    }

    #[test]
    fn wrap_newlines_and_wrapping_combined() {
        // First principle: explicit newlines split into paragraphs, then each
        // paragraph is independently wrapped. So "long text\nlong text" with
        // narrow width should produce (wraps_per_paragraph) * 2 total lines.
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Liberation Mono").unwrap();
        let face = entry.face().unwrap();

        let char_w = measure_text_width(&face, 16.0, "A");
        // Fits ~6 chars per line
        let max_width = char_w * 6.5;

        // "AAA AAA\nBBB BBB" — each paragraph is 7 chars with a space at pos 3.
        // Each paragraph: "AAA " fits, "AAA" remaining → 2 lines per paragraph
        // Total: 4 lines
        let lines = wrap::wrap_text(&face, 16.0, "AAA AAA\nBBB BBB", max_width);
        assert_eq!(lines, 4, "2 paragraphs each wrapping to 2 lines = 4 total");
    }

    #[test]
    fn wrap_multiple_words_counts_lines_correctly() {
        // First principle: use monospace to predict exact widths.
        // 4 words of 4 chars each, fitting 2 words per line → 2 lines.
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve("Liberation Mono").unwrap();
        let face = entry.face().unwrap();

        let char_w = measure_text_width(&face, 16.0, "A");
        // Fits "AAAA AAAA " (10 chars) but not "AAAA AAAA AAAA" (14 chars)
        let max_width = char_w * 10.5;

        let lines = wrap::wrap_text(&face, 16.0, "AAAA AAAA AAAA AAAA", max_width);
        assert_eq!(lines, 2, "4 words fitting 2-per-line should be 2 lines");
    }

    // =======================================================================
    // Graceful degradation — missing font behavior
    // =======================================================================

    #[test]
    fn cell_width_missing_font_returns_zero() {
        // First principle: if the font can't be resolved, there's no way to
        // measure text. Width should be 0 (no content to show).
        let db = FontDb::default(); // empty — no fonts loaded
        assert_eq!(
            measure_cell_width(&db, "Nonexistent", 11.0, false, false, 0, "Hello"),
            0.0
        );
    }

    #[test]
    fn cell_height_missing_font_returns_fallback() {
        // First principle: height must not be 0 for non-empty text, even without
        // a font — otherwise rows collapse to zero height. The fallback is
        // font_size_px * DEFAULT_LINE_HEIGHT_FACTOR.
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
    fn rotated_cell_missing_font_returns_zero() {
        let db = FontDb::default();
        let (w, h) = measure_rotated_cell(&db, "Nonexistent", 11.0, false, false, "Hello", 90);
        assert_eq!(
            (w, h),
            (0.0, 0.0),
            "Missing font in rotation should return (0,0)"
        );
    }

    // =======================================================================
    // Rotation > 90° — Excel clockwise rotation
    // =======================================================================

    #[test]
    fn rotated_cell_clockwise_rotation_over_90() {
        // First principle: Excel rotation 91-180 maps to -(rotation - 90) degrees.
        // At rotation=135, degrees = -(135-90) = -45°.
        // cos(-45°) = cos(45°) = √2/2, sin(-45°) = -sin(45°), but we take abs.
        // So rotation=135 should produce the same dimensions as rotation=45.
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
        // First principle: rotation=180 → degrees = -(180-90) = -90°.
        // cos(-90°) = 0, sin(-90°) = -1, abs → cos=0, sin=1.
        // This should match rotation=90.
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

    // =======================================================================
    // FontDb — load_cjk
    // =======================================================================

    #[test]
    fn load_cjk_registers_font() {
        // First principle: load_cjk should register under "noto sans cjk sc"
        // so that CJK text resolution can find it. We use the Carlito font
        // bytes as a stand-in (it won't have CJK glyphs, but the registration
        // and resolution logic is what we're testing).
        let mut db = FontDb::with_defaults();
        assert!(
            db.resolve("noto sans cjk sc").is_none()
                || db.resolve("noto sans cjk sc").unwrap().0 == db.resolve("carlito").unwrap().0,
            "Before load_cjk, 'noto sans cjk sc' should not be directly registered"
        );

        // Load CJK font (using Carlito bytes as stand-in)
        let carlito_bytes = include_bytes!("../../../fonts/Carlito-Regular.ttf").to_vec();
        db.load_cjk(carlito_bytes);

        let result = db.resolve("noto sans cjk sc");
        assert!(
            result.is_some(),
            "After load_cjk, 'noto sans cjk sc' should resolve"
        );
        let (_, entry) = result.unwrap();
        assert!(
            entry.face().is_some(),
            "CJK font entry should parse to a Face"
        );
    }
}
