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
