use super::super::adapters::{find_byte, find_sequence};
use super::bytes::parse_u32;

#[derive(Debug)]
pub struct SharedFormulaExtract<'a> {
    /// The `si` attribute value
    pub si: u32,
    /// True if this is the master cell (has `ref=` attribute and formula text)
    pub is_master: bool,
    /// The formula text, if this is a master cell. None for reference cells.
    pub formula_text: Option<&'a [u8]>,
    /// The `ref="..."` attribute value for master cells, None for reference cells.
    pub ref_range: Option<&'a [u8]>,
}

/// Extract shared formula metadata from a cell element's XML.
///
/// Looks for `<f t="shared" ...>` patterns and returns:
/// - `None` if the cell doesn't have a shared formula
/// - `Some(SharedFormulaExtract)` with `si`, `is_master`, and optionally formula text
///
/// This function is designed to be called on the same XML slice that was passed
/// to `parse_cell_element`, so it only needs to scan the `<f ...>` portion.
pub fn extract_shared_formula_info(xml: &[u8]) -> Option<SharedFormulaExtract<'_>> {
    // Look for <f with attributes (shared formulas always have attributes)
    let f_start = find_sequence(xml, b"<f ", 0)?;

    // Extract the <f ...> tag region (up to the closing > or />)
    let f_region_end = find_sequence(xml, b"</f>", f_start)
        .or_else(|| find_sequence(xml, b"/>", f_start).map(|p| p + 2))
        .unwrap_or(xml.len());
    let f_tag = &xml[f_start..f_region_end];

    // Check for t="shared" attribute within the <f> tag
    find_sequence(f_tag, b"t=\"shared\"", 0)?;

    // Extract si attribute value
    let si_val = {
        let si_pattern = b"si=\"";
        let si_start = find_sequence(f_tag, si_pattern, 0)?;
        let val_start = si_start + si_pattern.len();
        let val_end = find_byte(f_tag, b'"', val_start)?;
        parse_u32(&f_tag[val_start..val_end])?
    };

    // Check if this is a master cell: has a `ref=` attribute (defines the range)
    // and has formula text (not self-closing)
    let gt_offset = find_byte(f_tag, b'>', 0)?;
    let is_self_closing = gt_offset > 0 && f_tag[gt_offset - 1] == b'/';

    if is_self_closing {
        // This is a reference cell (self-closing <f t="shared" si="N"/>)
        Some(SharedFormulaExtract {
            si: si_val,
            is_master: false,
            formula_text: None,
            ref_range: None,
        })
    } else {
        // This has formula text: <f t="shared" si="N" ref="...">formula_text</f>
        // Check for ref= attribute to confirm it's a master
        let ref_range = find_sequence(f_tag, b"ref=\"", 0).and_then(|ref_start| {
            let val_start = ref_start + b"ref=\"".len();
            let val_end = find_byte(f_tag, b'"', val_start)?;
            Some(&f_tag[val_start..val_end])
        });
        let has_ref = ref_range.is_some();
        if has_ref {
            // Extract formula text between > and </f>
            let content_start = f_start + gt_offset + 1;
            let content_end = find_sequence(xml, b"</f>", content_start)?;
            Some(SharedFormulaExtract {
                si: si_val,
                is_master: true,
                formula_text: Some(&xml[content_start..content_end]),
                ref_range,
            })
        } else {
            // Has t="shared" and si but no ref= - this is still a reference cell
            // that happens to repeat the formula text (rare but valid)
            None
        }
    }
}
