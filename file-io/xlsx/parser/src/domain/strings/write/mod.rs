//! Shared Strings Writer for XLSX files
//!
//! This module provides efficient writing of the shared strings table (sharedStrings.xml).
//! The shared strings table stores unique string values, allowing cells to reference
//! strings by index instead of duplicating values.
//!
//! # Design goals
//!
//! 1. **Deduplication** — each unique plain string is stored only once.
//! 2. **Insertion-order emission** — the index returned by `add()`
//!    is the slot at which the entry is emitted in `<sst>`. Cells store
//!    SST indices positionally (`<c t="s"><v>N</v>`), so any reorder
//!    between `add()` and emission silently corrupts text cells. Matches
//!    Excel's own writer behavior.
//! 3. **Rich-text support** — formatted runs with bold, italic, colors, etc.
//! 4. **Efficient lookup** — O(1) string-to-index lookup via HashMap.
//!
//! # XML output format
//!
//! ```xml
//! <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
//! <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="10" uniqueCount="5">
//!   <si><t>First inserted</t></si>
//!   <si><t>Second inserted</t></si>
//!   <si>
//!     <r>
//!       <rPr><b/><sz val="12"/><color rgb="FF0000"/><rFont val="Arial"/></rPr>
//!       <t>Bold red text</t>
//!     </r>
//!     <r><t> normal text</t></r>
//!   </si>
//! </sst>
//! ```

mod domain_rich_text;
mod escape;
mod rich_text;
mod table;
mod types;
mod xml;

#[cfg(test)]
mod tests;

pub use table::SharedStringsWriter;
pub use types::{RichTextRun, SharedStringValue};
