//! Calculation chain parser for XLSX diagnostics.
//!
//! `xl/calcChain.xml` is an Excel recalculation cache. Production import keeps
//! only enough parsed state to count and diagnose the intentionally dropped
//! cache; it is never dependency truth and is never replayed on export.

use crate::infra::scanner::{find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr, parse_string_attr, parse_u32_attr};

// ============================================================================
// Core Data Structures
// ============================================================================

/// Diagnostic-only calculation chain summary.
#[derive(Debug, Clone, Default)]
pub struct CalcChain {
    /// Ordered list of diagnostic calculation entries.
    pub entries: Vec<CalcChainEntry>,
}

impl CalcChain {
    /// Get the number of entries in the calculation chain
    #[inline]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Check if the calculation chain is empty
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Get entries for a specific sheet.
    pub fn entries_for_sheet(&self, sheet_id: u32) -> Vec<&CalcChainEntry> {
        self.entries
            .iter()
            .filter(|e| e.sheet_id == sheet_id)
            .collect()
    }

    /// Get all array-formula diagnostic entries.
    pub fn array_entries(&self) -> Vec<&CalcChainEntry> {
        self.entries.iter().filter(|e| e.array).collect()
    }
}

/// A single diagnostic entry from CT_CalcCell.
#[derive(Debug, Clone, Default)]
pub struct CalcChainEntry {
    /// Cell reference (e.g., "A1", "B3:D5" for array formulas)
    pub cell_ref: String,
    /// Sheet ID (`i`), inherited from the previous entry when omitted.
    pub sheet_id: u32,
    /// `s`: cell starts a new dependency level.
    pub new_dependency_level: bool,
    /// `l`: cell starts a new thread.
    pub new_thread: bool,
    /// `t`: cell is an array formula.
    pub array: bool,
    /// `a`: cell is always calculated.
    pub always_calculate: bool,
    /// Whether the sheet ID was inherited from the previous entry.
    pub inherited_sheet: bool,
}

// ============================================================================
// Parsing Functions
// ============================================================================

/// Parse the calculation chain from calcChain.xml
///
/// # Arguments
/// * `xml` - Raw bytes of the calcChain XML file
///
/// # Returns
/// Parsed CalcChain structure with all entries
pub fn parse_calc_chain(xml: &[u8]) -> CalcChain {
    let mut chain = CalcChain::default();

    // Find the calcChain element
    let chain_start = match find_tag_simd(xml, b"calcChain", 0) {
        Some(pos) => pos,
        None => return chain,
    };

    // Track the current sheet ID for inheritance
    let mut current_sheet_id: u32 = 0;

    // Parse each <c> element
    // Note: find_tag_simd correctly handles namespace prefixes and won't match
    // "c" in "calcChain" because the tag must be followed by whitespace, >, or /
    let mut pos = chain_start;
    while let Some(c_start) = find_tag_simd(xml, b"c", pos) {
        let tag_end = match find_gt_simd(xml, c_start) {
            Some(end) => end,
            None => break,
        };

        let element = &xml[c_start..tag_end + 1];

        if let Some(entry) = parse_calc_entry(element, current_sheet_id) {
            // Update current sheet ID if this entry has one
            if !entry.inherited_sheet {
                current_sheet_id = entry.sheet_id;
            }
            chain.entries.push(entry);
        }

        pos = tag_end + 1;
    }

    chain
}

/// Count diagnostic `<c>` entries in an imported calculation chain.
///
/// This is the production full-parse path because calc chains are dropped
/// caches. It intentionally avoids constructing semantic formula dependency
/// data.
#[must_use]
pub fn count_calc_chain_entries(xml: &[u8]) -> usize {
    let chain_start = match find_tag_simd(xml, b"calcChain", 0) {
        Some(pos) => pos,
        None => return 0,
    };

    let mut count = 0;
    let mut pos = chain_start;
    while let Some(c_start) = find_tag_simd(xml, b"c", pos) {
        let Some(tag_end) = find_gt_simd(xml, c_start) else {
            break;
        };
        count += 1;
        pos = tag_end + 1;
    }
    count
}

fn parse_calc_entry(xml: &[u8], inherited_sheet_id: u32) -> Option<CalcChainEntry> {
    let mut entry = CalcChainEntry::default();

    // `r` is Strict. Transitional packages may use `ref`; prefer `r` when both exist.
    entry.cell_ref =
        parse_string_attr(xml, b"r=\"").or_else(|| parse_string_attr(xml, b"ref=\""))?;

    // Parse i (sheetId) attribute - optional, may be inherited
    if let Some(sheet_id) = parse_u32_attr(xml, b"i=\"") {
        entry.sheet_id = sheet_id;
        entry.inherited_sheet = false;
    } else {
        entry.sheet_id = inherited_sheet_id;
        entry.inherited_sheet = true;
    }

    entry.new_dependency_level = parse_bool_attr(xml, b"s=\"");
    entry.new_thread = parse_bool_attr(xml, b"l=\"");
    entry.array = parse_bool_attr(xml, b"t=\"");
    entry.always_calculate = parse_bool_attr(xml, b"a=\"");

    Some(entry)
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------------------
    // CalcChain struct tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_calc_chain_default() {
        let chain = CalcChain::default();
        assert!(chain.entries.is_empty());
        assert!(chain.is_empty());
        assert_eq!(chain.len(), 0);
    }

    #[test]
    fn test_calc_chain_entries_for_sheet() {
        let chain = CalcChain {
            entries: vec![
                CalcChainEntry {
                    cell_ref: "A1".to_string(),
                    sheet_id: 1,
                    ..Default::default()
                },
                CalcChainEntry {
                    cell_ref: "B1".to_string(),
                    sheet_id: 2,
                    ..Default::default()
                },
                CalcChainEntry {
                    cell_ref: "C1".to_string(),
                    sheet_id: 1,
                    ..Default::default()
                },
            ],
        };

        let sheet1_entries = chain.entries_for_sheet(1);
        assert_eq!(sheet1_entries.len(), 2);
        assert_eq!(sheet1_entries[0].cell_ref, "A1");
        assert_eq!(sheet1_entries[1].cell_ref, "C1");

        let sheet2_entries = chain.entries_for_sheet(2);
        assert_eq!(sheet2_entries.len(), 1);
        assert_eq!(sheet2_entries[0].cell_ref, "B1");
    }

    #[test]
    fn test_calc_chain_array_entries() {
        let chain = CalcChain {
            entries: vec![
                CalcChainEntry {
                    cell_ref: "A1:A10".to_string(),
                    array: true,
                    ..Default::default()
                },
                CalcChainEntry {
                    cell_ref: "B1".to_string(),
                    array: false,
                    ..Default::default()
                },
            ],
        };

        let arrays = chain.array_entries();
        assert_eq!(arrays.len(), 1);
        assert_eq!(arrays[0].cell_ref, "A1:A10");
    }

    // -------------------------------------------------------------------------
    // CalcChainEntry struct tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_calc_entry_default() {
        let entry = CalcChainEntry::default();
        assert!(entry.cell_ref.is_empty());
        assert_eq!(entry.sheet_id, 0);
        assert!(!entry.new_dependency_level);
        assert!(!entry.new_thread);
        assert!(!entry.array);
        assert!(!entry.always_calculate);
    }

    // -------------------------------------------------------------------------
    // parse_calc_chain tests
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_calc_chain_empty() {
        let xml = b"<?xml version=\"1.0\"?><worksheet></worksheet>";
        let chain = parse_calc_chain(xml);
        assert!(chain.is_empty());
    }

    #[test]
    fn test_parse_calc_chain_basic() {
        let xml = br#"<?xml version="1.0"?>
<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
    <c r="A1" i="1"/>
    <c r="B1" i="1"/>
    <c r="C1" i="2"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 3);
        assert_eq!(chain.entries[0].cell_ref, "A1");
        assert_eq!(chain.entries[0].sheet_id, 1);
        assert_eq!(chain.entries[1].cell_ref, "B1");
        assert_eq!(chain.entries[1].sheet_id, 1);
        assert_eq!(chain.entries[2].cell_ref, "C1");
        assert_eq!(chain.entries[2].sheet_id, 2);
    }

    #[test]
    fn test_parse_calc_chain_inherited_sheet() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="A1" i="1"/>
    <c r="A2"/>
    <c r="A3"/>
    <c r="B1" i="2"/>
    <c r="B2"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 5);

        // First entry has explicit sheet ID
        assert_eq!(chain.entries[0].sheet_id, 1);
        assert!(!chain.entries[0].inherited_sheet);

        // A2, A3 inherit from A1
        assert_eq!(chain.entries[1].sheet_id, 1);
        assert!(chain.entries[1].inherited_sheet);
        assert_eq!(chain.entries[2].sheet_id, 1);
        assert!(chain.entries[2].inherited_sheet);

        // B1 has explicit sheet ID
        assert_eq!(chain.entries[3].sheet_id, 2);
        assert!(!chain.entries[3].inherited_sheet);

        // B2 inherits from B1
        assert_eq!(chain.entries[4].sheet_id, 2);
        assert!(chain.entries[4].inherited_sheet);
    }

    #[test]
    fn test_parse_calc_chain_with_flags() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="A1" i="1" s="1"/>
    <c r="A2" i="1" l="1"/>
    <c r="A3" i="1" t="1"/>
    <c r="A4" i="1" a="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 4);

        assert!(chain.entries[0].new_dependency_level);
        assert!(chain.entries[1].new_thread);
        assert!(chain.entries[2].array);
        assert!(chain.entries[3].always_calculate);
    }

    #[test]
    fn test_parse_calc_chain_transitional_ref_fallback() {
        let xml = br#"<calcChain><c ref="D5" i="3"/><c r="E6" ref="F7"/></calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 2);
        assert_eq!(chain.entries[0].cell_ref, "D5");
        assert_eq!(chain.entries[0].sheet_id, 3);
        assert_eq!(chain.entries[1].cell_ref, "E6");
    }

    #[test]
    fn test_count_calc_chain_entries() {
        let xml = br#"<calcChain><c r="A1"/><c r="A2"/><c r="A3"/></calcChain>"#;
        assert_eq!(count_calc_chain_entries(xml), 3);
    }

    #[test]
    fn test_parse_calc_chain_array_formula() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="A1:A10" i="1" t="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 1);
        assert_eq!(chain.entries[0].cell_ref, "A1:A10");
        assert!(chain.entries[0].array);
    }

    #[test]
    fn test_parse_calc_chain_large() {
        let mut xml = String::from(r#"<?xml version="1.0"?><calcChain>"#);

        for i in 1..=100 {
            xml.push_str(&format!(r#"<c r="A{}" i="1"/>"#, i));
        }

        xml.push_str("</calcChain>");

        let chain = parse_calc_chain(xml.as_bytes());
        assert_eq!(chain.len(), 100);
        assert_eq!(chain.entries[0].cell_ref, "A1");
        assert_eq!(chain.entries[99].cell_ref, "A100");
    }

    // -------------------------------------------------------------------------
    // Edge cases
    // -------------------------------------------------------------------------

    #[test]
    fn test_parse_calc_chain_no_entries() {
        let xml = br#"<?xml version="1.0"?>
<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert!(chain.is_empty());
    }

    #[test]
    fn test_parse_calc_chain_missing_ref() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c i="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        // Entry without ref should be skipped
        assert!(chain.is_empty());
    }

    #[test]
    fn test_parse_calc_chain_all_attributes() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="A1" i="1" l="1" a="1" s="1" t="1" si="5" m="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 1);

        let entry = &chain.entries[0];
        assert_eq!(entry.cell_ref, "A1");
        assert_eq!(entry.sheet_id, 1);
        assert!(entry.new_dependency_level);
        assert!(entry.new_thread);
        assert!(entry.array);
        assert!(entry.always_calculate);
    }

    #[test]
    fn test_parse_calc_chain_complex_refs() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="AA100" i="1"/>
    <c r="XFD1048576" i="1"/>
    <c r="A1:Z100" i="1" t="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 3);
        assert_eq!(chain.entries[0].cell_ref, "AA100");
        assert_eq!(chain.entries[1].cell_ref, "XFD1048576");
        assert_eq!(chain.entries[2].cell_ref, "A1:Z100");
    }
}
