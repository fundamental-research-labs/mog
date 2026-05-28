use rustybuzz::Face;

use crate::font_db;
use crate::shaper::measure_text_width;

/// Wrap text at `max_width` pixels and return the number of resulting lines.
///
/// Break rules:
/// - Whitespace (space, tab, newline) is a break opportunity
/// - CJK characters are individual break opportunities
/// - No hyphenation
pub fn wrap_text(face: &Face<'_>, font_size: f32, text: &str, max_width: f32) -> usize {
    if text.is_empty() || max_width <= 0.0 {
        return 1;
    }

    let mut total_lines = 0;

    // First split on explicit newlines
    for paragraph in text.split('\n') {
        if paragraph.is_empty() {
            total_lines += 1;
            continue;
        }
        total_lines += wrap_paragraph(face, font_size, paragraph, max_width);
    }

    total_lines
}

/// Wrap a single paragraph (no embedded newlines) and return line count.
fn wrap_paragraph(face: &Face<'_>, font_size: f32, text: &str, max_width: f32) -> usize {
    // Collect break opportunities
    let breaks = find_break_opportunities(text);

    if breaks.is_empty() {
        // No break opportunities — single line (might overflow)
        return 1;
    }

    let mut lines = 1;
    let mut line_start = 0;

    // Append end-of-text as a virtual checkpoint so we also detect overflow
    // that occurs between the last break opportunity and the end of the string.
    let checkpoints: Vec<usize> = breaks
        .iter()
        .copied()
        .chain(std::iter::once(text.len()))
        .collect();

    for &check_pos in &checkpoints {
        if check_pos <= line_start {
            continue;
        }
        let segment = &text[line_start..check_pos];
        let width = measure_text_width(face, font_size, segment);

        if width > max_width {
            // Find the last break that fits within max_width
            let mut last_fit = line_start;
            for &bp in &breaks {
                if bp <= line_start {
                    continue;
                }
                if bp > check_pos {
                    break;
                }
                let seg = &text[line_start..bp];
                if measure_text_width(face, font_size, seg) <= max_width {
                    last_fit = bp;
                } else {
                    break;
                }
            }

            if last_fit > line_start {
                line_start = last_fit;
                lines += 1;
            } else if check_pos < text.len() {
                // Word is wider than max_width — force break at current position
                line_start = check_pos;
                lines += 1;
            }
            // If check_pos == text.len() and no break fits, remaining text
            // overflows on the current line (no character-level breaking).
        }
    }

    lines
}

/// Find byte positions in `text` where a line break is allowed.
/// Returns sorted Vec of byte offsets AFTER which a break can occur.
fn find_break_opportunities(text: &str) -> Vec<usize> {
    let mut breaks = Vec::new();
    let mut last_was_space = false;

    for (i, c) in text.char_indices() {
        let len = c.len_utf8();
        let end = i + len;

        if c.is_whitespace() {
            // Break after whitespace
            breaks.push(end);
            last_was_space = true;
        } else if font_db::FontDb::needs_cjk(&text[i..end]) {
            // CJK characters are individual break opportunities
            // Break before and after CJK chars
            if !last_was_space && i > 0 {
                breaks.push(i);
            }
            breaks.push(end);
            last_was_space = false;
        } else {
            last_was_space = false;
        }
    }

    breaks.sort_unstable();
    breaks.dedup();
    breaks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font_db::FontDb;

    fn face_for(family: &str) -> rustybuzz::Face<'static> {
        let db = FontDb::with_defaults();
        let (_, entry) = db.resolve(family).unwrap();
        let data = entry.data().to_vec();
        let leaked = Box::leak(data.into_boxed_slice());
        rustybuzz::Face::from_slice(leaked, entry.index()).unwrap()
    }

    #[test]
    fn wrap_empty_text_returns_one_line() {
        let face = face_for("Carlito");
        assert_eq!(wrap_text(&face, 16.0, "", 100.0), 1);
    }

    #[test]
    fn wrap_zero_width_returns_one_line() {
        let face = face_for("Carlito");
        assert_eq!(wrap_text(&face, 16.0, "Hello", 0.0), 1);
        assert_eq!(wrap_text(&face, 16.0, "Hello", -10.0), 1);
    }

    #[test]
    fn wrap_short_text_fits_in_one_line() {
        let face = face_for("Carlito");
        let w = crate::shaper::measure_text_width(&face, 16.0, "Hi");
        assert_eq!(wrap_text(&face, 16.0, "Hi", w + 50.0), 1);
    }

    #[test]
    fn wrap_explicit_newlines_produce_lines() {
        let face = face_for("Carlito");

        assert_eq!(
            wrap_text(&face, 16.0, "A\nB", 1000.0),
            2,
            "One newline should produce 2 lines"
        );
        assert_eq!(
            wrap_text(&face, 16.0, "A\nB\nC", 1000.0),
            3,
            "Two newlines should produce 3 lines"
        );
        assert_eq!(
            wrap_text(&face, 16.0, "\n", 1000.0),
            2,
            "Single newline should produce two empty paragraphs"
        );
    }

    #[test]
    fn wrap_two_words_forced_to_two_lines() {
        let face = face_for("Liberation Mono");

        let word_w = crate::shaper::measure_text_width(&face, 16.0, "AAAA");
        let space_w = crate::shaper::measure_text_width(&face, 16.0, " ");
        let total = word_w * 2.0 + space_w;

        let max_width = word_w + space_w + 1.0;
        assert!(
            max_width < total,
            "Sanity: max_width {max_width} < total {total}"
        );

        let lines = wrap_text(&face, 16.0, "AAAA AAAA", max_width);
        assert_eq!(lines, 2, "Two words exceeding width should wrap to 2 lines");
    }

    #[test]
    fn wrap_force_break_unbreakable_token() {
        let face = face_for("Liberation Mono");

        let char_w = crate::shaper::measure_text_width(&face, 16.0, "A");
        let max_width = char_w * 5.0;

        assert_eq!(
            wrap_text(&face, 16.0, "AAAAAAAAAA", max_width),
            1,
            "Unbreakable word should be 1 line"
        );
        assert_eq!(
            wrap_text(&face, 16.0, "AAAAAAAAAA AAAAAAAAAA", max_width),
            2,
            "Two overflowing words should force-break to 2 lines"
        );
    }

    #[test]
    fn wrap_cjk_characters_break_individually() {
        let face = face_for("Carlito");

        let cjk_w = crate::shaper::measure_text_width(&face, 16.0, "你");
        let max_width = cjk_w * 1.5;

        let lines = wrap_text(&face, 16.0, "你好世", max_width);
        assert_eq!(lines, 3, "3 CJK chars in narrow column should be 3 lines");
    }

    #[test]
    fn wrap_mixed_latin_and_cjk() {
        let face = face_for("Carlito");

        let hi_w = crate::shaper::measure_text_width(&face, 16.0, "Hi");
        let cjk_w = crate::shaper::measure_text_width(&face, 16.0, "你");
        let max_width = hi_w + cjk_w * 1.5;

        let lines = wrap_text(&face, 16.0, "Hi你好", max_width);
        assert_eq!(lines, 2, "Should break between CJK chars: 'Hi你' + '好'");
    }

    #[test]
    fn wrap_newlines_and_wrapping_combined() {
        let face = face_for("Liberation Mono");

        let char_w = crate::shaper::measure_text_width(&face, 16.0, "A");
        let max_width = char_w * 6.5;

        let lines = wrap_text(&face, 16.0, "AAA AAA\nBBB BBB", max_width);
        assert_eq!(lines, 4, "2 paragraphs each wrapping to 2 lines = 4 total");
    }

    #[test]
    fn wrap_multiple_words_counts_lines_correctly() {
        let face = face_for("Liberation Mono");

        let char_w = crate::shaper::measure_text_width(&face, 16.0, "A");
        let max_width = char_w * 10.5;

        let lines = wrap_text(&face, 16.0, "AAAA AAAA AAAA AAAA", max_width);
        assert_eq!(lines, 2, "4 words fitting 2-per-line should be 2 lines");
    }
}
