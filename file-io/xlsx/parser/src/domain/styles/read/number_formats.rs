use crate::infra::scanner::{find_element_end, find_tag_simd};

use super::super::types::*;
use super::raw::RawNumFmt;

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
pub(super) fn parse_num_fmts(out: &mut Vec<NumberFormatDef>, xml: &[u8]) {
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

// =============================================================================
// Date format helpers
// =============================================================================

/// Check if a number format ID is a built-in date format
pub(super) fn is_builtin_date_format(id: u32) -> bool {
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
pub(super) fn is_date_format_code(format_code: &str) -> bool {
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
