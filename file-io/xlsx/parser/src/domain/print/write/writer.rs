//! Print Writer implementation for worksheets.
//!
//! This module contains the main PrintWriter struct that provides methods for
//! configuring print settings and writing them to XML.

use super::header_footer::HeaderFooter;
use crate::domain::print::{
    CellComments, Orientation, PageMargins, PageOrder, PageSetup, PaperSize, PrintErrors,
    PrintOptions,
};
use crate::write::xml_writer::XmlWriter;

// ============================================================================
// Break Info
// ============================================================================

/// Information about a single page break, preserving all XML attributes.
#[derive(Debug, Clone)]
pub struct BreakInfo {
    /// Row or column index (0-based)
    pub id: u32,
    /// Minimum row/column for the break
    pub min: u32,
    /// Maximum row/column for the break
    pub max: u32,
    /// Whether this is a manual break
    pub manual: bool,
    /// Whether this is a page-to-page break
    pub pt: bool,
}

// ============================================================================
// Print Writer
// ============================================================================

/// Writer for print settings in a worksheet.
///
/// Collects print-related settings and generates the appropriate XML elements.
///
/// # Example
///
/// ```ignore
/// let mut writer = PrintWriter::new();
///
/// writer
///     .paper_size(PaperSize::A4)
///     .orientation(Orientation::Landscape)
///     .scale(75)
///     .center_horizontally()
///     .print_gridlines(true)
///     .header("&CPage &P of &N")
///     .footer("&L&D&R&F")
///     .add_row_break(25)
///     .add_row_break(50);
///
/// // Write to an XmlWriter
/// let mut xml_writer = XmlWriter::new();
/// writer.write_to(&mut xml_writer);
/// ```
#[derive(Debug, Clone, Default)]
pub struct PrintWriter {
    pub(crate) page_setup: Option<PageSetup>,
    pub(crate) margins: Option<PageMargins>,
    pub(crate) header_footer: Option<HeaderFooter>,
    pub(crate) print_options: Option<PrintOptions>,
    pub(crate) row_breaks: Vec<BreakInfo>,
    pub(crate) col_breaks: Vec<BreakInfo>,
}

impl PrintWriter {
    /// Create a new empty print writer.
    pub fn new() -> Self {
        Self::default()
    }

    // -------------------------------------------------------------------------
    // Page Setup Methods
    // -------------------------------------------------------------------------

    /// Set page setup settings.
    pub fn set_page_setup(&mut self, setup: PageSetup) -> &mut Self {
        self.page_setup = Some(setup);
        self
    }

    /// Set paper size.
    pub fn paper_size(&mut self, size: PaperSize) -> &mut Self {
        self.ensure_page_setup().paper_size = Some(size);
        self
    }

    /// Set orientation.
    pub fn orientation(&mut self, orientation: Orientation) -> &mut Self {
        self.ensure_page_setup().orientation = orientation;
        self
    }

    /// Set scale percentage (10-400).
    pub fn scale(&mut self, percent: u32) -> &mut Self {
        let clamped = percent.clamp(10, 400) as u16;
        let setup = self.ensure_page_setup();
        setup.scale = Some(clamped);
        // Clear fit-to-page when setting scale
        setup.fit_to_width = None;
        setup.fit_to_height = None;
        self
    }

    /// Set fit to pages (width x height).
    ///
    /// Setting this clears any scale percentage.
    /// Use 0 for automatic sizing in either dimension.
    pub fn fit_to_page(&mut self, width: u32, height: u32) -> &mut Self {
        let setup = self.ensure_page_setup();
        setup.fit_to_width = Some(width as u16);
        setup.fit_to_height = Some(height as u16);
        setup.scale = None; // Clear scale when using fit-to-page
        self
    }

    /// Set first page number.
    pub fn first_page_number(&mut self, number: u32) -> &mut Self {
        let setup = self.ensure_page_setup();
        setup.first_page_number = Some(number);
        setup.use_first_page_number = true;
        self
    }

    /// Set print DPI.
    pub fn dpi(&mut self, horizontal: u32, vertical: u32) -> &mut Self {
        let setup = self.ensure_page_setup();
        setup.horizontal_dpi = Some(horizontal);
        setup.vertical_dpi = Some(vertical);
        self
    }

    /// Set number of copies.
    pub fn copies(&mut self, count: u32) -> &mut Self {
        self.ensure_page_setup().copies = Some(count.max(1));
        self
    }

    /// Enable black and white printing.
    pub fn black_and_white(&mut self, enabled: bool) -> &mut Self {
        self.ensure_page_setup().black_and_white = enabled;
        self
    }

    /// Enable draft quality printing.
    pub fn draft(&mut self, enabled: bool) -> &mut Self {
        self.ensure_page_setup().draft = enabled;
        self
    }

    /// Set cell comments print mode.
    pub fn cell_comments(&mut self, mode: CellComments) -> &mut Self {
        self.ensure_page_setup().cell_comments = mode;
        self
    }

    /// Set print errors display mode.
    pub fn print_errors(&mut self, mode: PrintErrors) -> &mut Self {
        self.ensure_page_setup().errors = mode;
        self
    }

    /// Set page order.
    pub fn page_order(&mut self, order: PageOrder) -> &mut Self {
        self.ensure_page_setup().page_order = Some(order);
        self
    }

    /// Set or clear the printer settings relationship ID on `<pageSetup>`.
    pub fn set_printer_settings_r_id(&mut self, r_id: Option<String>) -> &mut Self {
        self.ensure_page_setup().r_id = r_id;
        self
    }

    // -------------------------------------------------------------------------
    // Margins Methods
    // -------------------------------------------------------------------------

    /// Set page margins.
    pub fn set_margins(&mut self, margins: PageMargins) -> &mut Self {
        self.margins = Some(margins);
        self
    }

    /// Set all margins to the same value.
    pub fn margins_all(&mut self, inches: f64) -> &mut Self {
        self.margins = Some(PageMargins {
            left: inches,
            right: inches,
            top: inches,
            bottom: inches,
            header: inches,
            footer: inches,
        });
        self
    }

    /// Set left/right margins.
    pub fn margins_lr(&mut self, left: f64, right: f64) -> &mut Self {
        let margins = self.ensure_margins();
        margins.left = left;
        margins.right = right;
        self
    }

    /// Set top/bottom margins.
    pub fn margins_tb(&mut self, top: f64, bottom: f64) -> &mut Self {
        let margins = self.ensure_margins();
        margins.top = top;
        margins.bottom = bottom;
        self
    }

    // -------------------------------------------------------------------------
    // Header/Footer Methods
    // -------------------------------------------------------------------------

    /// Set header/footer settings.
    pub fn set_header_footer(&mut self, hf: HeaderFooter) -> &mut Self {
        self.header_footer = Some(hf);
        self
    }

    /// Set simple header (centered text).
    pub fn header(&mut self, text: &str) -> &mut Self {
        self.ensure_header_footer().header(text);
        self
    }

    /// Set simple footer (centered text).
    pub fn footer(&mut self, text: &str) -> &mut Self {
        self.ensure_header_footer().footer(text);
        self
    }

    /// Set header with left/center/right sections.
    pub fn header_lcr(&mut self, left: &str, center: &str, right: &str) -> &mut Self {
        self.ensure_header_footer().header_lcr(left, center, right);
        self
    }

    /// Set footer with left/center/right sections.
    pub fn footer_lcr(&mut self, left: &str, center: &str, right: &str) -> &mut Self {
        self.ensure_header_footer().footer_lcr(left, center, right);
        self
    }

    // -------------------------------------------------------------------------
    // Print Options Methods
    // -------------------------------------------------------------------------

    /// Set print options.
    pub fn set_print_options(&mut self, options: PrintOptions) -> &mut Self {
        self.print_options = Some(options);
        self
    }

    /// Center content horizontally on page.
    pub fn center_horizontally(&mut self) -> &mut Self {
        self.ensure_print_options().horizontal_centered = true;
        self
    }

    /// Center content vertically on page.
    pub fn center_vertically(&mut self) -> &mut Self {
        self.ensure_print_options().vertical_centered = true;
        self
    }

    /// Print gridlines.
    pub fn print_gridlines(&mut self, print: bool) -> &mut Self {
        let options = self.ensure_print_options();
        options.grid_lines = print;
        options.grid_lines_set = true;
        self
    }

    /// Print row/column headings.
    pub fn print_headings(&mut self, print: bool) -> &mut Self {
        self.ensure_print_options().headings = print;
        self
    }

    // -------------------------------------------------------------------------
    // Page Break Methods
    // -------------------------------------------------------------------------

    /// Add a row page break (before the specified row).
    ///
    /// Row indices are 0-based. Uses the default max of 16383 (max column index).
    pub fn add_row_break(&mut self, row: u32) -> &mut Self {
        if !self.row_breaks.iter().any(|b| b.id == row) {
            self.row_breaks.push(BreakInfo {
                id: row,
                min: 0,
                max: 16383,
                manual: true,
                pt: false,
            });
        }
        self
    }

    /// Add a row page break with full attributes preserved from parsed XML.
    pub fn add_row_break_full(
        &mut self,
        id: u32,
        min: u32,
        max: u32,
        manual: bool,
        pt: bool,
    ) -> &mut Self {
        if !self.row_breaks.iter().any(|b| b.id == id) {
            self.row_breaks.push(BreakInfo {
                id,
                min,
                max,
                manual,
                pt,
            });
        }
        self
    }

    /// Add a column page break (before the specified column).
    ///
    /// Column indices are 0-based. Uses the default max of 1048575 (max row index).
    pub fn add_col_break(&mut self, col: u32) -> &mut Self {
        if !self.col_breaks.iter().any(|b| b.id == col) {
            self.col_breaks.push(BreakInfo {
                id: col,
                min: 0,
                max: 1048575,
                manual: true,
                pt: false,
            });
        }
        self
    }

    /// Add a column page break with full attributes preserved from parsed XML.
    pub fn add_col_break_full(
        &mut self,
        id: u32,
        min: u32,
        max: u32,
        manual: bool,
        pt: bool,
    ) -> &mut Self {
        if !self.col_breaks.iter().any(|b| b.id == id) {
            self.col_breaks.push(BreakInfo {
                id,
                min,
                max,
                manual,
                pt,
            });
        }
        self
    }

    /// Clear all row breaks.
    pub fn clear_row_breaks(&mut self) -> &mut Self {
        self.row_breaks.clear();
        self
    }

    /// Clear all column breaks.
    pub fn clear_col_breaks(&mut self) -> &mut Self {
        self.col_breaks.clear();
        self
    }

    // -------------------------------------------------------------------------
    // XML Generation
    // -------------------------------------------------------------------------

    /// Write all print elements to XmlWriter.
    ///
    /// Elements are written in the correct order for XLSX:
    /// 1. printOptions
    /// 2. pageMargins
    /// 3. pageSetup
    /// 4. headerFooter
    /// 5. rowBreaks
    /// 6. colBreaks
    pub fn write_to(&self, writer: &mut XmlWriter) {
        self.write_print_options(writer);
        self.write_page_margins(writer);
        self.write_page_setup(writer);
        self.write_header_footer(writer);
        self.write_row_breaks(writer);
        self.write_col_breaks(writer);
    }

    /// Check if any settings are configured.
    pub fn is_empty(&self) -> bool {
        self.page_setup.is_none()
            && self.margins.is_none()
            && self.header_footer.is_none()
            && self.print_options.is_none()
            && self.row_breaks.is_empty()
            && self.col_breaks.is_empty()
    }

    /// Generate XML for page margins only.
    pub fn margins_xml(&self) -> Option<Vec<u8>> {
        self.margins.as_ref().map(|_| {
            let mut writer = XmlWriter::new();
            self.write_page_margins(&mut writer);
            writer.finish()
        })
    }

    /// Generate XML for page setup only.
    pub fn page_setup_xml(&self) -> Option<Vec<u8>> {
        self.page_setup.as_ref().map(|_| {
            let mut writer = XmlWriter::new();
            self.write_page_setup(&mut writer);
            writer.finish()
        })
    }

    /// Generate XML for header/footer only.
    pub fn header_footer_xml(&self) -> Option<Vec<u8>> {
        self.header_footer.as_ref().map(|_| {
            let mut writer = XmlWriter::new();
            self.write_header_footer(&mut writer);
            writer.finish()
        })
    }

    // -------------------------------------------------------------------------
    // Private Helper Methods
    // -------------------------------------------------------------------------

    fn ensure_page_setup(&mut self) -> &mut PageSetup {
        self.page_setup.get_or_insert_with(PageSetup::default)
    }

    fn ensure_margins(&mut self) -> &mut PageMargins {
        self.margins.get_or_insert_with(PageMargins::default)
    }

    fn ensure_header_footer(&mut self) -> &mut HeaderFooter {
        self.header_footer.get_or_insert_with(HeaderFooter::new)
    }

    fn ensure_print_options(&mut self) -> &mut PrintOptions {
        self.print_options.get_or_insert_with(PrintOptions::default)
    }

    fn write_print_options(&self, writer: &mut XmlWriter) {
        if let Some(ref options) = self.print_options {
            // Always write <printOptions> when present (Some means the original had it).
            // If all values are at defaults, emit an empty self-closing element.
            let has_non_default = options.horizontal_centered
                || options.vertical_centered
                || options.headings
                || options.grid_lines
                || !options.grid_lines_set;

            if !has_non_default {
                // All defaults — emit empty element matching original <printOptions/>
                writer.start_element("printOptions").self_close();
                return;
            }

            writer.start_element("printOptions");

            if options.horizontal_centered {
                writer.attr("horizontalCentered", "1");
            }
            if options.vertical_centered {
                writer.attr("verticalCentered", "1");
            }
            if options.headings {
                writer.attr("headings", "1");
            }
            if options.grid_lines {
                writer.attr("gridLines", "1");
            }
            // gridLinesSet defaults to true in the spec; only write when false
            if !options.grid_lines_set {
                writer.attr("gridLinesSet", "0");
            }

            writer.self_close();
        }
    }

    fn write_page_margins(&self, writer: &mut XmlWriter) {
        if let Some(ref margins) = self.margins {
            writer
                .start_element("pageMargins")
                .attr("left", &format_f64(margins.left))
                .attr("right", &format_f64(margins.right))
                .attr("top", &format_f64(margins.top))
                .attr("bottom", &format_f64(margins.bottom))
                .attr("header", &format_f64(margins.header))
                .attr("footer", &format_f64(margins.footer))
                .self_close();
        }
    }

    fn write_page_setup(&self, writer: &mut XmlWriter) {
        if let Some(ref setup) = self.page_setup {
            writer.start_element("pageSetup");

            // Attributes in OOXML spec order (ECMA-376 CT_PageSetup):
            // paperSize, paperHeight, paperWidth, scale, firstPageNumber,
            // fitToWidth, fitToHeight, pageOrder, orientation,
            // usePrinterDefaults, blackAndWhite, draft, cellComments,
            // errors, useFirstPageNumber, copies, horizontalDpi, verticalDpi, r:id

            // Paper size — only emit when present in original
            if let Some(ps) = setup.paper_size {
                writer.attr_num("paperSize", ps.as_u32());
            }

            // Paper height/width (universal measure strings) — note: height before width in spec
            if let Some(ref ph) = setup.paper_height {
                writer.attr("paperHeight", ph.to_ooxml());
            }
            if let Some(ref pw) = setup.paper_width {
                writer.attr("paperWidth", pw.to_ooxml());
            }

            // Scale — only emit when present in original
            if let Some(s) = setup.scale {
                writer.attr_num("scale", s as u32);
            }

            // First page number — only emit when present in original
            if let Some(fpn) = setup.first_page_number {
                writer.attr_num("firstPageNumber", fpn);
            }

            // Fit to page — write each attribute only when present in the original.
            // None means the attribute was absent; Some(0) means explicitly set to 0 (auto/unlimited).
            if let Some(w) = setup.fit_to_width {
                writer.attr_num("fitToWidth", w as u32);
            }
            if let Some(h) = setup.fit_to_height {
                writer.attr_num("fitToHeight", h as u32);
            }

            // Page order — only emit when explicitly set in the original
            if let Some(po) = setup.page_order {
                writer.attr("pageOrder", po.to_ooxml());
            }

            // Orientation (omit if default)
            if setup.orientation != Orientation::Default {
                writer.attr("orientation", setup.orientation.to_ooxml());
            }

            // usePrinterDefaults — only write when explicitly set in the original
            if let Some(upd) = setup.use_printer_defaults {
                if !upd {
                    writer.attr("usePrinterDefaults", "0");
                } else {
                    writer.attr("usePrinterDefaults", "1");
                }
            }

            // Boolean flags
            if setup.black_and_white {
                writer.attr("blackAndWhite", "1");
            }
            if setup.draft {
                writer.attr("draft", "1");
            }

            // Cell comments (omit if default none)
            if setup.cell_comments != CellComments::None {
                writer.attr("cellComments", setup.cell_comments.to_ooxml());
            }

            // Print errors (omit if default displayed)
            if setup.errors != PrintErrors::Displayed {
                writer.attr("errors", setup.errors.to_ooxml());
            }

            // useFirstPageNumber
            if setup.use_first_page_number {
                writer.attr("useFirstPageNumber", "1");
            }

            // Copies — only emit when present in original
            if let Some(c) = setup.copies {
                writer.attr_num("copies", c);
            }

            // DPI
            if let Some(h_dpi) = setup.horizontal_dpi {
                writer.attr_num("horizontalDpi", h_dpi);
            }
            if let Some(v_dpi) = setup.vertical_dpi {
                writer.attr_num("verticalDpi", v_dpi);
            }

            // Relationship ID for printer settings part
            if let Some(ref r_id) = setup.r_id {
                writer.attr("r:id", r_id);
            }

            writer.self_close();
        }
    }

    fn write_header_footer(&self, writer: &mut XmlWriter) {
        if let Some(ref hf) = self.header_footer {
            // Always write <headerFooter> when present (Some means the original
            // had the element). Dropping it changes round-trip fidelity.
            writer.start_element("headerFooter");

            // Attributes (write only non-default values)
            if hf.different_odd_even {
                writer.attr("differentOddEven", "1");
            }
            if hf.different_first {
                writer.attr("differentFirst", "1");
            }
            if let Some(v) = hf.scale_with_doc {
                writer.attr("scaleWithDoc", if v { "1" } else { "0" });
            }
            if let Some(v) = hf.align_with_margins {
                writer.attr("alignWithMargins", if v { "1" } else { "0" });
            }

            // Check if we have child elements
            let has_children = hf.odd_header.is_some()
                || hf.odd_footer.is_some()
                || hf.even_header.is_some()
                || hf.even_footer.is_some()
                || hf.first_header.is_some()
                || hf.first_footer.is_some();

            if has_children {
                writer.end_attrs();

                // Write child elements in order
                if let Some(ref header) = hf.odd_header {
                    writer.element_with_text("oddHeader", &encode_header_footer_text(header));
                }
                if let Some(ref footer) = hf.odd_footer {
                    writer.element_with_text("oddFooter", &encode_header_footer_text(footer));
                }
                if let Some(ref header) = hf.even_header {
                    writer.element_with_text("evenHeader", &encode_header_footer_text(header));
                }
                if let Some(ref footer) = hf.even_footer {
                    writer.element_with_text("evenFooter", &encode_header_footer_text(footer));
                }
                if let Some(ref header) = hf.first_header {
                    writer.element_with_text("firstHeader", &encode_header_footer_text(header));
                }
                if let Some(ref footer) = hf.first_footer {
                    writer.element_with_text("firstFooter", &encode_header_footer_text(footer));
                }

                writer.end_element("headerFooter");
            } else {
                writer.self_close();
            }
        }
    }

    fn write_breaks(&self, writer: &mut XmlWriter, element_name: &str, breaks: &[BreakInfo]) {
        if breaks.is_empty() {
            return;
        }

        let mut sorted: Vec<&BreakInfo> = breaks.iter().collect();
        sorted.sort_by_key(|b| b.id);

        let manual_count = sorted.iter().filter(|b| b.manual).count();

        writer
            .start_element(element_name)
            .attr_num("count", sorted.len())
            .attr_num("manualBreakCount", manual_count)
            .end_attrs();

        for brk in sorted {
            writer.start_element("brk");
            writer.attr_num("id", brk.id);
            if brk.min != 0 {
                writer.attr_num("min", brk.min);
            }
            writer.attr_num("max", brk.max);
            if brk.manual {
                writer.attr("man", "1");
            }
            if brk.pt {
                writer.attr("pt", "1");
            }
            writer.self_close();
        }

        writer.end_element(element_name);
    }

    fn write_row_breaks(&self, writer: &mut XmlWriter) {
        self.write_breaks(writer, "rowBreaks", &self.row_breaks);
    }

    fn write_col_breaks(&self, writer: &mut XmlWriter) {
        self.write_breaks(writer, "colBreaks", &self.col_breaks);
    }
}

fn encode_header_footer_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            // Header/footer XML stores literal line breaks in real workbooks.
            // Escaping them as OOXML `_xNNNN_` text changes the footer content
            // and breaks parser/writer round-trip fidelity.
            '\r' | '\n' | '\t' => out.push(ch),
            _ => out.push(ch),
        }
    }
    out
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Format f64 for XML output using shortest representation that round-trips.
///
/// Uses Rust's built-in Display for f64 which produces the shortest decimal
/// representation that uniquely identifies the f64 value (Ryu algorithm).
/// This avoids IEEE 754 representation noise like `0.7` → `0.69999999999999996`.
pub fn format_f64(value: f64) -> String {
    // Check if value is effectively an integer
    if value.fract().abs() < f64::EPSILON && value.abs() < i64::MAX as f64 {
        format!("{}", value as i64)
    } else {
        // Rust's Display for f64 uses shortest-representation (Ryu algorithm),
        // producing e.g. "0.7" for the f64 closest to 0.7, while still preserving
        // full precision for values like 0.1968503937007874.
        format!("{}", value)
    }
}
