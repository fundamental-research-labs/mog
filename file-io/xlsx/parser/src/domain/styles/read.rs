//! Styles parser for XLSX formatting
//!
//! This module parses styles.xml to extract cell formatting information,
//! particularly number formats which are essential for correctly interpreting
//! date values (which are stored as numbers in Excel).

use crate::infra::scanner::{find_closing_tag, find_element_end, find_gt_simd, find_tag_simd};
use crate::infra::xml::{
    parse_bool_attr, parse_bool_attr_opt, parse_bool_attr_with_default, parse_f64_attr,
    parse_string_attr, parse_string_attr_single_quote, parse_u32_attr,
};

// Re-export canonical types from ooxml-types for use by read-side consumers.
pub use ooxml_types::styles::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellStyleDef, CellXfDef, ColorDef,
    ColorsDef, DxfDef, FillDef, FontDef, FontScheme, GradientStop, GradientType, HorizontalAlign,
    NumberFormatDef, PatternType, ProtectionDef, Stylesheet, TableStyleDef, TableStyleElementDef,
    TableStyleType, UnderlineStyle, VerticalAlign, VerticalAlignRun,
};

// =============================================================================
// Derive-based parse structs (local proxies for mechanical XML attribute extraction)
// =============================================================================

/// Alignment attributes parsed via XmlRead derive, mapped to `AlignmentDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "alignment")]
struct RawAlignment {
    #[xml(attr = "horizontal", enum)]
    horizontal: Option<HorizontalAlign>,
    #[xml(attr = "vertical", enum)]
    vertical: Option<VerticalAlign>,
    #[xml(attr = "wrapText", bool)]
    wrap_text: Option<bool>,
    #[xml(attr = "textRotation", num)]
    text_rotation: Option<u32>,
    #[xml(attr = "indent", num)]
    indent: Option<u32>,
    #[xml(attr = "shrinkToFit", bool)]
    shrink_to_fit: Option<bool>,
    #[xml(attr = "readingOrder", num)]
    reading_order: Option<u32>,
    #[xml(attr = "relativeIndent", num)]
    relative_indent: Option<i32>,
    #[xml(attr = "justifyLastLine", bool)]
    justify_last_line: Option<bool>,
    #[xml(attr = "autoIndent", bool)]
    auto_indent: Option<bool>,
}

impl From<RawAlignment> for AlignmentDef {
    fn from(r: RawAlignment) -> Self {
        AlignmentDef {
            horizontal: r.horizontal,
            vertical: r.vertical,
            wrap_text: r.wrap_text,
            text_rotation: r.text_rotation,
            indent: r.indent,
            shrink_to_fit: r.shrink_to_fit,
            reading_order: r.reading_order,
            relative_indent: r.relative_indent,
            justify_last_line: r.justify_last_line,
            auto_indent: r.auto_indent,
        }
    }
}

/// Protection attributes parsed via XmlRead derive, mapped to `ProtectionDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "protection")]
struct RawProtection {
    #[xml(attr = "locked", bool)]
    locked: Option<bool>,
    #[xml(attr = "hidden", bool)]
    hidden: Option<bool>,
}

impl From<RawProtection> for ProtectionDef {
    fn from(r: RawProtection) -> Self {
        ProtectionDef {
            locked: r.locked,
            hidden: r.hidden,
        }
    }
}

/// CellXf opening-tag attributes parsed via XmlRead derive.
/// Child elements (alignment, protection, extLst) are handled separately.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "xf")]
struct RawCellXfAttrs {
    #[xml(attr = "numFmtId", num)]
    num_fmt_id: Option<u32>,
    #[xml(attr = "fontId", num)]
    font_id: Option<u32>,
    #[xml(attr = "fillId", num)]
    fill_id: Option<u32>,
    #[xml(attr = "borderId", num)]
    border_id: Option<u32>,
    #[xml(attr = "applyNumberFormat", bool)]
    apply_number_format: Option<bool>,
    #[xml(attr = "applyFont", bool)]
    apply_font: Option<bool>,
    #[xml(attr = "applyFill", bool)]
    apply_fill: Option<bool>,
    #[xml(attr = "applyBorder", bool)]
    apply_border: Option<bool>,
    #[xml(attr = "xfId", num)]
    xf_id: Option<u32>,
    #[xml(attr = "applyAlignment", bool)]
    apply_alignment: Option<bool>,
    #[xml(attr = "applyProtection", bool)]
    apply_protection: Option<bool>,
    #[xml(attr = "quotePrefix", bool)]
    quote_prefix: Option<bool>,
    #[xml(attr = "pivotButton", bool)]
    pivot_button: Option<bool>,
}

/// CellStyle attributes parsed via XmlRead derive, mapped to `CellStyleDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "cellStyle")]
struct RawCellStyle {
    #[xml(attr = "name")]
    name: Option<String>,
    #[xml(attr = "xfId", num)]
    xf_id: Option<u32>,
    #[xml(attr = "builtinId", num)]
    builtin_id: Option<u32>,
    #[xml(attr = "customBuiltin", bool)]
    custom_builtin: Option<bool>,
    #[xml(attr = "iLevel", num)]
    i_level: Option<u32>,
    #[xml(attr = "hidden", bool)]
    hidden: Option<bool>,
    #[xml(attr = "xr:uid")]
    xr_uid: Option<String>,
}

impl From<RawCellStyle> for CellStyleDef {
    fn from(r: RawCellStyle) -> Self {
        CellStyleDef {
            name: r.name,
            xf_id: r.xf_id.unwrap_or(0),
            builtin_id: r.builtin_id,
            custom_builtin: r.custom_builtin,
            i_level: r.i_level,
            hidden: r.hidden,
            ext_lst: None,
            xr_uid: r.xr_uid,
        }
    }
}

/// NumFmt attributes parsed via XmlRead derive, mapped to `NumberFormatDef`.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "numFmt")]
struct RawNumFmt {
    #[xml(attr = "numFmtId", num)]
    id: Option<u32>,
    #[xml(attr = "formatCode")]
    format_code: Option<String>,
}

/// TableStyleElement attributes parsed via XmlRead derive.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "tableStyleElement")]
struct RawTableStyleElement {
    #[xml(attr = "type")]
    style_type: Option<String>,
    #[xml(attr = "dxfId", num)]
    dxf_id: Option<u32>,
    #[xml(attr = "size", num)]
    size: Option<u32>,
}

/// TableStyle attributes parsed via XmlRead derive.
#[derive(Default, xml_derive::XmlRead)]
#[xml(tag = "tableStyle")]
struct RawTableStyle {
    #[xml(attr = "name")]
    name: Option<String>,
    #[xml(attr = "pivot", bool)]
    pivot: Option<bool>,
    #[xml(attr = "table", bool)]
    table: Option<bool>,
    #[xml(attr = "count", num)]
    count: Option<u32>,
    #[xml(attr = "xr9:uid")]
    xr_uid: Option<String>,
}

/// Parse styles.xml content
///
/// # Arguments
/// * `xml` - Raw bytes of the styles.xml file
///
/// # Returns
/// Parsed Stylesheet
pub fn parse_styles(xml: &[u8]) -> Stylesheet {
    let mut styles = Stylesheet::default();

    // Parse <numFmts> section for custom number formats
    if let Some(numfmts_start) = find_tag_simd(xml, b"numFmts", 0) {
        let numfmts_end = find_closing_tag(xml, b"numFmts", numfmts_start).unwrap_or(xml.len());

        parse_num_fmts(&mut styles.num_fmts, &xml[numfmts_start..numfmts_end]);
    }

    // Parse <fonts> section
    if let Some(fonts_start) = find_tag_simd(xml, b"fonts", 0) {
        let fonts_end = find_closing_tag(xml, b"fonts", fonts_start).unwrap_or(xml.len());

        parse_fonts(&mut styles.fonts, &xml[fonts_start..fonts_end]);
    }

    // Parse <fills> section
    if let Some(fills_start) = find_tag_simd(xml, b"fills", 0) {
        let fills_end = find_closing_tag(xml, b"fills", fills_start).unwrap_or(xml.len());

        parse_fills(&mut styles.fills, &xml[fills_start..fills_end]);
    }

    // Parse <borders> section
    if let Some(borders_start) = find_tag_simd(xml, b"borders", 0) {
        let borders_end = find_closing_tag(xml, b"borders", borders_start).unwrap_or(xml.len());

        parse_borders(&mut styles.borders, &xml[borders_start..borders_end]);
    }

    // Parse <cellStyleXfs> section (base styles referenced by named styles)
    if let Some(csxfs_start) = find_tag_simd(xml, b"cellStyleXfs", 0) {
        let csxfs_end = find_closing_tag(xml, b"cellStyleXfs", csxfs_start).unwrap_or(xml.len());
        parse_cell_xfs(&mut styles.cell_style_xfs, &xml[csxfs_start..csxfs_end]);
    }

    // Parse <cellXfs> section for cell styles
    if let Some(cellxfs_start) = find_tag_simd(xml, b"cellXfs", 0) {
        let cellxfs_end = find_closing_tag(xml, b"cellXfs", cellxfs_start).unwrap_or(xml.len());
        parse_cell_xfs(&mut styles.cell_xfs, &xml[cellxfs_start..cellxfs_end]);
    }

    // Parse <cellStyles> section (named styles like "Normal", "Percent")
    if let Some(cs_start) = find_tag_simd(xml, b"cellStyles", 0) {
        let cs_end = find_closing_tag(xml, b"cellStyles", cs_start).unwrap_or(xml.len());
        styles.cell_styles = parse_cell_styles(&xml[cs_start..cs_end]);
    }

    // Parse <dxfs> section (differential formatting records)
    if let Some(dxfs_start) = find_tag_simd(xml, b"dxfs", 0) {
        let dxfs_end = find_closing_tag(xml, b"dxfs", dxfs_start).unwrap_or(xml.len());
        styles.dxfs = parse_dxfs(&xml[dxfs_start..dxfs_end]);
    }

    // Parse <colors> section (custom color palette and MRU colors)
    if let Some(colors_start) = find_tag_simd(xml, b"colors", 0) {
        let colors_end = find_closing_tag(xml, b"colors", colors_start).unwrap_or(xml.len());
        let colors = parse_colors(&xml[colors_start..colors_end]);
        if !colors.indexed_colors.is_empty() || !colors.mru_colors.is_empty() {
            styles.colors = Some(colors);
        }
    }

    // Parse <tableStyles> section
    if let Some(ts_start) = find_tag_simd(xml, b"tableStyles", 0) {
        let ts_end = find_closing_tag(xml, b"tableStyles", ts_start).unwrap_or(xml.len());
        let (table_styles, default_table, default_pivot) =
            parse_table_styles(&xml[ts_start..ts_end]);
        styles.table_styles = table_styles;
        styles.default_table_style = default_table;
        styles.default_pivot_style = default_pivot;
    }

    styles
}

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

/// Get the number format code for a style index
///
/// # Arguments
/// * `stylesheet` - The parsed stylesheet
/// * `style_idx` - The style index from a cell's s attribute
///
/// # Returns
/// The format code string if found
pub fn get_number_format(stylesheet: &Stylesheet, style_idx: u16) -> Option<&str> {
    // Look up cellXf by index
    let cell_style = stylesheet.cell_xfs.get(style_idx as usize)?;
    let num_fmt_id = cell_style.num_fmt_id.unwrap_or(0);

    // If < 164, it's a built-in format
    if num_fmt_id < 164 {
        return builtin_format(num_fmt_id);
    }

    // Otherwise look up in custom num_fmts
    stylesheet
        .num_fmts
        .iter()
        .find(|nf| nf.id == num_fmt_id)
        .map(|nf| nf.format_code.as_str())
}

/// Check if a style represents a date format
///
/// # Arguments
/// * `stylesheet` - The parsed stylesheet
/// * `style_idx` - The style index from a cell's s attribute
///
/// # Returns
/// true if this style uses a date/time format
pub fn is_date_format(stylesheet: &Stylesheet, style_idx: u16) -> bool {
    let cell_style = match stylesheet.cell_xfs.get(style_idx as usize) {
        Some(s) => s,
        None => return false,
    };

    let num_fmt_id = cell_style.num_fmt_id.unwrap_or(0);

    // Built-in date format IDs
    if is_builtin_date_format(num_fmt_id) {
        return true;
    }

    // For custom formats (>= 164), check the format code pattern
    if num_fmt_id >= 164 {
        if let Some(nf) = stylesheet.num_fmts.iter().find(|nf| nf.id == num_fmt_id) {
            return is_date_format_code(&nf.format_code);
        }
    }

    false
}

// =============================================================================
// Parsing functions (free functions operating on &mut Vec)
// =============================================================================

/// Parse the <numFmts> section
fn parse_num_fmts(out: &mut Vec<NumberFormatDef>, xml: &[u8]) {
    let mut pos = 0;

    // Find each <numFmt> element
    while let Some(numfmt_start) = find_tag_simd(xml, b"numFmt", pos) {
        // Find the end of this element (either /> or </numFmt>)
        // Must use quote-aware scan: formatCode can contain unescaped '>'
        // in conditional number formats, e.g. formatCode="[Red][>0.05] 0%"
        let element_end = find_element_end(xml, numfmt_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        if let Some(raw) = RawNumFmt::xml_parse(&xml[numfmt_start..element_end]) {
            let id = raw.id.unwrap_or(0);
            let format_code = raw.format_code.unwrap_or_default();
            if id > 0 || !format_code.is_empty() {
                out.push(NumberFormatDef { id, format_code });
            }
        }

        pos = element_end;
    }
}

/// Parse a color element from tag bytes, returning a `ColorDef`.
fn parse_color(tag_bytes: &[u8]) -> Option<ColorDef> {
    let tint = parse_string_attr(tag_bytes, b"tint=\"");

    if let Some(theme_id) = parse_u32_attr(tag_bytes, b"theme=\"") {
        return Some(ColorDef::Theme { id: theme_id, tint });
    }
    if let Some(rgb) = parse_string_attr(tag_bytes, b"rgb=\"") {
        return Some(ColorDef::Rgb { val: rgb, tint });
    }
    if let Some(idx) = parse_u32_attr(tag_bytes, b"indexed=\"") {
        return Some(ColorDef::Indexed { id: idx, tint });
    }
    if parse_bool_attr(tag_bytes, b"auto=\"") {
        return Some(ColorDef::Auto { tint });
    }
    None
}

/// Find a <color> child element and parse it into a `ColorDef`.
fn parse_color_ref(xml: &[u8]) -> Option<ColorDef> {
    let color_start = find_tag_simd(xml, b"color", 0)?;
    let color_end = find_gt_simd(xml, color_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let element = &xml[color_start..color_end];
    parse_color(element)
}

/// Parse a named color element (e.g. <fgColor>, <bgColor>) into a `ColorDef`.
fn parse_named_color_ref(xml: &[u8], tag: &[u8]) -> Option<ColorDef> {
    let tag_start = find_tag_simd(xml, tag, 0)?;
    let tag_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());
    let element = &xml[tag_start..tag_end];
    parse_color(element)
}

/// Parse the <fonts> section
fn parse_fonts(out: &mut Vec<FontDef>, xml: &[u8]) {
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

/// Parse the <fills> section
fn parse_fills(out: &mut Vec<FillDef>, xml: &[u8]) {
    let mut pos = 0;

    // Find each <fill> element
    while let Some(fill_start) = find_tag_simd(xml, b"fill", pos) {
        let fill_end = find_closing_tag(xml, b"fill", fill_start).unwrap_or(xml.len());

        let open_end = find_gt_simd(xml, fill_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            out.push(FillDef::None);
            pos = open_end;
            continue;
        }

        let fill_content = &xml[open_end..fill_end];

        // Try <patternFill> first
        if let Some(pf_start) = find_tag_simd(fill_content, b"patternFill", 0) {
            let pf_open_end = find_gt_simd(fill_content, pf_start)
                .map(|p| p + 1)
                .unwrap_or(fill_content.len());
            let pf_el = &fill_content[pf_start..pf_open_end];

            // Option<PatternType>: None = attribute absent, Some(X) = explicit.
            // Strict parse: unknown tokens log and treat the attribute as absent
            // rather than silently defaulting to PatternType::None.
            let pattern_type_opt = parse_string_attr(pf_el, b"patternType=\"").and_then(|val| {
                PatternType::from_ooxml_token(&val).or_else(|| {
                    tracing::warn!(token = %val, "unknown PatternType OOXML token in XLSX; treating attribute as absent");
                    None
                })
            });
            let pattern_type = pattern_type_opt.unwrap_or(PatternType::None);

            // Get the content inside <patternFill>...</patternFill>
            let pf_close = find_closing_tag(fill_content, b"patternFill", pf_start)
                .unwrap_or(fill_content.len());
            let pf_content = &fill_content[pf_open_end..pf_close];

            // Parse <fgColor .../> and <bgColor .../>
            let fg_color = parse_named_color_ref(pf_content, b"fgColor");
            let bg_color = parse_named_color_ref(pf_content, b"bgColor");

            let fill_def = match pattern_type {
                PatternType::None if fg_color.is_none() && bg_color.is_none() => FillDef::None,
                PatternType::Solid => match (fg_color, bg_color) {
                    (Some(fg), None) => FillDef::Solid { fg_color: fg },
                    (fg_color, bg_color) => FillDef::Pattern {
                        pattern_type: Some(PatternType::Solid),
                        fg_color,
                        bg_color,
                    },
                },
                _ => FillDef::Pattern {
                    pattern_type: pattern_type_opt,
                    fg_color,
                    bg_color,
                },
            };

            out.push(fill_def);
        } else if let Some(gf_start) = find_tag_simd(fill_content, b"gradientFill", 0) {
            // Parse <gradientFill>
            let gf_open_end = find_gt_simd(fill_content, gf_start)
                .map(|p| p + 1)
                .unwrap_or(fill_content.len());
            let gf_el = &fill_content[gf_start..gf_open_end];

            let gradient_type = match parse_string_attr(gf_el, b"type=\"") {
                Some(val) => GradientType::from_ooxml(&val),
                None => GradientType::Linear,
            };
            let degree = parse_f64_attr(gf_el, b"degree=\"");
            let left = parse_f64_attr(gf_el, b"left=\"");
            let right = parse_f64_attr(gf_el, b"right=\"");
            let top = parse_f64_attr(gf_el, b"top=\"");
            let bottom = parse_f64_attr(gf_el, b"bottom=\"");

            let gf_close = find_closing_tag(fill_content, b"gradientFill", gf_start)
                .unwrap_or(fill_content.len());
            let gf_content = &fill_content[gf_open_end..gf_close];

            // Parse <stop> children
            let mut stops = Vec::new();
            let mut stop_pos = 0;
            while let Some(stop_start) = find_tag_simd(gf_content, b"stop", stop_pos) {
                let stop_open_end = find_gt_simd(gf_content, stop_start)
                    .map(|p| p + 1)
                    .unwrap_or(gf_content.len());
                let stop_el = &gf_content[stop_start..stop_open_end];
                let position = parse_f64_attr(stop_el, b"position=\"").unwrap_or(0.0);

                let stop_close =
                    find_closing_tag(gf_content, b"stop", stop_start).unwrap_or(gf_content.len());
                let stop_content = &gf_content[stop_open_end..stop_close];

                if let Some(color) = parse_color_ref(stop_content) {
                    stops.push(GradientStop { position, color });
                }

                let close_end = find_gt_simd(gf_content, stop_close)
                    .map(|p| p + 1)
                    .unwrap_or(gf_content.len());
                stop_pos = close_end;
            }

            out.push(FillDef::Gradient {
                gradient_type,
                degree,
                stops,
                left,
                right,
                top,
                bottom,
            });
        } else {
            out.push(FillDef::None);
        }

        let close_end = find_gt_simd(xml, fill_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
}

/// Parse a border side element (e.g., <left style="thin"><color rgb="FF000000"/></left>)
fn parse_border_side(xml: &[u8], tag: &[u8]) -> Option<BorderSideDef> {
    let tag_start = find_tag_simd(xml, tag, 0)?;

    let open_end = find_gt_simd(xml, tag_start)
        .map(|p| p + 1)
        .unwrap_or(xml.len());

    let tag_el = &xml[tag_start..open_end];

    // Parse style attribute
    let style_str = parse_string_attr(tag_el, b"style=\"")
        .or_else(|| parse_string_attr_single_quote(tag_el, b"style='"));

    // Check for self-closing tag
    let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

    // No style attribute means the element is present but unstyled (e.g. <diagonal/>).
    // Return Some(default) so the writer can emit the element — None means absent entirely.
    // Strict parse: unknown tokens log and fall back to BorderStyle::None.
    let style = style_str
        .map(|s| {
            BorderStyle::from_ooxml_token(&s).unwrap_or_else(|| {
                tracing::warn!(token = %s, "unknown BorderStyle OOXML token in XLSX; using None");
                BorderStyle::None
            })
        })
        .unwrap_or(BorderStyle::None);

    // Parse color (if not self-closing)
    let color = if !is_self_closing {
        let close = find_closing_tag(xml, tag, tag_start).unwrap_or(xml.len());
        let content = &xml[open_end..close];
        parse_color_ref(content)
    } else {
        None
    };

    Some(BorderSideDef { style, color })
}

/// Parse the <borders> section
fn parse_borders(out: &mut Vec<BorderDef>, xml: &[u8]) {
    let mut pos = 0;

    // Find each <border> element
    while let Some(border_start) = find_tag_simd(xml, b"border", pos) {
        let border_end = find_closing_tag(xml, b"border", border_start).unwrap_or(xml.len());

        let open_end = find_gt_simd(xml, border_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            out.push(BorderDef::default());
            pos = open_end;
            continue;
        }

        let open_tag = &xml[border_start..open_end];
        let border_content = &xml[open_end..border_end];

        let border_def = BorderDef {
            left: parse_border_side(border_content, b"left"),
            right: parse_border_side(border_content, b"right"),
            top: parse_border_side(border_content, b"top"),
            bottom: parse_border_side(border_content, b"bottom"),
            diagonal: parse_border_side(border_content, b"diagonal"),
            diagonal_up: parse_bool_attr_opt(open_tag, b"diagonalUp=\""),
            diagonal_down: parse_bool_attr_opt(open_tag, b"diagonalDown=\""),
            horizontal: parse_border_side(border_content, b"horizontal"),
            vertical: parse_border_side(border_content, b"vertical"),
            start: parse_border_side(border_content, b"start"),
            end: parse_border_side(border_content, b"end"),
            outline: parse_bool_attr_opt(open_tag, b"outline=\""),
        };

        out.push(border_def);

        let close_end = find_gt_simd(xml, border_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
}

/// Parse the <cellXfs> section
fn parse_cell_xfs(out: &mut Vec<CellXfDef>, xml: &[u8]) {
    let mut pos = 0;

    while let Some(xf_start) = find_tag_simd(xml, b"xf", pos) {
        // Find the end of the opening tag
        let open_end = find_gt_simd(xml, xf_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        // Check if self-closing (<xf .../>)
        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        // Parse attributes from the opening tag via derive
        let raw_attrs = RawCellXfAttrs::xml_parse(&xml[xf_start..open_end]);
        let mut xf = if let Some(r) = raw_attrs {
            CellXfDef {
                num_fmt_id: r.num_fmt_id,
                font_id: r.font_id,
                fill_id: r.fill_id,
                border_id: r.border_id,
                apply_number_format: r.apply_number_format,
                apply_font: r.apply_font,
                apply_fill: r.apply_fill,
                apply_border: r.apply_border,
                xf_id: r.xf_id,
                apply_alignment: r.apply_alignment,
                alignment: None,
                apply_protection: r.apply_protection,
                protection: None,
                quote_prefix: r.quote_prefix.unwrap_or(false),
                pivot_button: r.pivot_button.unwrap_or(false),
                ext_lst: None,
            }
        } else {
            CellXfDef::default()
        };

        if is_self_closing {
            out.push(xf);
            pos = open_end;
            continue;
        }

        // Container element — find closing </xf>
        let xf_end = find_closing_tag(xml, b"xf", xf_start).unwrap_or(xml.len());
        let content = &xml[open_end..xf_end];

        // Parse <alignment .../> child via derive
        if let Some(align_start) = find_tag_simd(content, b"alignment", 0) {
            let align_end = find_gt_simd(content, align_start)
                .map(|p| p + 1)
                .unwrap_or(content.len());
            if let Some(raw) = RawAlignment::xml_parse(&content[align_start..align_end]) {
                xf.alignment = Some(raw.into());
            }
        }

        // Parse <protection .../> child via derive
        if let Some(prot_start) = find_tag_simd(content, b"protection", 0) {
            let prot_end = find_gt_simd(content, prot_start)
                .map(|p| p + 1)
                .unwrap_or(content.len());
            if let Some(raw) = RawProtection::xml_parse(&content[prot_start..prot_end]) {
                xf.protection = Some(raw.into());
            }
        }

        // Parse <extLst>...</extLst> as raw XML passthrough
        if let Some(ext_start) = find_tag_simd(content, b"extLst", 0) {
            let ext_close =
                find_closing_tag(content, b"extLst", ext_start).unwrap_or(content.len());
            let ext_close_end = find_gt_simd(content, ext_close)
                .map(|p| p + 1)
                .unwrap_or(content.len());
            let raw = &content[ext_start..ext_close_end];
            xf.ext_lst = Some(ooxml_types::ExtensionList {
                raw_xml: Some(String::from_utf8_lossy(raw).into_owned()),
            });
        }

        out.push(xf);

        // Advance past closing </xf>
        let close_end = find_gt_simd(xml, xf_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
}

/// Parse the <cellStyles> section
fn parse_cell_styles(xml: &[u8]) -> Vec<CellStyleDef> {
    let mut styles = Vec::new();
    let mut pos = 0;

    while let Some(start) = find_tag_simd(xml, b"cellStyle", pos) {
        let end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());

        if let Some(raw) = RawCellStyle::xml_parse(&xml[start..end]) {
            styles.push(raw.into());
        }
        pos = end;
    }
    styles
}

/// Parse a boolean element like `<strike/>`, `<strike val="0"/>`, or `<strike val="1"/>`.
/// Returns `Some(true)` for bare element or `val="1"/"true"`, `Some(false)` for `val="0"/"false"`,
/// `None` if the element is absent.
fn parse_optional_bool_element(xml: &[u8], tag: &[u8]) -> Option<bool> {
    let pos = find_tag_simd(xml, tag, 0)?;
    let el_end = find_gt_simd(xml, pos).map(|g| g + 1).unwrap_or(xml.len());
    Some(parse_bool_attr_with_default(
        &xml[pos..el_end],
        b"val=\"",
        true,
    ))
}

/// Parse a single <font>...</font> block into a FontDef (for use inside <dxf>).
fn parse_single_font(xml: &[u8]) -> FontDef {
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

/// Parse a single <fill>...</fill> block into a FillDef (for use inside <dxf>).
fn parse_single_fill(xml: &[u8]) -> FillDef {
    // Try <patternFill> first
    if let Some(pf_start) = find_tag_simd(xml, b"patternFill", 0) {
        let pf_open_end = find_gt_simd(xml, pf_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let pf_el = &xml[pf_start..pf_open_end];

        let pattern_type_opt = parse_string_attr(pf_el, b"patternType=\"").and_then(|val| {
            PatternType::from_ooxml_token(&val).or_else(|| {
                tracing::warn!(token = %val, "unknown PatternType OOXML token in XLSX; treating attribute as absent");
                None
            })
        });
        let pattern_type = pattern_type_opt.unwrap_or(PatternType::None);

        let pf_close = find_closing_tag(xml, b"patternFill", pf_start).unwrap_or(xml.len());
        let pf_content = &xml[pf_open_end..pf_close];

        let fg_color = parse_named_color_ref(pf_content, b"fgColor");
        let bg_color = parse_named_color_ref(pf_content, b"bgColor");

        return match pattern_type {
            PatternType::None if fg_color.is_none() && bg_color.is_none() => FillDef::None,
            PatternType::Solid => match (fg_color, bg_color) {
                (Some(fg), None) => FillDef::Solid { fg_color: fg },
                (fg_color, bg_color) => FillDef::Pattern {
                    pattern_type: Some(PatternType::Solid),
                    fg_color,
                    bg_color,
                },
            },
            _ => FillDef::Pattern {
                pattern_type: pattern_type_opt,
                fg_color,
                bg_color,
            },
        };
    }
    FillDef::None
}

/// Parse a single <border>...</border> block into a BorderDef (for use inside <dxf>).
fn parse_single_border(xml: &[u8]) -> BorderDef {
    let open_end = find_gt_simd(xml, 0).map(|p| p + 1).unwrap_or(xml.len());

    let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';
    if is_self_closing {
        return BorderDef::default();
    }

    let open_tag = &xml[0..open_end];
    let border_end = find_closing_tag(xml, b"border", 0).unwrap_or(xml.len());
    let border_content = &xml[open_end..border_end];

    BorderDef {
        left: parse_border_side(border_content, b"left"),
        right: parse_border_side(border_content, b"right"),
        top: parse_border_side(border_content, b"top"),
        bottom: parse_border_side(border_content, b"bottom"),
        diagonal: parse_border_side(border_content, b"diagonal"),
        diagonal_up: parse_bool_attr_opt(open_tag, b"diagonalUp=\""),
        diagonal_down: parse_bool_attr_opt(open_tag, b"diagonalDown=\""),
        horizontal: parse_border_side(border_content, b"horizontal"),
        vertical: parse_border_side(border_content, b"vertical"),
        start: parse_border_side(border_content, b"start"),
        end: parse_border_side(border_content, b"end"),
        outline: parse_bool_attr_opt(open_tag, b"outline=\""),
    }
}

/// Parse an <alignment .../> element into an AlignmentDef.
fn parse_single_alignment(xml: &[u8]) -> AlignmentDef {
    if let Some(align_start) = find_tag_simd(xml, b"alignment", 0) {
        let align_end = find_gt_simd(xml, align_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        RawAlignment::xml_parse(&xml[align_start..align_end])
            .map(AlignmentDef::from)
            .unwrap_or_default()
    } else {
        AlignmentDef::default()
    }
}

/// Parse a <protection .../> element into a ProtectionDef.
fn parse_single_protection(xml: &[u8]) -> ProtectionDef {
    if let Some(prot_start) = find_tag_simd(xml, b"protection", 0) {
        let prot_end = find_gt_simd(xml, prot_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        RawProtection::xml_parse(&xml[prot_start..prot_end])
            .map(ProtectionDef::from)
            .unwrap_or_default()
    } else {
        ProtectionDef::default()
    }
}

/// Parse the <dxfs> section
fn parse_dxfs(xml: &[u8]) -> Vec<DxfDef> {
    let mut dxfs = Vec::new();
    let mut pos = 0;

    while let Some(dxf_start) = find_tag_simd(xml, b"dxf", pos) {
        let open_end = find_gt_simd(xml, dxf_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            dxfs.push(DxfDef::default());
            pos = open_end;
            continue;
        }

        let dxf_end = find_closing_tag(xml, b"dxf", dxf_start).unwrap_or(xml.len());
        let dxf_content = &xml[open_end..dxf_end];

        let mut dxf = DxfDef::default();

        // Parse optional font
        if let Some(font_start) = find_tag_simd(dxf_content, b"font", 0) {
            let font_end =
                find_closing_tag(dxf_content, b"font", font_start).unwrap_or(dxf_content.len());
            let font_open_end = find_gt_simd(dxf_content, font_start)
                .map(|p| p + 1)
                .unwrap_or(dxf_content.len());
            dxf.font = Some(parse_single_font(&dxf_content[font_open_end..font_end]));
        }

        // Parse optional numFmt
        if let Some(nf_start) = find_tag_simd(dxf_content, b"numFmt", 0) {
            let nf_end = find_gt_simd(dxf_content, nf_start)
                .map(|p| p + 1)
                .unwrap_or(dxf_content.len());
            let tag = &dxf_content[nf_start..nf_end];
            if let (Some(id), Some(code)) = (
                parse_u32_attr(tag, b"numFmtId=\""),
                parse_string_attr(tag, b"formatCode=\""),
            ) {
                dxf.num_fmt = Some(NumberFormatDef {
                    id,
                    format_code: code,
                });
            }
        }

        // Parse optional fill
        if let Some(fill_start) = find_tag_simd(dxf_content, b"fill", 0) {
            let fill_end =
                find_closing_tag(dxf_content, b"fill", fill_start).unwrap_or(dxf_content.len());
            let fill_open_end = find_gt_simd(dxf_content, fill_start)
                .map(|p| p + 1)
                .unwrap_or(dxf_content.len());
            let fill = parse_single_fill(&dxf_content[fill_open_end..fill_end]);
            // In DXFs, even a "none" fill is meaningful — it means "explicitly no fill"
            // which differs from the fill being absent (not specified). Preserve it.
            dxf.fill = Some(fill);
        }

        // Parse optional border
        if let Some(border_start) = find_tag_simd(dxf_content, b"border", 0) {
            let border_end =
                find_closing_tag(dxf_content, b"border", border_start).unwrap_or(dxf_content.len());
            dxf.border = Some(parse_single_border(&dxf_content[border_start..border_end]));
        }

        // Parse optional alignment
        if find_tag_simd(dxf_content, b"alignment", 0).is_some() {
            dxf.alignment = Some(parse_single_alignment(dxf_content));
        }

        // Parse optional protection
        if find_tag_simd(dxf_content, b"protection", 0).is_some() {
            dxf.protection = Some(parse_single_protection(dxf_content));
        }

        dxfs.push(dxf);

        let close_end = find_gt_simd(xml, dxf_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }
    dxfs
}

/// Parse the <colors> section
fn parse_colors(xml: &[u8]) -> ColorsDef {
    let mut colors = ColorsDef::default();

    // Parse <indexedColors>
    if let Some(ic_start) = find_tag_simd(xml, b"indexedColors", 0) {
        let ic_end = find_closing_tag(xml, b"indexedColors", ic_start).unwrap_or(xml.len());
        let ic_open_end = find_gt_simd(xml, ic_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let ic_content = &xml[ic_open_end..ic_end];
        let mut pos = 0;
        while let Some(start) = find_tag_simd(ic_content, b"rgbColor", pos) {
            let end = find_gt_simd(ic_content, start)
                .map(|p| p + 1)
                .unwrap_or(ic_content.len());
            let tag = &ic_content[start..end];
            if let Some(rgb) = parse_string_attr(tag, b"rgb=\"") {
                colors.indexed_colors.push(rgb);
            }
            pos = end;
        }
    }

    // Parse <mruColors>
    if let Some(mru_start) = find_tag_simd(xml, b"mruColors", 0) {
        let mru_end = find_closing_tag(xml, b"mruColors", mru_start).unwrap_or(xml.len());
        let mru_open_end = find_gt_simd(xml, mru_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let mru_content = &xml[mru_open_end..mru_end];
        let mut pos = 0;
        while let Some(start) = find_tag_simd(mru_content, b"color", pos) {
            let end = find_gt_simd(mru_content, start)
                .map(|p| p + 1)
                .unwrap_or(mru_content.len());
            let tag = &mru_content[start..end];
            if let Some(rgb) = parse_string_attr(tag, b"rgb=\"") {
                colors.mru_colors.push(ColorDef::rgb(&rgb));
            }
            pos = end;
        }
    }

    colors
}

/// Parse the <tableStyles> section.
///
/// Returns (styles, default_table_style, default_pivot_style).
fn parse_table_styles(xml: &[u8]) -> (Vec<TableStyleDef>, Option<String>, Option<String>) {
    // Parse container attrs from <tableStyles count="..." defaultTableStyle="..." defaultPivotStyle="...">
    let container_end = find_gt_simd(xml, 0).map(|p| p + 1).unwrap_or(xml.len());
    let container_tag = &xml[0..container_end];
    let default_table = parse_string_attr(container_tag, b"defaultTableStyle=\"");
    let default_pivot = parse_string_attr(container_tag, b"defaultPivotStyle=\"");

    let mut styles = Vec::new();
    let mut pos = container_end;

    while let Some(start) = find_tag_simd(xml, b"tableStyle", pos) {
        let open_end = find_gt_simd(xml, start).map(|p| p + 1).unwrap_or(xml.len());

        // Parse container attributes via derive
        let raw = RawTableStyle::xml_parse(&xml[start..open_end]);
        let (name, pivot, table, count, xr_uid) = if let Some(r) = raw {
            (
                r.name.unwrap_or_default(),
                r.pivot,
                r.table,
                r.count,
                r.xr_uid,
            )
        } else {
            (String::new(), None, None, None, None)
        };

        let is_self_closing = open_end >= 2 && xml[open_end - 2] == b'/';

        if is_self_closing {
            styles.push(TableStyleDef {
                name,
                pivot,
                table,
                count,
                elements: Vec::new(),
                xr_uid,
            });
            pos = open_end;
            continue;
        }

        // Find closing tag for this tableStyle
        let style_end = find_closing_tag(xml, b"tableStyle", start).unwrap_or(xml.len());
        let style_content = &xml[open_end..style_end];

        // Parse <tableStyleElement> children via derive
        let mut elements = Vec::new();
        let mut elem_pos = 0;
        while let Some(elem_start) = find_tag_simd(style_content, b"tableStyleElement", elem_pos) {
            let elem_end = find_gt_simd(style_content, elem_start)
                .map(|p| p + 1)
                .unwrap_or(style_content.len());

            if let Some(raw_elem) =
                RawTableStyleElement::xml_parse(&style_content[elem_start..elem_end])
            {
                if let Some(type_str) = &raw_elem.style_type {
                    if let Some(style_type) = TableStyleType::from_ooxml(type_str) {
                        elements.push(TableStyleElementDef {
                            style_type,
                            dxf_id: raw_elem.dxf_id,
                            size: raw_elem.size,
                        });
                    }
                }
            }
            elem_pos = elem_end;
        }

        styles.push(TableStyleDef {
            name,
            pivot,
            table,
            count,
            elements,
            xr_uid,
        });

        let close_end = find_gt_simd(xml, style_end)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        pos = close_end;
    }

    (styles, default_table, default_pivot)
}

// =============================================================================
// Date format helpers
// =============================================================================

/// Check if a number format ID is a built-in date format
fn is_builtin_date_format(id: u32) -> bool {
    matches!(id,
        // Standard date formats
        14..=22 |
        // Asian date formats (CJK specific)
        27..=36 |
        // Time formats
        45..=47 |
        // Additional Asian date formats
        50..=58
    )
}

/// Check if a format code string represents a date/time format
fn is_date_format_code(format_code: &str) -> bool {
    // Date patterns to look for (case insensitive check)
    let code_lower = format_code.to_lowercase();

    // Skip if it contains color codes or conditions that might confuse us
    // but still check for date patterns

    // Common date/time indicators
    let date_indicators = [
        "yyyy", "yy", "mmm", "mmmm", "dd", "d/", "/d", "h:mm", "hh:", "mm:ss", "am/pm", "a/p",
    ];

    for indicator in date_indicators {
        if code_lower.contains(indicator) {
            return true;
        }
    }

    // Check for standalone month patterns (m or mm) when combined with other date elements
    // This is trickier because 'm' alone could be minutes in a time format
    // We look for patterns like "m/d" or "d/m" or "m-d" etc.
    let has_date_separator = code_lower.contains('/') || code_lower.contains('-');
    if has_date_separator {
        // Check for month indicators followed by separator or day
        if code_lower.contains("m/")
            || code_lower.contains("/m")
            || code_lower.contains("m-")
            || code_lower.contains("-m")
        {
            return true;
        }
    }

    false
}

/// Built-in number format codes (Excel standard)
///
/// Excel has built-in formats with IDs 0-49. Custom formats start at 164.
/// Not all IDs in the 0-49 range are used; some are reserved.
pub fn builtin_format(id: u32) -> Option<&'static str> {
    match id {
        0 => Some("General"),
        1 => Some("0"),
        2 => Some("0.00"),
        3 => Some("#,##0"),
        4 => Some("#,##0.00"),
        5 => Some("$#,##0_);($#,##0)"),
        6 => Some("$#,##0_);[Red]($#,##0)"),
        7 => Some("$#,##0.00_);($#,##0.00)"),
        8 => Some("$#,##0.00_);[Red]($#,##0.00)"),
        9 => Some("0%"),
        10 => Some("0.00%"),
        11 => Some("0.00E+00"),
        12 => Some("# ?/?"),
        13 => Some("# ??/??"),
        14 => Some("m/d/yyyy"),
        15 => Some("d-mmm-yy"),
        16 => Some("d-mmm"),
        17 => Some("mmm-yy"),
        18 => Some("h:mm AM/PM"),
        19 => Some("h:mm:ss AM/PM"),
        20 => Some("h:mm"),
        21 => Some("h:mm:ss"),
        22 => Some("m/d/yyyy h:mm"),
        // 23-26 are reserved
        // 27-36 are CJK-specific date formats (we mark as date but don't have exact format)
        27 => Some("[$-404]e/m/d"),
        28 => Some("[$-404]e\"年\"m\"月\"d\"日\""),
        29 => Some("[$-404]e\"年\"m\"月\"d\"日\""),
        30 => Some("m/d/yy"),
        31 => Some("yyyy\"年\"m\"月\"d\"日\""),
        32 => Some("h\"時\"mm\"分\""),
        33 => Some("h\"時\"mm\"分\"ss\"秒\""),
        34 => Some("yyyy\"年\"m\"月\""),
        35 => Some("m\"月\"d\"日\""),
        36 => Some("[$-404]e/m/d"),
        37 => Some("#,##0_);(#,##0)"),
        38 => Some("#,##0_);[Red](#,##0)"),
        39 => Some("#,##0.00_);(#,##0.00)"),
        40 => Some("#,##0.00_);[Red](#,##0.00)"),
        // 41-44 are accounting formats
        41 => Some("_(* #,##0_);_(* (#,##0);_(* \"-\"_);_(@_)"),
        42 => Some("_($* #,##0_);_($* (#,##0);_($* \"-\"_);_(@_)"),
        43 => Some("_(* #,##0.00_);_(* (#,##0.00);_(* \"-\"??_);_(@_)"),
        44 => Some("_($* #,##0.00_);_($* (#,##0.00);_($* \"-\"??_);_(@_)"),
        45 => Some("mm:ss"),
        46 => Some("[h]:mm:ss"),
        47 => Some("mm:ss.0"),
        48 => Some("##0.0E+0"),
        49 => Some("@"),
        // 50-58 are additional CJK formats
        50 => Some("[$-404]e/m/d"),
        51 => Some("[$-404]e\"年\"m\"月\"d\"日\""),
        52 => Some("yyyy\"年\"m\"月\""),
        53 => Some("m\"月\"d\"日\""),
        54 => Some("[$-404]e\"年\"m\"月\"d\"日\""),
        55 => Some("yyyy\"年\"m\"月\""),
        56 => Some("m\"月\"d\"日\""),
        57 => Some("[$-404]e/m/d"),
        58 => Some("[$-404]e\"年\"m\"月\"d\"日\""),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infra::xml::decode_xml_entities;

    #[test]
    fn test_parse_empty_styles() {
        let xml = b"<?xml version=\"1.0\"?><styleSheet></styleSheet>";
        let styles = parse_styles(xml);
        assert!(styles.num_fmts.is_empty());
        assert!(styles.cell_xfs.is_empty());
    }

    #[test]
    fn test_parse_num_fmts() {
        let xml = br###"<?xml version="1.0"?>
<styleSheet>
    <numFmts count="2">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
        <numFmt numFmtId="165" formatCode="#,##0.000"/>
    </numFmts>
</styleSheet>"###;

        let styles = parse_styles(xml);
        assert_eq!(styles.num_fmts.len(), 2);

        assert_eq!(styles.num_fmts[0].id, 164);
        assert_eq!(styles.num_fmts[0].format_code, "yyyy-mm-dd");

        assert_eq!(styles.num_fmts[1].id, 165);
        assert_eq!(styles.num_fmts[1].format_code, "#,##0.000");
    }

    #[test]
    fn test_parse_cell_xfs() {
        let xml = br#"<?xml version="1.0"?>
<styleSheet>
    <cellXfs count="3">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
        <xf numFmtId="14" fontId="1" fillId="0" borderId="0" applyNumberFormat="1"/>
        <xf numFmtId="164" fontId="0" fillId="1" borderId="1" applyNumberFormat="true"/>
    </cellXfs>
</styleSheet>"#;

        let styles = parse_styles(xml);
        assert_eq!(styles.cell_xfs.len(), 3);

        // Default style
        assert_eq!(styles.cell_xfs[0].num_fmt_id, Some(0));
        assert_eq!(styles.cell_xfs[0].font_id, Some(0));
        assert_eq!(styles.cell_xfs[0].apply_number_format, None);

        // Date style (built-in format 14)
        assert_eq!(styles.cell_xfs[1].num_fmt_id, Some(14));
        assert_eq!(styles.cell_xfs[1].font_id, Some(1));
        assert_eq!(styles.cell_xfs[1].apply_number_format, Some(true));

        // Custom format style
        assert_eq!(styles.cell_xfs[2].num_fmt_id, Some(164));
        assert_eq!(styles.cell_xfs[2].fill_id, Some(1));
        assert_eq!(styles.cell_xfs[2].border_id, Some(1));
        assert_eq!(styles.cell_xfs[2].apply_number_format, Some(true));
    }

    #[test]
    fn test_get_number_format_builtin() {
        let xml = br#"<styleSheet>
    <cellXfs count="2">
        <xf numFmtId="0"/>
        <xf numFmtId="14"/>
    </cellXfs>
</styleSheet>"#;

        let styles = parse_styles(xml);

        assert_eq!(get_number_format(&styles, 0), Some("General"));
        assert_eq!(get_number_format(&styles, 1), Some("m/d/yyyy"));
    }

    #[test]
    fn test_get_number_format_custom() {
        let xml = br#"<styleSheet>
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/>
    </numFmts>
    <cellXfs count="2">
        <xf numFmtId="0"/>
        <xf numFmtId="164"/>
    </cellXfs>
</styleSheet>"#;

        let styles = parse_styles(xml);

        assert_eq!(get_number_format(&styles, 0), Some("General"));
        assert_eq!(get_number_format(&styles, 1), Some("yyyy-mm-dd hh:mm:ss"));
    }

    #[test]
    fn test_get_number_format_invalid_index() {
        let xml = br#"<styleSheet>
    <cellXfs count="1">
        <xf numFmtId="0"/>
    </cellXfs>
</styleSheet>"#;

        let styles = parse_styles(xml);
        assert_eq!(get_number_format(&styles, 99), None);
    }

    #[test]
    fn test_is_date_format_builtin() {
        let xml = br#"<styleSheet>
    <cellXfs count="5">
        <xf numFmtId="0"/>
        <xf numFmtId="14"/>
        <xf numFmtId="22"/>
        <xf numFmtId="45"/>
        <xf numFmtId="4"/>
    </cellXfs>
</styleSheet>"#;

        let styles = parse_styles(xml);

        assert!(!is_date_format(&styles, 0), "General should not be date");
        assert!(is_date_format(&styles, 1), "m/d/yyyy should be date");
        assert!(is_date_format(&styles, 2), "m/d/yyyy h:mm should be date");
        assert!(is_date_format(&styles, 3), "mm:ss should be date/time");
        assert!(!is_date_format(&styles, 4), "#,##0.00 should not be date");
    }

    #[test]
    fn test_is_date_format_custom() {
        let xml = br###"<styleSheet>
    <numFmts count="3">
        <numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>
        <numFmt numFmtId="165" formatCode="#,##0.00"/>
        <numFmt numFmtId="166" formatCode="h:mm AM/PM"/>
    </numFmts>
    <cellXfs count="3">
        <xf numFmtId="164"/>
        <xf numFmtId="165"/>
        <xf numFmtId="166"/>
    </cellXfs>
</styleSheet>"###;

        let styles = parse_styles(xml);

        assert!(is_date_format(&styles, 0), "yyyy-mm-dd should be date");
        assert!(!is_date_format(&styles, 1), "#,##0.00 should not be date");
        assert!(is_date_format(&styles, 2), "h:mm AM/PM should be time/date");
    }

    #[test]
    fn test_builtin_format_coverage() {
        // Test key built-in formats
        assert_eq!(builtin_format(0), Some("General"));
        assert_eq!(builtin_format(1), Some("0"));
        assert_eq!(builtin_format(14), Some("m/d/yyyy"));
        assert_eq!(builtin_format(22), Some("m/d/yyyy h:mm"));
        assert_eq!(builtin_format(49), Some("@"));

        // Unknown format
        assert_eq!(builtin_format(100), None);
        assert_eq!(builtin_format(164), None); // Custom formats start here
    }

    #[test]
    fn test_is_builtin_date_format() {
        // Date formats
        assert!(is_builtin_date_format(14));
        assert!(is_builtin_date_format(15));
        assert!(is_builtin_date_format(22));
        assert!(is_builtin_date_format(27));
        assert!(is_builtin_date_format(45));
        assert!(is_builtin_date_format(50));

        // Non-date formats
        assert!(!is_builtin_date_format(0));
        assert!(!is_builtin_date_format(1));
        assert!(!is_builtin_date_format(9));
        assert!(!is_builtin_date_format(37));
        assert!(!is_builtin_date_format(49));
    }

    #[test]
    fn test_is_date_format_code() {
        // Date formats
        assert!(is_date_format_code("yyyy-mm-dd"));
        assert!(is_date_format_code("m/d/yyyy"));
        assert!(is_date_format_code("d-mmm-yy"));
        assert!(is_date_format_code("mmm yyyy"));
        assert!(is_date_format_code("h:mm:ss"));
        assert!(is_date_format_code("h:mm AM/PM"));

        // Non-date formats
        assert!(!is_date_format_code("General"));
        assert!(!is_date_format_code("#,##0.00"));
        assert!(!is_date_format_code("0%"));
        assert!(!is_date_format_code("@"));
    }

    #[test]
    fn test_decode_xml_entities() {
        assert_eq!(decode_xml_entities(b"hello"), "hello");
        assert_eq!(decode_xml_entities(b"&lt;tag&gt;"), "<tag>");
        assert_eq!(decode_xml_entities(b"&amp;"), "&");
        assert_eq!(decode_xml_entities(b"&quot;text&quot;"), "\"text\"");
        assert_eq!(decode_xml_entities(b"&apos;"), "'");
        assert_eq!(
            decode_xml_entities(b"a &lt; b &amp;&amp; c &gt; d"),
            "a < b && c > d"
        );
    }

    #[test]
    fn test_parse_with_xml_entities_in_format() {
        let xml = br##"<styleSheet>
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/>
    </numFmts>
</styleSheet>"##;

        let styles = parse_styles(xml);
        assert_eq!(styles.num_fmts.len(), 1);
        assert_eq!(styles.num_fmts[0].format_code, "\"$\"#,##0");
    }

    #[test]
    fn test_parse_numfmt_with_gt_lt_in_formatcode() {
        // Regression: formatCode with literal > and &lt; was being truncated
        let xml = br#"<styleSheet>
    <numFmts count="3">
        <numFmt numFmtId="251" formatCode="0.00\%;\-0.00\%;0.00\%"/>
        <numFmt numFmtId="252" formatCode="[Red][>0.05]\ 0%;[Red][&lt;-0.05]\ 0%;0%"/>
        <numFmt numFmtId="253" formatCode="0.00;\-0.00;0.00"/>
    </numFmts>
</styleSheet>"#;

        let styles = parse_styles(xml);
        assert_eq!(styles.num_fmts.len(), 3);
        assert_eq!(styles.num_fmts[0].id, 251);
        assert_eq!(styles.num_fmts[1].id, 252);
        assert_eq!(
            styles.num_fmts[1].format_code,
            r"[Red][>0.05]\ 0%;[Red][<-0.05]\ 0%;0%"
        );
        assert_eq!(styles.num_fmts[2].id, 253);
        assert_eq!(styles.num_fmts[2].format_code, r"0.00;\-0.00;0.00");
    }

    #[test]
    fn test_realistic_styles_xml() {
        // A more realistic styles.xml structure
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy\-mm\-dd"/>
    </numFmts>
    <fonts count="2">
        <font><sz val="11"/><name val="Calibri"/></font>
        <font><b/><sz val="11"/><name val="Calibri"/></font>
    </fonts>
    <fills count="2">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
    </fills>
    <borders count="1">
        <border><left/><right/><top/><bottom/><diagonal/></border>
    </borders>
    <cellStyleXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    </cellStyleXfs>
    <cellXfs count="4">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
        <xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
        <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    </cellXfs>
</styleSheet>"#;

        let styles = parse_styles(xml);

        // Check number formats
        assert_eq!(styles.num_fmts.len(), 1);
        assert_eq!(styles.num_fmts[0].id, 164);

        // Check cell styles
        assert_eq!(styles.cell_xfs.len(), 4);

        // Style 0: Default
        assert!(!is_date_format(&styles, 0));

        // Style 1: Bold (no number format change)
        assert!(!is_date_format(&styles, 1));

        // Style 2: Built-in date format
        assert!(is_date_format(&styles, 2));
        assert_eq!(get_number_format(&styles, 2), Some("m/d/yyyy"));

        // Style 3: Custom date format
        assert!(is_date_format(&styles, 3));
    }

    #[test]
    fn test_parse_cell_xfs_with_alignment() {
        let xml = br#"<cellXfs count="2">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1">
                <alignment horizontal="center" vertical="center" wrapText="1"/>
            </xf>
            <xf numFmtId="0" fontId="1" fillId="0" borderId="0"/>
        </cellXfs>"#;
        let mut styles = Stylesheet::default();
        parse_cell_xfs(&mut styles.cell_xfs, xml);
        assert_eq!(styles.cell_xfs.len(), 2);

        let xf = &styles.cell_xfs[0];
        assert_eq!(xf.apply_alignment, Some(true));
        let align = xf.alignment.as_ref().unwrap();
        assert_eq!(align.horizontal, Some(HorizontalAlign::Center));
        assert_eq!(align.vertical, Some(VerticalAlign::Center));
        assert_eq!(align.wrap_text, Some(true));

        let xf2 = &styles.cell_xfs[1];
        assert_eq!(xf2.apply_alignment, None);
        assert!(xf2.alignment.is_none());
    }

    #[test]
    fn test_parse_cell_xfs_with_protection() {
        let xml = br#"<cellXfs count="1">
            <xf numFmtId="0" fontId="0" fillId="0" borderId="0" applyProtection="1">
                <protection locked="0" hidden="1"/>
            </xf>
        </cellXfs>"#;
        let mut styles = Stylesheet::default();
        parse_cell_xfs(&mut styles.cell_xfs, xml);
        assert_eq!(styles.cell_xfs.len(), 1);

        let xf = &styles.cell_xfs[0];
        assert_eq!(xf.apply_protection, Some(true));
        let prot = xf.protection.as_ref().unwrap();
        assert_eq!(prot.locked, Some(false));
        assert_eq!(prot.hidden, Some(true));
    }

    #[test]
    fn test_parse_cell_xfs_self_closing() {
        let xml = br#"<cellXfs count="1">
            <xf numFmtId="164" fontId="2" fillId="3" borderId="1" applyFont="1"/>
        </cellXfs>"#;
        let mut styles = Stylesheet::default();
        parse_cell_xfs(&mut styles.cell_xfs, xml);
        assert_eq!(styles.cell_xfs.len(), 1);
        assert_eq!(styles.cell_xfs[0].num_fmt_id, Some(164));
        assert!(styles.cell_xfs[0].alignment.is_none());
        assert!(styles.cell_xfs[0].protection.is_none());
    }

    #[test]
    fn test_parse_font_vert_align() {
        let xml = br#"<fonts count="1">
            <font>
                <sz val="11"/>
                <name val="Calibri"/>
                <vertAlign val="superscript"/>
            </font>
        </fonts>"#;
        let mut styles = Stylesheet::default();
        parse_fonts(&mut styles.fonts, xml);
        assert_eq!(styles.fonts.len(), 1);
        assert_eq!(
            styles.fonts[0].vert_align,
            Some(VerticalAlignRun::Superscript)
        );
    }

    #[test]
    fn test_parse_font_no_vert_align() {
        let xml = br#"<fonts count="1">
            <font>
                <sz val="11"/>
                <name val="Calibri"/>
            </font>
        </fonts>"#;
        let mut styles = Stylesheet::default();
        parse_fonts(&mut styles.fonts, xml);
        assert_eq!(styles.fonts.len(), 1);
        assert!(styles.fonts[0].vert_align.is_none());
    }

    #[test]
    fn test_parse_cell_style_xfs() {
        let xml = br#"<styleSheet>
    <cellStyleXfs count="2">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
        <xf numFmtId="9" fontId="1" fillId="0" borderId="0"/>
    </cellStyleXfs>
</styleSheet>"#;
        let styles = parse_styles(xml);
        assert_eq!(styles.cell_style_xfs.len(), 2);
        assert_eq!(styles.cell_style_xfs[0].num_fmt_id, Some(0));
        assert_eq!(styles.cell_style_xfs[1].num_fmt_id, Some(9));
        assert_eq!(styles.cell_style_xfs[1].font_id, Some(1));
    }

    #[test]
    fn test_parse_cell_styles_section() {
        let xml = b"<cellStyles count=\"2\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/><cellStyle name=\"Percent\" xfId=\"1\" builtinId=\"5\"/></cellStyles>";
        let result = parse_cell_styles(xml);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].effective_name(), "Normal");
        assert_eq!(result[0].xf_id, 0);
        assert_eq!(result[0].builtin_id, Some(0));
        assert!(!result[0].effective_custom_builtin());
        assert_eq!(result[1].effective_name(), "Percent");
        assert_eq!(result[1].xf_id, 1);
        assert_eq!(result[1].builtin_id, Some(5));
    }

    #[test]
    fn test_parse_cell_styles_with_custom_builtin() {
        let xml = b"<cellStyles count=\"1\"><cellStyle name=\"MyStyle\" xfId=\"2\" builtinId=\"3\" customBuiltin=\"1\"/></cellStyles>";
        let result = parse_cell_styles(xml);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].effective_name(), "MyStyle");
        assert!(result[0].effective_custom_builtin());
    }

    #[test]
    fn test_parse_dxfs_section() {
        let xml = b"<dxfs count=\"1\"><dxf><font><b/><color rgb=\"FFFF0000\"/></font></dxf></dxfs>";
        let result = parse_dxfs(xml);
        assert_eq!(result.len(), 1);
        let dxf = &result[0];
        assert!(dxf.font.is_some());
        let font = dxf.font.as_ref().unwrap();
        assert_eq!(font.bold, Some(true));
        assert!(matches!(font.color, Some(ColorDef::Rgb { ref val, .. }) if val == "FFFF0000"));
    }

    #[test]
    fn test_parse_dxfs_with_numfmt() {
        let xml = br##"<dxfs count="1"><dxf><numFmt numFmtId="164" formatCode="#,##0.00"/></dxf></dxfs>"##;
        let result = parse_dxfs(xml);
        assert_eq!(result.len(), 1);
        let nf = result[0].num_fmt.as_ref().unwrap();
        assert_eq!(nf.id, 164);
        assert_eq!(nf.format_code, "#,##0.00");
    }

    #[test]
    fn test_parse_dxfs_empty() {
        let xml = b"<dxfs count=\"1\"><dxf/></dxfs>";
        let result = parse_dxfs(xml);
        assert_eq!(result.len(), 1);
        assert!(result[0].font.is_none());
        assert!(result[0].num_fmt.is_none());
        assert!(result[0].fill.is_none());
        assert!(result[0].border.is_none());
    }

    #[test]
    fn test_parse_colors_section() {
        let xml = b"<colors><indexedColors><rgbColor rgb=\"FF000000\"/><rgbColor rgb=\"FFFFFFFF\"/></indexedColors><mruColors><color rgb=\"FFFF0000\"/></mruColors></colors>";
        let result = parse_colors(xml);
        assert_eq!(result.indexed_colors.len(), 2);
        assert_eq!(result.indexed_colors[0], "FF000000");
        assert_eq!(result.indexed_colors[1], "FFFFFFFF");
        assert_eq!(result.mru_colors.len(), 1);
        assert_eq!(result.mru_colors[0], ColorDef::rgb("FFFF0000"));
    }

    #[test]
    fn test_parse_colors_empty() {
        let xml = b"<colors></colors>";
        let result = parse_colors(xml);
        assert!(result.indexed_colors.is_empty());
        assert!(result.mru_colors.is_empty());
    }

    #[test]
    fn test_parse_table_styles_section() {
        let xml = br#"<tableStyles count="1" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"><tableStyle name="TableStyleMedium2" pivot="0" count="2"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="firstRowStripe" dxfId="1" size="1"/></tableStyle></tableStyles>"#;
        let (styles, default_table, default_pivot) = parse_table_styles(xml);
        assert_eq!(styles.len(), 1);
        assert_eq!(styles[0].name, "TableStyleMedium2");
        assert_eq!(styles[0].pivot, Some(false));
        assert_eq!(styles[0].count, Some(2));
        assert_eq!(styles[0].elements.len(), 2);
        assert_eq!(styles[0].elements[0].style_type, TableStyleType::WholeTable);
        assert_eq!(styles[0].elements[0].dxf_id, Some(0));
        assert_eq!(
            styles[0].elements[1].style_type,
            TableStyleType::FirstRowStripe
        );
        assert_eq!(styles[0].elements[1].dxf_id, Some(1));
        assert_eq!(styles[0].elements[1].size, Some(1));
        assert_eq!(default_table, Some("TableStyleMedium2".to_string()));
        assert_eq!(default_pivot, Some("PivotStyleLight16".to_string()));
    }

    #[test]
    fn test_parse_full_stylesheet_with_new_sections() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <numFmts count="1">
        <numFmt numFmtId="164" formatCode="yyyy\-mm\-dd"/>
    </numFmts>
    <fonts count="1">
        <font><sz val="11"/><name val="Calibri"/></font>
    </fonts>
    <fills count="1">
        <fill><patternFill patternType="none"/></fill>
    </fills>
    <borders count="1">
        <border><left/><right/><top/><bottom/><diagonal/></border>
    </borders>
    <cellStyleXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    </cellStyleXfs>
    <cellXfs count="1">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    </cellXfs>
    <cellStyles count="1">
        <cellStyle name="Normal" xfId="0" builtinId="0"/>
    </cellStyles>
    <dxfs count="1">
        <dxf><font><b/></font></dxf>
    </dxfs>
    <colors>
        <mruColors><color rgb="FF00FF00"/></mruColors>
    </colors>
    <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>"#;

        let styles = parse_styles(xml);

        // Existing sections still work
        assert_eq!(styles.num_fmts.len(), 1);
        assert_eq!(styles.fonts.len(), 1);
        assert_eq!(styles.cell_xfs.len(), 1);

        // New sections
        assert_eq!(styles.cell_style_xfs.len(), 1);
        assert_eq!(styles.cell_style_xfs[0].num_fmt_id, Some(0));

        assert_eq!(styles.cell_styles.len(), 1);
        assert_eq!(styles.cell_styles[0].effective_name(), "Normal");
        assert_eq!(styles.cell_styles[0].builtin_id, Some(0));

        assert_eq!(styles.dxfs.len(), 1);
        assert!(styles.dxfs[0].font.is_some());
        assert_eq!(styles.dxfs[0].font.as_ref().unwrap().bold, Some(true));

        let colors = styles.colors.as_ref().unwrap();
        assert_eq!(colors.mru_colors.len(), 1);
        assert_eq!(colors.mru_colors[0], ColorDef::rgb("FF00FF00"));

        assert_eq!(
            styles.default_table_style,
            Some("TableStyleMedium2".to_string())
        );
        assert_eq!(
            styles.default_pivot_style,
            Some("PivotStyleLight16".to_string())
        );
    }
}
