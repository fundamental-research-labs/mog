//! Calculation chain parser for XLSX files.
//!
//! This module parses the calculation chain from `xl/calcChain.xml`, which defines
//! the order in which formulas should be calculated for optimal performance.
//!
//! # XLSX Calculation Chain Structure
//!
//! The calculation chain (`xl/calcChain.xml`) contains entries that specify:
//! - The cell reference containing the formula
//! - The sheet ID where the cell is located
//! - Flags indicating array formulas, volatile functions, etc.
//!
//! # Example Usage
//!
//! ```ignore
//! use xlsx_parser::calc::{parse_calc_chain, CalcChain};
//!
//! let xml = archive.read_file("xl/calcChain.xml")?;
//! let calc_chain = parse_calc_chain(&xml);
//!
//! for entry in calc_chain.entries {
//!     println!("Cell {} on sheet {}", entry.cell_ref, entry.sheet_id);
//! }
//! ```

use crate::infra::scanner::{find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_bool_attr, parse_string_attr, parse_u32_attr};

// ============================================================================
// Core Data Structures
// ============================================================================

/// The complete calculation chain from a workbook
#[derive(Debug, Clone, Default)]
pub struct CalcChain {
    /// Ordered list of calculation entries
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

    /// Get entries for a specific sheet
    pub fn entries_for_sheet(&self, sheet_id: u32) -> Vec<&CalcChainEntry> {
        self.entries
            .iter()
            .filter(|e| e.sheet_id == sheet_id)
            .collect()
    }

    /// Get all volatile entries
    pub fn volatile_entries(&self) -> Vec<&CalcChainEntry> {
        self.entries.iter().filter(|e| e.volatile).collect()
    }

    /// Get all array formula entries
    pub fn array_entries(&self) -> Vec<&CalcChainEntry> {
        self.entries.iter().filter(|e| e.array).collect()
    }
}

/// A single entry in the calculation chain
#[derive(Debug, Clone, Default)]
pub struct CalcChainEntry {
    /// Cell reference (e.g., "A1", "B3:D5" for array formulas)
    pub cell_ref: String,

    /// Sheet ID (1-based index)
    pub sheet_id: u32,

    /// Whether this entry has been calculated
    /// When true, the formula result is up-to-date
    pub calculated: bool,

    /// Whether this is an array formula
    /// Array formulas span multiple cells
    pub array: bool,

    /// Whether this formula contains volatile functions
    /// Volatile functions (NOW(), RAND(), etc.) recalculate on every change
    pub volatile: bool,

    /// Whether this cell is part of a shared formula
    pub shared: bool,

    /// Index of the shared formula group (if shared)
    pub shared_index: Option<u32>,

    /// Whether this is the master cell of a shared formula
    pub shared_master: bool,

    /// Whether the sheet ID is inherited from the previous entry
    /// This is an optimization in calcChain.xml to avoid repeating sheet IDs
    pub inherited_sheet: bool,
}

impl CalcChainEntry {
    /// Check if this entry needs recalculation
    #[inline]
    pub fn needs_calc(&self) -> bool {
        !self.calculated || self.volatile
    }

    /// Check if this is a simple (non-array, non-shared) formula
    #[inline]
    pub fn is_simple(&self) -> bool {
        !self.array && !self.shared
    }
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

fn parse_calc_entry(xml: &[u8], inherited_sheet_id: u32) -> Option<CalcChainEntry> {
    let mut entry = CalcChainEntry::default();

    // Parse r (ref) attribute - required
    entry.cell_ref = parse_string_attr(xml, b"r=\"")?;

    // Parse i (sheetId) attribute - optional, may be inherited
    if let Some(sheet_id) = parse_u32_attr(xml, b"i=\"") {
        entry.sheet_id = sheet_id;
        entry.inherited_sheet = false;
    } else {
        entry.sheet_id = inherited_sheet_id;
        entry.inherited_sheet = true;
    }

    // Parse l (calculated/stale) attribute
    // When present, indicates the formula was calculated
    entry.calculated = parse_bool_attr(xml, b"l=\"");

    // Parse a (array) attribute
    entry.array = parse_bool_attr(xml, b"a=\"");

    // Parse s (shared) attribute
    entry.shared = parse_bool_attr(xml, b"s=\"");

    // Parse t (volatile) attribute
    // Note: 't' stands for "transient" in the spec
    entry.volatile = parse_bool_attr(xml, b"t=\"");

    // Parse si (shared index) attribute
    entry.shared_index = parse_u32_attr(xml, b"si=\"");

    // Parse m (shared master) attribute
    entry.shared_master = parse_bool_attr(xml, b"m=\"");

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
    fn test_calc_chain_volatile_entries() {
        let chain = CalcChain {
            entries: vec![
                CalcChainEntry {
                    cell_ref: "A1".to_string(),
                    volatile: true,
                    ..Default::default()
                },
                CalcChainEntry {
                    cell_ref: "B1".to_string(),
                    volatile: false,
                    ..Default::default()
                },
                CalcChainEntry {
                    cell_ref: "C1".to_string(),
                    volatile: true,
                    ..Default::default()
                },
            ],
        };

        let volatile = chain.volatile_entries();
        assert_eq!(volatile.len(), 2);
        assert_eq!(volatile[0].cell_ref, "A1");
        assert_eq!(volatile[1].cell_ref, "C1");
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
        assert!(!entry.calculated);
        assert!(!entry.array);
        assert!(!entry.volatile);
        assert!(!entry.shared);
    }

    #[test]
    fn test_calc_entry_needs_calc() {
        let entry = CalcChainEntry {
            calculated: false,
            volatile: false,
            ..Default::default()
        };
        assert!(entry.needs_calc());

        let entry = CalcChainEntry {
            calculated: true,
            volatile: false,
            ..Default::default()
        };
        assert!(!entry.needs_calc());

        let entry = CalcChainEntry {
            calculated: true,
            volatile: true,
            ..Default::default()
        };
        assert!(entry.needs_calc());
    }

    #[test]
    fn test_calc_entry_is_simple() {
        let entry = CalcChainEntry {
            array: false,
            shared: false,
            ..Default::default()
        };
        assert!(entry.is_simple());

        let entry = CalcChainEntry {
            array: true,
            shared: false,
            ..Default::default()
        };
        assert!(!entry.is_simple());

        let entry = CalcChainEntry {
            array: false,
            shared: true,
            ..Default::default()
        };
        assert!(!entry.is_simple());
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
    <c r="A1" i="1" l="1"/>
    <c r="A2" i="1" a="1"/>
    <c r="A3" i="1" t="1"/>
    <c r="A4" i="1" s="1" si="0"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 4);

        // Calculated flag
        assert!(chain.entries[0].calculated);

        // Array formula
        assert!(chain.entries[1].array);

        // Volatile function
        assert!(chain.entries[2].volatile);

        // Shared formula
        assert!(chain.entries[3].shared);
        assert_eq!(chain.entries[3].shared_index, Some(0));
    }

    #[test]
    fn test_parse_calc_chain_array_formula() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="A1:A10" i="1" a="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 1);
        assert_eq!(chain.entries[0].cell_ref, "A1:A10");
        assert!(chain.entries[0].array);
    }

    #[test]
    fn test_parse_calc_chain_shared_formula() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="A1" i="1" s="1" si="0" m="1"/>
    <c r="A2" s="1" si="0"/>
    <c r="A3" s="1" si="0"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 3);

        // Master cell
        assert!(chain.entries[0].shared);
        assert!(chain.entries[0].shared_master);
        assert_eq!(chain.entries[0].shared_index, Some(0));

        // Dependent cells
        assert!(chain.entries[1].shared);
        assert!(!chain.entries[1].shared_master);
        assert_eq!(chain.entries[1].shared_index, Some(0));
    }

    #[test]
    fn test_parse_calc_chain_volatile() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="A1" i="1" t="1"/>
    <c r="A2" i="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);

        // A1 has volatile function (e.g., NOW(), RAND())
        assert!(chain.entries[0].volatile);
        assert!(chain.entries[0].needs_calc());

        // A2 is not volatile
        assert!(!chain.entries[1].volatile);
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
        assert!(entry.calculated);
        assert!(entry.array);
        assert!(entry.shared);
        assert!(entry.volatile);
        assert_eq!(entry.shared_index, Some(5));
        assert!(entry.shared_master);
    }

    #[test]
    fn test_parse_calc_chain_complex_refs() {
        let xml = br#"<?xml version="1.0"?>
<calcChain>
    <c r="AA100" i="1"/>
    <c r="XFD1048576" i="1"/>
    <c r="A1:Z100" i="1" a="1"/>
</calcChain>"#;

        let chain = parse_calc_chain(xml);
        assert_eq!(chain.len(), 3);
        assert_eq!(chain.entries[0].cell_ref, "AA100");
        assert_eq!(chain.entries[1].cell_ref, "XFD1048576");
        assert_eq!(chain.entries[2].cell_ref, "A1:Z100");
    }
}
