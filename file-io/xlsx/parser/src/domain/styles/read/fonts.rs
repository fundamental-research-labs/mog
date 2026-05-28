use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_with_default, parse_f64_attr, parse_string_attr,
    parse_u32_attr,
};

use super::super::types::*;
use super::support::{parse_color_ref, parse_optional_bool_element};

/// Parse the `x14ac:knownFonts` attribute from the `<fonts>` element in styles.xml.
///
/// This attribute appears as `x14ac:knownFonts="1"` or `knownFonts="1"` on the
/// `<fonts>` opening tag. It indicates the producing application verified all
/// referenced fonts are available on the system.
///
/// Returns `true` if the attribute is present and set to "1" or "true".
pub fn parse_known_fonts(xml: &[u8]) -> bool {
    // Find the <fonts ...> opening tag
    if let Some(fonts_start) = find_tag_simd(xml, b"fonts", 0) {
        // Get the opening tag content (up to the first >)
        let tag_end = find_gt_simd(xml, fonts_start).unwrap_or(xml.len());
        let tag_bytes = &xml[fonts_start..tag_end];

        // Check for x14ac:knownFonts="1" (namespaced form)
        // Note: parse_bool_attr expects the pattern to include the opening quote
        if parse_bool_attr(tag_bytes, b"x14ac:knownFonts=\"") {
            return true;
        }
        // Check for knownFonts="1" (non-prefixed form, in case namespace was default)
        if parse_bool_attr(tag_bytes, b"knownFonts=\"") {
            return true;
        }
    }
    false
}

/// Parse the <fonts> section
pub(super) fn parse_fonts(out: &mut Vec<FontDef>, xml: &[u8]) {
    let mut pos = 0;

    // Find each <font> element
    while let Some(font_start) = find_tag_simd(xml, b"font", pos) {
        // Find the closing </font> tag or the end of this section
        let font_end = find_closing_tag(xml, b"font", font_start).unwrap_or(xml.len());

        // Get the content of this <font> element (between <font> and </font>)
        let open_end = find_gt_simd(xml, font_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        // Check if this is a self-closing tag (/>)
        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            // Self-closing <font/> — empty font
            out.push(FontDef::default());
            pos = open_end;
            continue;
        }

        let font_content = &xml[open_end..font_end];

        let mut font_def = FontDef::default();

        // Parse <sz val="..."/>
        if let Some(sz_start) = find_tag_simd(font_content, b"sz", 0) {
            let sz_end = find_gt_simd(font_content, sz_start)
                .map(|p| p + 1)
                .unwrap_or(font_content.len());
            let sz_el = &font_content[sz_start..sz_end];
            font_def.size = parse_f64_attr(sz_el, b"val=\"");
        }

        // Parse <name val="..."/>
        if let Some(name_start) = find_tag_simd(font_content, b"name", 0) {
            let name_end = find_gt_simd(font_content, name_start)
                .map(|p| p + 1)
                .unwrap_or(font_content.len());
            let name_el = &font_content[name_start..name_end];
            font_def.name = parse_string_attr(name_el, b"val=\"");
        }

        // Parse <b/> or <b val="..."/> (bold) → Option<bool>
        // None = element absent, Some(false) = <b val="0"/>, Some(true) = <b/> or <b val="1"/>
        font_def.bold = find_tag_simd(font_content, b"b", 0).and_then(|p| {
            let after = p + 2;
            if after < font_content.len()
                && (font_content[after] == b'/'
                    || font_content[after] == b'>'
                    || font_content[after] == b' ')
            {
                let el_end = find_gt_simd(font_content, p)
                    .map(|g| g + 1)
                    .unwrap_or(font_content.len());
                Some(parse_bool_attr_with_default(
                    &font_content[p..el_end],
                    b"val=\"",
                    true,
                ))
            } else {
                None
            }
        });

        // Parse <i/> or <i val="..."/> (italic) → Option<bool>
        font_def.italic = find_tag_simd(font_content, b"i", 0).and_then(|p| {
            let after = p + 2;
            if after < font_content.len()
                && (font_content[after] == b'/'
                    || font_content[after] == b'>'
                    || font_content[after] == b' ')
            {
                let el_end = find_gt_simd(font_content, p)
                    .map(|g| g + 1)
                    .unwrap_or(font_content.len());
                Some(parse_bool_attr_with_default(
                    &font_content[p..el_end],
                    b"val=\"",
                    true,
                ))
            } else {
                None
            }
        });

        // Parse <u/> or <u val="..."/> (underline) → Option<UnderlineStyle>
        if let Some(u_start) = find_tag_simd(font_content, b"u", 0) {
            let u_end = find_gt_simd(font_content, u_start)
                .map(|p| p + 1)
                .unwrap_or(font_content.len());
            let u_el = &font_content[u_start..u_end];
            font_def.underline = Some(match parse_string_attr(u_el, b"val=\"") {
                Some(val) => UnderlineStyle::from_ooxml_token(&val).unwrap_or_else(|| {
                    tracing::warn!(token = %val, "unknown UnderlineStyle OOXML token in XLSX; using Single");
                    UnderlineStyle::Single
                }),
                // Bare <u/> without val attribute means single underline
                None => UnderlineStyle::Single,
            });
        }

        // Parse <strike/> or <strike val="..."/> (strikethrough) → Option<bool>
        font_def.strikethrough = parse_optional_bool_element(font_content, b"strike");

        // Parse <outline/> or <outline val="..."/> → Option<bool>
        font_def.outline = parse_optional_bool_element(font_content, b"outline");

        // Parse <shadow/> or <shadow val="..."/> → Option<bool>
        font_def.shadow = parse_optional_bool_element(font_content, b"shadow");

        // Parse <condense/> or <condense val="..."/> → Option<bool>
        font_def.condense = parse_optional_bool_element(font_content, b"condense");

        // Parse <extend/> or <extend val="..."/> → Option<bool>
        font_def.extend = parse_optional_bool_element(font_content, b"extend");

        // Parse <color .../>
        font_def.color = parse_color_ref(font_content);

        // Parse <family val="..."/>
        if let Some(fam_start) = find_tag_simd(font_content, b"family", 0) {
            let fam_end = find_gt_simd(font_content, fam_start)
                .map(|p| p + 1)
                .unwrap_or(font_content.len());
            let fam_el = &font_content[fam_start..fam_end];
            font_def.family = parse_u32_attr(fam_el, b"val=\"");
        }

        // Parse <charset val="..."/>
        if let Some(cs_start) = find_tag_simd(font_content, b"charset", 0) {
            let cs_end = find_gt_simd(font_content, cs_start)
                .map(|p| p + 1)
                .unwrap_or(font_content.len());
            let cs_el = &font_content[cs_start..cs_end];
            font_def.charset = parse_u32_attr(cs_el, b"val=\"");
        }

        // Parse <scheme val="..."/> → Option<FontScheme>
        if let Some(sch_start) = find_tag_simd(font_content, b"scheme", 0) {
            let sch_end = find_gt_simd(font_content, sch_start)
                .map(|p| p + 1)
                .unwrap_or(font_content.len());
            let sch_el = &font_content[sch_start..sch_end];
            font_def.scheme =
                parse_string_attr(sch_el, b"val=\"").map(|s| FontScheme::from_ooxml(&s));
        }

        // Parse <vertAlign val="..."/> → Option<VerticalAlignRun>
        if let Some(va_start) = find_tag_simd(font_content, b"vertAlign", 0) {
            let va_end = find_gt_simd(font_content, va_start)
                .map(|p| p + 1)
                .unwrap_or(font_content.len());
            let va_el = &font_content[va_start..va_end];
            font_def.vert_align =
                parse_string_attr(va_el, b"val=\"").map(|s| VerticalAlignRun::from_ooxml(&s));
        }

        out.push(font_def);

        // Advance past the closing </font> tag
        let close_end = find_gt_simd(xml, font_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
}

/// Parse a single <font>...</font> block into a FontDef (for use inside <dxf>).
pub(super) fn parse_single_font(xml: &[u8]) -> FontDef {
    let mut font_def = FontDef::default();

    // Parse <sz val="..."/>
    if let Some(sz_start) = find_tag_simd(xml, b"sz", 0) {
        let sz_end = find_gt_simd(xml, sz_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let sz_el = &xml[sz_start..sz_end];
        font_def.size = parse_f64_attr(sz_el, b"val=\"");
    }

    // Parse <name val="..."/>
    if let Some(name_start) = find_tag_simd(xml, b"name", 0) {
        let name_end = find_gt_simd(xml, name_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let name_el = &xml[name_start..name_end];
        font_def.name = parse_string_attr(name_el, b"val=\"");
    }

    // Parse <b/> or <b val="..."/> (bold) → Option<bool>
    font_def.bold = find_tag_simd(xml, b"b", 0).and_then(|p| {
        let after = p + 2;
        if after < xml.len() && (xml[after] == b'/' || xml[after] == b'>' || xml[after] == b' ') {
            let el_end = find_gt_simd(xml, p).map(|g| g + 1).unwrap_or(xml.len());
            Some(parse_bool_attr_with_default(
                &xml[p..el_end],
                b"val=\"",
                true,
            ))
        } else {
            None
        }
    });

    // Parse <i/> or <i val="..."/> (italic) → Option<bool>
    font_def.italic = find_tag_simd(xml, b"i", 0).and_then(|p| {
        let after = p + 2;
        if after < xml.len() && (xml[after] == b'/' || xml[after] == b'>' || xml[after] == b' ') {
            let el_end = find_gt_simd(xml, p).map(|g| g + 1).unwrap_or(xml.len());
            Some(parse_bool_attr_with_default(
                &xml[p..el_end],
                b"val=\"",
                true,
            ))
        } else {
            None
        }
    });

    // Parse <u/> or <u val="..."/> (underline)
    if let Some(u_start) = find_tag_simd(xml, b"u", 0) {
        let u_end = find_gt_simd(xml, u_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let u_el = &xml[u_start..u_end];
        font_def.underline = Some(match parse_string_attr(u_el, b"val=\"") {
            Some(val) => UnderlineStyle::from_ooxml_token(&val).unwrap_or_else(|| {
                tracing::warn!(token = %val, "unknown UnderlineStyle OOXML token in XLSX; using Single");
                UnderlineStyle::Single
            }),
            None => UnderlineStyle::Single,
        });
    }

    // Parse <strike/> or <strike val="..."/> (strikethrough) → Option<bool>
    font_def.strikethrough = parse_optional_bool_element(xml, b"strike");

    // Parse <outline/> or <outline val="..."/> → Option<bool>
    font_def.outline = parse_optional_bool_element(xml, b"outline");

    // Parse <shadow/> or <shadow val="..."/> → Option<bool>
    font_def.shadow = parse_optional_bool_element(xml, b"shadow");

    // Parse <condense/> or <condense val="..."/> → Option<bool>
    font_def.condense = parse_optional_bool_element(xml, b"condense");

    // Parse <extend/> or <extend val="..."/> → Option<bool>
    font_def.extend = parse_optional_bool_element(xml, b"extend");

    // Parse <vertAlign val="..."/> → Option<VerticalAlignRun>
    if let Some(va_start) = find_tag_simd(xml, b"vertAlign", 0) {
        let va_end = find_gt_simd(xml, va_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let va_el = &xml[va_start..va_end];
        font_def.vert_align =
            parse_string_attr(va_el, b"val=\"").map(|s| VerticalAlignRun::from_ooxml(&s));
    }

    // Parse <color .../>
    font_def.color = parse_color_ref(xml);

    // Parse <family val="..."/>
    if let Some(fam_start) = find_tag_simd(xml, b"family", 0) {
        let fam_end = find_gt_simd(xml, fam_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        font_def.family = parse_u32_attr(&xml[fam_start..fam_end], b"val=\"");
    }

    // Parse <scheme val="..."/>
    if let Some(sch_start) = find_tag_simd(xml, b"scheme", 0) {
        let sch_end = find_gt_simd(xml, sch_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        font_def.scheme = parse_string_attr(&xml[sch_start..sch_end], b"val=\"")
            .map(|s| FontScheme::from_ooxml(&s));
    }

    font_def
}
