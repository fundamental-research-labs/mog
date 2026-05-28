use super::*;

// =============================================================================
// Domain conversions: Comment rich text runs
// =============================================================================

/// Convert parser `CommentRunOutput` items into domain `RichTextRun` items.
/// Preserves font properties: bold, italic, underline, strikethrough, color, size, name.
pub(crate) fn convert_comment_runs(runs: &[CommentRunOutput]) -> Vec<RichTextRun> {
    runs.iter()
        .map(|r| RichTextRun {
            text: r.text.clone(),
            font_name: r.font_name.clone(),
            font_size: r.font_size,
            bold: r.bold,
            italic: r.italic,
            underline_style: None,
            underline: r.underline,
            strikethrough: r.strike,
            outline: None,
            shadow: None,
            condense: None,
            extend: None,
            color: r.color.clone(),
            color_indexed: r.color_indexed,
            color_theme: r.color_theme,
            color_tint: r.color_tint,
            charset: r.charset,
            family: r.font_family,
            scheme: r.scheme.clone(),
            vert_align: r.vert_align.clone(),
            preserve_space: r.preserve_space,
        })
        .collect()
}
