use super::super::adapters::find_sequence;
use super::bytes::{find_byte_in, parse_u32};
use super::shared_formula::SharedFormulaExtract;

/// Result of the fused single-pass formula extras extraction.
///
/// Replaces 7-9 sequential `find_sequence()` calls with a single forward scan
/// over the cell XML, extracting all formula-related extras at once.
#[derive(Debug, Default)]
pub struct FormulaExtras<'a> {
    // ── <f> element attributes ──
    /// `t="shared"` with associated shared-formula data
    pub shared: Option<SharedFormulaExtract<'a>>,
    /// `t="array"` detected
    pub is_array: bool,
    /// `t="dataTable"` detected
    pub is_data_table: bool,
    /// `ca="1"` on the <f> element
    pub ca: bool,
    /// `aca="1"` on the <f> element
    pub aca: bool,
    /// `bx="1"` on the <f> element
    pub bx: bool,
    /// `xml:space="preserve"` on the <f> element
    pub f_xml_space: bool,
    /// `ref="..."` attribute value from <f> (for array / dataTable)
    pub f_ref: Option<&'a [u8]>,
    /// `r1="..."` attribute value (data tables)
    pub r1: Option<&'a [u8]>,
    /// `r2="..."` attribute value (data tables)
    pub r2: Option<&'a [u8]>,
    /// `dt2D="1"` (data tables)
    pub dt2d: bool,
    /// `dtr="1"` (data tables)
    pub dtr: bool,
    /// `del1="1"` (data tables)
    pub del1: bool,
    /// `del2="1"` (data tables)
    pub del2: bool,
    /// Formula text between `<f ...>` and `</f>`, if present
    pub formula_text: Option<&'a [u8]>,

    // ── <v> element ──
    /// `<v/>` self-closing empty cached value
    pub v_self_closing: bool,
    /// Content between `<v...>` and `</v>`, if present
    pub v_content: Option<&'a [u8]>,
    /// `xml:space="preserve"` on the <v> element
    pub v_xml_space: bool,
}

/// Single-pass extraction of all formula extras from a cell XML fragment.
///
/// Scans the cell XML once, locating `<f` and `<v` elements and extracting
/// all attributes and content from each. This replaces the previous approach
/// of 7-9 separate `find_sequence()` calls.
pub fn extract_formula_extras_fused(xml: &[u8]) -> FormulaExtras<'_> {
    let mut result = FormulaExtras::default();
    let len = xml.len();
    let mut pos = 0;

    // ── Scan for <f element ──
    while pos < len {
        if xml[pos] == b'<' && pos + 1 < len && xml[pos + 1] == b'f' {
            // Check it's actually `<f ` or `<f>` or `<f/` (not `<fo...` etc.)
            if pos + 2 >= len
                || xml[pos + 2] == b' '
                || xml[pos + 2] == b'>'
                || xml[pos + 2] == b'/'
            {
                // Found <f element — extract everything from the tag
                let f_start = pos;

                // Find the end of the opening tag
                let mut tag_end = pos + 2;
                let mut is_self_closing_f = false;
                while tag_end < len {
                    if xml[tag_end] == b'>' {
                        is_self_closing_f = tag_end > 0 && xml[tag_end - 1] == b'/';
                        break;
                    }
                    tag_end += 1;
                }
                if tag_end >= len {
                    break;
                }

                let f_tag = &xml[f_start..=tag_end];

                // Parse attributes from the <f> tag in a single scan
                parse_f_tag_attrs(f_tag, &mut result);

                // Extract formula text if not self-closing
                if !is_self_closing_f {
                    let content_start = tag_end + 1;
                    if let Some(f_close) = find_sequence(xml, b"</f>", content_start) {
                        let text = &xml[content_start..f_close];
                        if !text.is_empty() {
                            result.formula_text = Some(text);
                        }
                        pos = f_close + 4;
                    } else {
                        pos = tag_end + 1;
                    }
                } else {
                    pos = tag_end + 1;
                }

                // Build SharedFormulaExtract if t="shared"
                if result.shared.is_some() {
                    // Already partially filled by parse_f_tag_attrs; finish it
                    // The formula_text and ref_range are set there.
                }

                // Now scan for <v element after the <f> element
                break;
            }
        }
        pos += 1;
    }

    // ── Scan for <v element ──
    while pos < len {
        if xml[pos] == b'<' && pos + 1 < len && xml[pos + 1] == b'v' {
            // Check it's actually `<v ` or `<v>` or `<v/` (not `<va...` etc.)
            if pos + 2 >= len
                || xml[pos + 2] == b' '
                || xml[pos + 2] == b'>'
                || xml[pos + 2] == b'/'
            {
                let v_start = pos;

                // Check for self-closing <v/>
                if pos + 3 < len
                    && xml[pos + 1] == b'v'
                    && xml[pos + 2] == b'/'
                    && xml[pos + 3] == b'>'
                {
                    result.v_self_closing = true;
                    break;
                }

                // Find end of opening tag
                let mut tag_end = pos + 2;
                while tag_end < len {
                    if xml[tag_end] == b'>' {
                        break;
                    }
                    tag_end += 1;
                }
                if tag_end >= len {
                    break;
                }

                // Check for xml:space in the <v> tag
                let v_tag = &xml[v_start..=tag_end];
                if v_tag.windows(9).any(|w| w == b"xml:space") {
                    result.v_xml_space = true;
                }

                // Extract content between <v...> and </v>
                let content_start = tag_end + 1;
                if let Some(v_close) = find_sequence(xml, b"</v>", content_start) {
                    result.v_content = Some(&xml[content_start..v_close]);
                }

                break;
            }
        }
        pos += 1;
    }

    result
}

/// Parse all attributes from the `<f ...>` tag bytes in a single scan.
fn parse_f_tag_attrs<'a>(f_tag: &'a [u8], result: &mut FormulaExtras<'a>) {
    let len = f_tag.len();
    let mut i = 0;

    // Track attribute positions for shared formula si/ref extraction
    let mut si_val: Option<u32> = None;
    let mut ref_val: Option<&'a [u8]> = None;
    let mut is_shared = false;
    let is_self_closing = len >= 2 && f_tag[len - 2] == b'/' && f_tag[len - 1] == b'>';

    while i < len {
        let b = f_tag[i];

        // Quick skip: most bytes are not attribute starts
        if b == b't' && i + 2 < len && f_tag[i + 1] == b'=' && f_tag[i + 2] == b'"' {
            // t="..." attribute
            let val_start = i + 3;
            if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                let val = &f_tag[val_start..val_end];
                if val == b"shared" {
                    is_shared = true;
                } else if val == b"array" {
                    result.is_array = true;
                } else if val == b"dataTable" {
                    result.is_data_table = true;
                }
                i = val_end + 1;
                continue;
            }
        } else if b == b'c'
            && i + 3 < len
            && f_tag[i + 1] == b'a'
            && f_tag[i + 2] == b'='
            && f_tag[i + 3] == b'"'
        {
            // ca="..." attribute
            if i + 5 < len && f_tag[i + 4] == b'1' && f_tag[i + 5] == b'"' {
                result.ca = true;
            }
            i += 4;
            // Skip past the closing quote
            while i < len && f_tag[i] != b'"' {
                i += 1;
            }
            i += 1;
            continue;
        } else if b == b'a'
            && i + 4 < len
            && f_tag[i + 1] == b'c'
            && f_tag[i + 2] == b'a'
            && f_tag[i + 3] == b'='
            && f_tag[i + 4] == b'"'
        {
            // aca="..." attribute
            if i + 6 < len && f_tag[i + 5] == b'1' && f_tag[i + 6] == b'"' {
                result.aca = true;
            }
            i += 5;
            while i < len && f_tag[i] != b'"' {
                i += 1;
            }
            i += 1;
            continue;
        } else if b == b'b'
            && i + 3 < len
            && f_tag[i + 1] == b'x'
            && f_tag[i + 2] == b'='
            && f_tag[i + 3] == b'"'
        {
            // bx="..." attribute
            if i + 5 < len && f_tag[i + 4] == b'1' && f_tag[i + 5] == b'"' {
                result.bx = true;
            }
            i += 4;
            while i < len && f_tag[i] != b'"' {
                i += 1;
            }
            i += 1;
            continue;
        } else if b == b's'
            && i + 3 < len
            && f_tag[i + 1] == b'i'
            && f_tag[i + 2] == b'='
            && f_tag[i + 3] == b'"'
        {
            // si="..." attribute
            let val_start = i + 4;
            if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                si_val = parse_u32(&f_tag[val_start..val_end]);
                i = val_end + 1;
                continue;
            }
        } else if b == b'r' && i + 1 < len {
            if f_tag[i + 1] == b'e'
                && i + 4 < len
                && f_tag[i + 2] == b'f'
                && f_tag[i + 3] == b'='
                && f_tag[i + 4] == b'"'
            {
                // ref="..." attribute
                let val_start = i + 5;
                if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                    ref_val = Some(&f_tag[val_start..val_end]);
                    result.f_ref = ref_val;
                    i = val_end + 1;
                    continue;
                }
            } else if f_tag[i + 1] == b'1'
                && i + 3 < len
                && f_tag[i + 2] == b'='
                && f_tag[i + 3] == b'"'
            {
                // r1="..."
                let val_start = i + 4;
                if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                    result.r1 = Some(&f_tag[val_start..val_end]);
                    i = val_end + 1;
                    continue;
                }
            } else if f_tag[i + 1] == b'2'
                && i + 3 < len
                && f_tag[i + 2] == b'='
                && f_tag[i + 3] == b'"'
            {
                // r2="..."
                let val_start = i + 4;
                if let Some(val_end) = find_byte_in(f_tag, b'"', val_start) {
                    result.r2 = Some(&f_tag[val_start..val_end]);
                    i = val_end + 1;
                    continue;
                }
            }
        } else if b == b'd' && i + 4 < len {
            if f_tag[i + 1] == b't'
                && f_tag[i + 2] == b'2'
                && f_tag[i + 3] == b'D'
                && f_tag[i + 4] == b'='
            {
                // dt2D="1"
                if i + 7 < len
                    && f_tag[i + 5] == b'"'
                    && f_tag[i + 6] == b'1'
                    && f_tag[i + 7] == b'"'
                {
                    result.dt2d = true;
                }
                i += 5;
            } else if f_tag[i + 1] == b't'
                && f_tag[i + 2] == b'r'
                && f_tag[i + 3] == b'='
                && f_tag[i + 4] == b'"'
            {
                // dtr="1"
                if i + 6 < len && f_tag[i + 5] == b'1' && f_tag[i + 6] == b'"' {
                    result.dtr = true;
                }
                i += 5;
            } else if f_tag[i + 1] == b'e' && f_tag[i + 2] == b'l' {
                if f_tag[i + 3] == b'1' && f_tag[i + 4] == b'=' {
                    // del1="1"
                    if i + 7 < len
                        && f_tag[i + 5] == b'"'
                        && f_tag[i + 6] == b'1'
                        && f_tag[i + 7] == b'"'
                    {
                        result.del1 = true;
                    }
                    i += 5;
                } else if f_tag[i + 3] == b'2' && f_tag[i + 4] == b'=' {
                    // del2="1"
                    if i + 7 < len
                        && f_tag[i + 5] == b'"'
                        && f_tag[i + 6] == b'1'
                        && f_tag[i + 7] == b'"'
                    {
                        result.del2 = true;
                    }
                    i += 5;
                }
            }
        } else if b == b'x' && i + 9 < len && &f_tag[i..i + 9] == b"xml:space" {
            // xml:space="preserve" on the <f> element
            result.f_xml_space = true;
            i += 9;
            continue;
        }

        i += 1;
    }

    // Build SharedFormulaExtract if t="shared"
    if is_shared {
        if let Some(si) = si_val {
            let has_ref = ref_val.is_some();
            if is_self_closing {
                // Reference cell: <f t="shared" si="N"/>
                result.shared = Some(SharedFormulaExtract {
                    si,
                    is_master: false,
                    formula_text: None,
                    ref_range: None,
                });
            } else if has_ref {
                // Master cell: formula_text will be filled by the caller
                // (the text between <f> and </f>)
                result.shared = Some(SharedFormulaExtract {
                    si,
                    is_master: true,
                    formula_text: None, // Caller sets this from result.formula_text
                    ref_range: ref_val,
                });
            }
            // else: has t="shared" and si but no ref= and not self-closing
            // — treat as non-shared (same as original extract_shared_formula_info)
        }
    }
}
