use super::{
    enums::{CellComments, Orientation, PageOrder, PrintErrors},
    measure::UniversalMeasure,
    paper::PaperSize,
};

/// Page setup settings (ECMA-376 CT_PageSetup).
///
/// Controls paper size, orientation, scaling, and other print layout settings.
/// Optional fields use `Option<u32>` to distinguish "not set" from "set to a value".
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PageSetup {
    /// Paper size ID
    pub paper_size: PaperSize,
    /// Custom paper width as a universal measure (e.g., `"210mm"`, `"8.5in"`)
    pub paper_width: Option<UniversalMeasure>,
    /// Custom paper height as a universal measure (e.g., `"297mm"`, `"11in"`)
    pub paper_height: Option<UniversalMeasure>,
    /// Page orientation
    pub orientation: Orientation,
    /// Scale percentage (10-400, 100 = 100%)
    pub scale: Option<u32>,
    /// Fit to width in pages (0 = auto)
    pub fit_to_width: Option<u32>,
    /// Fit to height in pages (0 = auto)
    pub fit_to_height: Option<u32>,
    /// First page number (0 = auto)
    pub first_page_number: Option<u32>,
    /// Use first page number setting
    pub use_first_page_number: bool,
    /// Page order for printing
    pub page_order: PageOrder,
    /// Print in black and white
    pub black_and_white: bool,
    /// Print in draft quality
    pub draft: bool,
    /// How to print cell comments
    pub cell_comments: CellComments,
    /// How to print cell errors
    pub print_errors: PrintErrors,
    /// Horizontal DPI
    pub horizontal_dpi: Option<u32>,
    /// Vertical DPI
    pub vertical_dpi: Option<u32>,
    /// Number of copies to print
    pub copies: Option<u32>,
    /// Whether to use printer defaults for unspecified settings (ECMA-376 §18.3.1.63). Default: `true`.
    pub use_printer_defaults: bool,
    /// Relationship ID pointing to the printer settings binary part.
    pub r_id: Option<String>,
}

impl Default for PageSetup {
    fn default() -> Self {
        Self {
            paper_size: PaperSize::Letter,
            paper_width: None,
            paper_height: None,
            orientation: Orientation::Default,
            scale: None,
            fit_to_width: None,
            fit_to_height: None,
            first_page_number: None,
            use_first_page_number: false,
            page_order: PageOrder::DownThenOver,
            black_and_white: false,
            draft: false,
            cell_comments: CellComments::None,
            print_errors: PrintErrors::Displayed,
            horizontal_dpi: None,
            vertical_dpi: None,
            copies: None,
            use_printer_defaults: true,
            r_id: None,
        }
    }
}
