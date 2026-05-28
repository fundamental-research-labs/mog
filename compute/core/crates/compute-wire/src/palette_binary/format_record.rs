//! Top-level `CellFormat` record codec for palette binary.

use domain_types::{CellFormat, FontSize};

use super::PaletteBinaryError;
use super::layout::*;
use super::nested::{read_borders, read_gradient_fill, write_borders, write_gradient_fill};
use super::read::{Cursor, read_string};
use super::string_pool::StringPool;
use super::write::{write_bool, write_i32, write_string, write_u32};

/// Build presence mask for a [`CellFormat`].
pub(super) fn build_presence(fmt: &CellFormat) -> u32 {
    let mut mask: u32 = 0;
    if fmt.font_family.is_some() {
        mask |= BIT_FONT_FAMILY;
    }
    if fmt.font_size.is_some() {
        mask |= BIT_FONT_SIZE;
    }
    if fmt.font_color.is_some() {
        mask |= BIT_FONT_COLOR;
    }
    if fmt.bold.is_some() {
        mask |= BIT_BOLD;
    }
    if fmt.italic.is_some() {
        mask |= BIT_ITALIC;
    }
    if fmt.underline_type.is_some() {
        mask |= BIT_UNDERLINE_TYPE;
    }
    if fmt.strikethrough.is_some() {
        mask |= BIT_STRIKETHROUGH;
    }
    if fmt.superscript.is_some() {
        mask |= BIT_SUPERSCRIPT;
    }
    if fmt.subscript.is_some() {
        mask |= BIT_SUBSCRIPT;
    }
    if fmt.font_outline.is_some() {
        mask |= BIT_FONT_OUTLINE;
    }
    if fmt.font_shadow.is_some() {
        mask |= BIT_FONT_SHADOW;
    }
    if fmt.font_theme.is_some() {
        mask |= BIT_FONT_THEME;
    }
    if fmt.font_charset.is_some() {
        mask |= BIT_FONT_CHARSET;
    }
    if fmt.font_family_type.is_some() {
        mask |= BIT_FONT_FAMILY_TYPE;
    }
    if fmt.horizontal_align.is_some() {
        mask |= BIT_HORIZONTAL_ALIGN;
    }
    if fmt.vertical_align.is_some() {
        mask |= BIT_VERTICAL_ALIGN;
    }
    if fmt.wrap_text.is_some() {
        mask |= BIT_WRAP_TEXT;
    }
    if fmt.indent.is_some() {
        mask |= BIT_INDENT;
    }
    if fmt.text_rotation.is_some() {
        mask |= BIT_TEXT_ROTATION;
    }
    if fmt.shrink_to_fit.is_some() {
        mask |= BIT_SHRINK_TO_FIT;
    }
    if fmt.reading_order.is_some() {
        mask |= BIT_READING_ORDER;
    }
    if fmt.number_format.is_some() {
        mask |= BIT_NUMBER_FORMAT;
    }
    if fmt.background_color.is_some() {
        mask |= BIT_BACKGROUND_COLOR;
    }
    if fmt.pattern_type.is_some() {
        mask |= BIT_PATTERN_TYPE;
    }
    if fmt.pattern_foreground_color.is_some() {
        mask |= BIT_PATTERN_FG_COLOR;
    }
    if fmt.gradient_fill.is_some() {
        mask |= BIT_GRADIENT_FILL;
    }
    if fmt.borders.is_some() {
        mask |= BIT_BORDERS;
    }
    if fmt.locked.is_some() {
        mask |= BIT_LOCKED;
    }
    if fmt.hidden.is_some() {
        mask |= BIT_HIDDEN;
    }
    mask
}

/// Write a single [`CellFormat`] as a `FormatRecord`.
pub(super) fn write_format_record(fmt: &CellFormat, buf: &mut Vec<u8>, pool: &mut StringPool) {
    let mask = build_presence(fmt);
    write_u32(buf, mask);

    // Fields in bit order — only present fields are written.
    if let Some(ref s) = fmt.font_family {
        write_string(buf, s, pool);
    }
    if let Some(fs) = fmt.font_size {
        write_u32(buf, fs.millipoints());
    }
    if let Some(ref s) = fmt.font_color {
        write_string(buf, s, pool);
    }
    if let Some(v) = fmt.bold {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.italic {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.underline_type {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(v) = fmt.strikethrough {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.superscript {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.subscript {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.font_outline {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.font_shadow {
        write_bool(buf, v);
    }
    if let Some(ref s) = fmt.font_theme {
        write_string(buf, s, pool);
    }
    if let Some(v) = fmt.font_charset {
        write_u32(buf, v);
    }
    if let Some(v) = fmt.font_family_type {
        write_u32(buf, v);
    }
    if let Some(v) = fmt.horizontal_align {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(v) = fmt.vertical_align {
        write_string(buf, v.to_kernel_token(), pool);
    }
    if let Some(v) = fmt.wrap_text {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.indent {
        write_u32(buf, v);
    }
    if let Some(v) = fmt.text_rotation {
        write_i32(buf, v);
    }
    if let Some(v) = fmt.shrink_to_fit {
        write_bool(buf, v);
    }
    if let Some(ref s) = fmt.reading_order {
        write_string(buf, s, pool);
    }
    if let Some(ref s) = fmt.number_format {
        write_string(buf, s, pool);
    }
    if let Some(ref s) = fmt.background_color {
        write_string(buf, s, pool);
    }
    if let Some(v) = fmt.pattern_type {
        write_string(buf, v.to_ooxml(), pool);
    }
    if let Some(ref s) = fmt.pattern_foreground_color {
        write_string(buf, s, pool);
    }
    if let Some(ref gf) = fmt.gradient_fill {
        write_gradient_fill(buf, gf, pool);
    }
    if let Some(ref b) = fmt.borders {
        write_borders(buf, b, pool);
    }
    if let Some(v) = fmt.locked {
        write_bool(buf, v);
    }
    if let Some(v) = fmt.hidden {
        write_bool(buf, v);
    }
}

/// Read a single `FormatRecord` and return a [`CellFormat`].
// Linear sequential decode of all format fields — splitting would not improve clarity.
#[allow(clippy::too_many_lines)]
pub(super) fn read_format_record(
    cursor: &mut Cursor<'_>,
    pool: &[u8],
    pool_size: u32,
) -> Result<CellFormat, PaletteBinaryError> {
    let mask = cursor.read_u32("format record presence mask")?;

    let font_family = if mask & BIT_FONT_FAMILY != 0 {
        Some(read_string(cursor, pool, pool_size, "font_family")?)
    } else {
        None
    };
    let font_size = if mask & BIT_FONT_SIZE != 0 {
        Some(FontSize::from_millipoints(cursor.read_u32("font_size")?))
    } else {
        None
    };
    let font_color = if mask & BIT_FONT_COLOR != 0 {
        Some(read_string(cursor, pool, pool_size, "font_color")?)
    } else {
        None
    };
    let bold = if mask & BIT_BOLD != 0 {
        Some(cursor.read_bool("bold")?)
    } else {
        None
    };
    let italic = if mask & BIT_ITALIC != 0 {
        Some(cursor.read_bool("italic")?)
    } else {
        None
    };
    let underline_type = if mask & BIT_UNDERLINE_TYPE != 0 {
        let s = read_string(cursor, pool, pool_size, "underline_type")?;
        ooxml_types::styles::UnderlineStyle::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown UnderlineStyle in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let strikethrough = if mask & BIT_STRIKETHROUGH != 0 {
        Some(cursor.read_bool("strikethrough")?)
    } else {
        None
    };
    let superscript = if mask & BIT_SUPERSCRIPT != 0 {
        Some(cursor.read_bool("superscript")?)
    } else {
        None
    };
    let subscript = if mask & BIT_SUBSCRIPT != 0 {
        Some(cursor.read_bool("subscript")?)
    } else {
        None
    };
    let font_outline = if mask & BIT_FONT_OUTLINE != 0 {
        Some(cursor.read_bool("font_outline")?)
    } else {
        None
    };
    let font_shadow = if mask & BIT_FONT_SHADOW != 0 {
        Some(cursor.read_bool("font_shadow")?)
    } else {
        None
    };
    let font_theme = if mask & BIT_FONT_THEME != 0 {
        Some(read_string(cursor, pool, pool_size, "font_theme")?)
    } else {
        None
    };
    let font_charset = if mask & BIT_FONT_CHARSET != 0 {
        Some(cursor.read_u32("font_charset")?)
    } else {
        None
    };
    let font_family_type = if mask & BIT_FONT_FAMILY_TYPE != 0 {
        Some(cursor.read_u32("font_family_type")?)
    } else {
        None
    };
    let horizontal_align = if mask & BIT_HORIZONTAL_ALIGN != 0 {
        let s = read_string(cursor, pool, pool_size, "horizontal_align")?;
        ooxml_types::styles::HorizontalAlign::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown HorizontalAlign in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let vertical_align = if mask & BIT_VERTICAL_ALIGN != 0 {
        let s = read_string(cursor, pool, pool_size, "vertical_align")?;
        domain_types::CellVerticalAlign::from_kernel_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown CellVerticalAlign in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let wrap_text = if mask & BIT_WRAP_TEXT != 0 {
        Some(cursor.read_bool("wrap_text")?)
    } else {
        None
    };
    let indent = if mask & BIT_INDENT != 0 {
        Some(cursor.read_u32("indent")?)
    } else {
        None
    };
    let text_rotation = if mask & BIT_TEXT_ROTATION != 0 {
        Some(cursor.read_i32("text_rotation")?)
    } else {
        None
    };
    let shrink_to_fit = if mask & BIT_SHRINK_TO_FIT != 0 {
        Some(cursor.read_bool("shrink_to_fit")?)
    } else {
        None
    };
    let reading_order = if mask & BIT_READING_ORDER != 0 {
        Some(read_string(cursor, pool, pool_size, "reading_order")?)
    } else {
        None
    };
    let number_format = if mask & BIT_NUMBER_FORMAT != 0 {
        Some(read_string(cursor, pool, pool_size, "number_format")?)
    } else {
        None
    };
    let background_color = if mask & BIT_BACKGROUND_COLOR != 0 {
        Some(read_string(cursor, pool, pool_size, "background_color")?)
    } else {
        None
    };
    let pattern_type = if mask & BIT_PATTERN_TYPE != 0 {
        let s = read_string(cursor, pool, pool_size, "pattern_type")?;
        ooxml_types::styles::PatternType::from_ooxml_token(&s).or_else(|| {
            tracing::warn!(token = %s, "unknown PatternType in palette binary; dropping field");
            None
        })
    } else {
        None
    };
    let pattern_foreground_color = if mask & BIT_PATTERN_FG_COLOR != 0 {
        Some(read_string(cursor, pool, pool_size, "pattern_fg_color")?)
    } else {
        None
    };
    let gradient_fill = if mask & BIT_GRADIENT_FILL != 0 {
        Some(read_gradient_fill(cursor, pool, pool_size)?)
    } else {
        None
    };
    let borders = if mask & BIT_BORDERS != 0 {
        Some(read_borders(cursor, pool, pool_size)?)
    } else {
        None
    };
    let locked = if mask & BIT_LOCKED != 0 {
        Some(cursor.read_bool("locked")?)
    } else {
        None
    };
    let hidden = if mask & BIT_HIDDEN != 0 {
        Some(cursor.read_bool("hidden")?)
    } else {
        None
    };

    Ok(CellFormat {
        font_family,
        font_size,
        font_color,
        bold,
        italic,
        underline_type,
        strikethrough,
        superscript,
        subscript,
        font_outline,
        font_shadow,
        font_theme,
        font_charset,
        font_family_type,
        horizontal_align,
        vertical_align,
        wrap_text,
        indent,
        text_rotation,
        shrink_to_fit,
        reading_order,
        number_format,
        background_color,
        pattern_type,
        pattern_foreground_color,
        gradient_fill,
        borders,
        locked,
        hidden,
        // quote_prefix is not part of the binary wire format.
        quote_prefix: None,
        // tint / auto-indent fields are not part of the binary wire format.
        font_color_tint: None,
        auto_indent: None,
        background_color_tint: None,
        pattern_foreground_color_tint: None,
    })
}
