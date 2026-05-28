//! Print Settings Writer for XLSX worksheets.
//!
//! This module generates print-related XML elements for worksheet files
//! according to ECMA-376 specifications:
//! - `<pageMargins>` - Margin settings for all edges
//! - `<pageSetup>` - Paper size, orientation, scaling, fit-to-page
//! - `<printOptions>` - Grid lines, headings, centering
//! - `<headerFooter>` - Headers and footers with format codes
//! - `<rowBreaks>` / `<colBreaks>` - Manual page breaks
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
//! - `&X` - Superscript toggle
//! - `&Y` - Subscript toggle
//! - `&"fontname,style"` - Font name and style
//! - `&nn` - Font size (two digits)
//! - `&K<RRGGBB>` - Font color (hex)
//!
//! # Example
//!
//! ```ignore
//! use xlsx_parser::write::print_writer::{PrintWriter, PaperSize, Orientation, PageMargins};
//!
//! let mut writer = PrintWriter::new();
//!
//! // Set paper and orientation
//! writer
//!     .paper_size(PaperSize::A4)
//!     .orientation(Orientation::Landscape)
//!     .scale(75);
//!
//! // Set margins
//! writer.set_margins(PageMargins::default());
//!
//! // Add header/footer
//! writer
//!     .header("&CPage &P of &N")
//!     .footer("&L&D&R&F");
//!
//! // Add page breaks
//! writer
//!     .add_row_break(25)
//!     .add_row_break(50)
//!     .add_col_break(5);
//!
//! // Generate XML
//! let mut xml_writer = XmlWriter::new();
//! writer.write_to(&mut xml_writer);
//! ```

mod header_footer;
mod writer;

#[cfg(test)]
mod tests;

pub use header_footer::HeaderFooter;
pub use writer::{PrintWriter, format_f64};

/// Convert `domain_types::PrintSettings` into a `PrintWriter`.
///
/// The caller is responsible for calling `.write_to()` on the returned writer.
pub fn print_writer_from_domain(ps: &domain_types::PrintSettings) -> PrintWriter {
    use super::{Orientation, PageMargins as OoxmlPageMargins, PageSetup, PrintOptions};

    let mut pw = PrintWriter::new();

    // Page setup
    let has_page_setup = ps.paper_size.is_some()
        || ps.paper_width.is_some()
        || ps.paper_height.is_some()
        || ps.orientation.is_some()
        || ps.scale.is_some()
        || ps.fit_to_width.is_some()
        || ps.fit_to_height.is_some()
        || ps.copies.is_some()
        || ps.black_and_white
        || ps.draft
        || ps.first_page_number.is_some()
        || ps.use_first_page_number
        || ps.page_order.is_some()
        || ps.use_printer_defaults.is_some()
        || ps.horizontal_dpi.is_some()
        || ps.vertical_dpi.is_some()
        || ps.r_id.is_some()
        || ps.cell_comments.is_some()
        || ps.print_errors.is_some()
        || ps.has_page_setup;

    if has_page_setup {
        let mut setup = PageSetup::default();
        if let Some(paper_size) = ps.paper_size {
            setup.paper_size = Some(crate::domain::print::PaperSize::from_u32(paper_size));
        }
        if let Some(ref paper_width) = ps.paper_width {
            setup.paper_width = ooxml_types::print::UniversalMeasure::from_ooxml(paper_width);
        }
        if let Some(ref paper_height) = ps.paper_height {
            setup.paper_height = ooxml_types::print::UniversalMeasure::from_ooxml(paper_height);
        }
        if let Some(ref orient) = ps.orientation {
            setup.orientation = Orientation::from_ooxml(orient);
        }
        if let Some(scale) = ps.scale {
            setup.scale = Some(scale as u16);
        }
        if let Some(ftw) = ps.fit_to_width {
            setup.fit_to_width = Some(ftw as u16);
        }
        if let Some(fth) = ps.fit_to_height {
            setup.fit_to_height = Some(fth as u16);
        }
        setup.black_and_white = ps.black_and_white;
        setup.draft = ps.draft;
        if let Some(fpn) = ps.first_page_number {
            setup.first_page_number = Some(fpn);
        }
        setup.use_first_page_number = ps.use_first_page_number;
        if let Some(ref po) = ps.page_order {
            setup.page_order = Some(ooxml_types::print::PageOrder::from_ooxml(po));
        }
        setup.use_printer_defaults = ps.use_printer_defaults;
        if let Some(hdpi) = ps.horizontal_dpi {
            setup.horizontal_dpi = Some(hdpi);
        }
        if let Some(vdpi) = ps.vertical_dpi {
            setup.vertical_dpi = Some(vdpi);
        }
        if let Some(copies) = ps.copies {
            setup.copies = Some(copies.max(1));
        }
        if let Some(ref rid) = ps.r_id {
            setup.r_id = Some(rid.clone());
        }
        // Cell comments
        if let Some(ref cc) = ps.cell_comments {
            setup.cell_comments = ooxml_types::print::CellComments::from_ooxml(cc);
        }
        // Print errors
        if let Some(ref pe) = ps.print_errors {
            setup.errors = ooxml_types::print::PrintErrors::from_ooxml(pe);
        }
        pw.set_page_setup(setup);
    }

    // Page margins
    if let Some(ref m) = ps.margins {
        pw.set_margins(OoxmlPageMargins {
            left: m.left,
            right: m.right,
            top: m.top,
            bottom: m.bottom,
            header: m.header,
            footer: m.footer,
        });
    }

    // Header/footer
    if let Some(ref hf) = ps.header_footer {
        let mut header_footer = HeaderFooter::default();
        header_footer.odd_header = hf.odd_header.clone();
        header_footer.odd_footer = hf.odd_footer.clone();
        header_footer.even_header = hf.even_header.clone();
        header_footer.even_footer = hf.even_footer.clone();
        header_footer.first_header = hf.first_header.clone();
        header_footer.first_footer = hf.first_footer.clone();
        header_footer.different_odd_even = hf.different_odd_even;
        header_footer.different_first = hf.different_first;
        header_footer.align_with_margins = hf.align_with_margins;
        header_footer.scale_with_doc = hf.scale_with_doc;
        pw.set_header_footer(header_footer);
    }

    // Print options (gridlines, headings, centering)
    if ps.gridlines
        || ps.headings
        || ps.h_centered
        || ps.v_centered
        || !ps.grid_lines_set
        || ps.has_print_options
    {
        let mut options = PrintOptions::default();
        options.grid_lines = ps.gridlines;
        options.grid_lines_set = ps.grid_lines_set;
        options.headings = ps.headings;
        options.horizontal_centered = ps.h_centered;
        options.vertical_centered = ps.v_centered;
        pw.set_print_options(options);
    }

    pw
}
