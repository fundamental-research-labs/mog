//! Print settings types (ECMA-376 CT_PageSetup, CT_PageMargins, CT_HeaderFooter, CT_PrintOptions, CT_PageBreak).
//!
//! Unified from xlsx-parser read (`print/page_setup.rs`, `print/header_footer.rs`,
//! `print/print_options.rs`) and write (`write/print/types.rs`) sides.

pub mod hf_codes;

mod enums;
mod header_footer;
mod margins;
mod measure;
mod options;
mod page_breaks;
mod paper;
mod setup;

#[cfg(test)]
mod tests;

#[doc(inline)]
pub use enums::{CellComments, Orientation, PageOrder, PrintErrors};
#[doc(inline)]
pub use header_footer::{HeaderFooter, HeaderFooterSection};
#[doc(inline)]
pub use margins::PageMargins;
#[doc(inline)]
pub use measure::{MeasureUnit, UniversalMeasure};
#[doc(inline)]
pub use options::PrintOptions;
#[doc(inline)]
pub use page_breaks::{PageBreak, PageBreaks};
#[doc(inline)]
pub use paper::PaperSize;
#[doc(inline)]
pub use setup::PageSetup;
