//! Print settings parser for XLSX worksheets.
//!
//! This module parses print-related elements from worksheet XML files according to
//! ECMA-376 specifications:
//! - `<pageSetup>` (CT_PageSetup) - Paper size, orientation, scaling, fit-to-page
//! - `<pageMargins>` (CT_PageMargins) - Margin settings for all edges
//! - `<headerFooter>` (CT_HeaderFooter) - Headers and footers with format codes
//! - `<printOptions>` (CT_PrintOptions) - Grid lines, headings, centering
//! - `<rowBreaks>` / `<colBreaks>` (CT_PageBreak) - Manual page breaks
//!
//! # Header/Footer Format Codes
//! Excel supports special format codes in headers and footers:
//! - `&L` - Left section
//! - `&C` - Center section
//! - `&R` - Right section
//! - `&P` - Current page number
//! - `&N` - Total number of pages
//! - `&D` - Current date
//! - `&T` - Current time
//! - `&F` - File name
//! - `&A` - Sheet name (tab name)
//! - `&Z` - File path
//! - `&G` - Picture/graphic placeholder
//! - `&B` - Bold toggle
//! - `&I` - Italic toggle
//! - `&U` - Underline toggle
//! - `&S` - Strikethrough toggle
//! - `&E` - Double underline toggle
//! - `&X` - Superscript toggle
//! - `&Y` - Subscript toggle
//! - `&"fontname"` - Font name
//! - `&nn` - Font size (two digits)
//! - `&K` followed by hex color - Font color
//!
//! # Performance
//! - Uses SIMD-optimized scanning functions from the scanner module
//! - Zero allocations in the hot path where possible
//! - Graceful handling of malformed input
//!
//! # Module Structure
//! - `page_setup` - Page setup and margins types
//! - `header_footer` - Header/footer types and parsing
//! - `print_options` - Print options and page breaks
//! - `types` - Combined PrintSettings type
//! - `helpers` - XML parsing utilities

mod header_footer;
pub(crate) mod helpers;
pub mod hf_images;
mod page_setup;
mod print_options;
mod types;
pub mod write;

// Re-export all public types
pub use header_footer::{HeaderFooter, HeaderFooterSection};
pub use hf_images::{HeaderFooterImage, HfImagePosition};
pub use page_setup::{
    CellComments, Orientation, PageMargins, PageOrder, PageSetup, PaperSize, PrintErrors,
    UniversalMeasure, parse_page_margins,
};
pub use print_options::{PageBreak, PageBreaks, PrintOptions};
pub use types::PrintSettings;
