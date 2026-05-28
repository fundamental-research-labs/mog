use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSettings {
    pub paper_size: Option<u32>,
    /// Custom paper width, e.g. "210mm" or "8.5in".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper_width: Option<String>,
    /// Custom paper height, e.g. "297mm" or "11in".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper_height: Option<String>,
    /// "portrait", "landscape"
    pub orientation: Option<String>,
    /// Percentage
    pub scale: Option<u32>,
    pub fit_to_width: Option<u32>,
    pub fit_to_height: Option<u32>,
    pub gridlines: bool,
    pub headings: bool,
    pub h_centered: bool,
    pub v_centered: bool,
    pub margins: Option<PageMargins>,
    pub header_footer: Option<HeaderFooter>,
    pub black_and_white: bool,
    pub draft: bool,
    pub first_page_number: Option<u32>,
    /// Page order: "downThenOver" or "overThenDown".
    /// None means the original had no pageOrder attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_order: Option<String>,
    /// Whether to use printer defaults (ECMA-376 default is true).
    /// None means the original had no usePrinterDefaults attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_printer_defaults: Option<bool>,
    /// Horizontal DPI for printing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizontal_dpi: Option<u32>,
    /// Vertical DPI for printing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vertical_dpi: Option<u32>,
    /// Printer settings relationship ID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r_id: Option<String>,
    /// Imported printer-settings binary identity. This is a non-authoritative
    /// hint: export may reuse the binary path only while the current modeled
    /// pageSetup fields still match this snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imported_printer_settings: Option<ImportedPrinterSettingsIdentity>,
    /// Whether a `<printOptions>` element was present in the original XML.
    /// When true, the writer emits `<printOptions/>` even if all values are defaults.
    #[serde(default)]
    pub has_print_options: bool,
    /// Whether to use the first page number instead of auto numbering.
    #[serde(default)]
    pub use_first_page_number: bool,
    /// Whether a `<pageSetup>` element was present in the original XML.
    #[serde(default)]
    pub has_page_setup: bool,
    /// Number of copies to print.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copies: Option<u32>,
    /// PrintOptions gridLinesSet flag. OOXML defaults this to true.
    #[serde(default = "default_grid_lines_set")]
    pub grid_lines_set: bool,
    /// `<sheetPr><pageSetUpPr>` print-related sheet properties.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_setup_properties: Option<PageSetupProperties>,
    /// How to print cell comments: "none", "atEnd", "asDisplayed".
    /// None means the attribute was absent (defaults to "none").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_comments: Option<String>,
    /// How to print cell errors: "displayed", "blank", "dash", "NA".
    /// None means the attribute was absent (defaults to "displayed").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub print_errors: Option<String>,
}

fn default_grid_lines_set() -> bool {
    true
}

impl Default for PrintSettings {
    fn default() -> Self {
        Self {
            paper_size: None,
            paper_width: None,
            paper_height: None,
            orientation: None,
            scale: None,
            fit_to_width: None,
            fit_to_height: None,
            gridlines: false,
            headings: false,
            h_centered: false,
            v_centered: false,
            margins: None,
            header_footer: None,
            black_and_white: false,
            draft: false,
            first_page_number: None,
            page_order: None,
            use_printer_defaults: None,
            horizontal_dpi: None,
            vertical_dpi: None,
            r_id: None,
            imported_printer_settings: None,
            has_print_options: false,
            use_first_page_number: false,
            has_page_setup: false,
            copies: None,
            grid_lines_set: true,
            page_setup_properties: None,
            cell_comments: None,
            print_errors: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetupProperties {
    #[serde(default = "default_auto_page_breaks")]
    pub auto_page_breaks: bool,
    #[serde(default)]
    pub fit_to_page: bool,
}

fn default_auto_page_breaks() -> bool {
    true
}

impl Default for PageSetupProperties {
    fn default() -> Self {
        Self {
            auto_page_breaks: true,
            fit_to_page: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct ImportedPrinterSettingsIdentity {
    pub path: String,
    pub relationship_id: Option<String>,
    pub page_setup: PrinterSettingsPageSetupFingerprint,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct PrinterSettingsPageSetupFingerprint {
    pub paper_size: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper_width: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper_height: Option<String>,
    pub orientation: Option<String>,
    pub scale: Option<u32>,
    pub fit_to_width: Option<u32>,
    pub fit_to_height: Option<u32>,
    pub black_and_white: bool,
    pub draft: bool,
    pub first_page_number: Option<u32>,
    pub page_order: Option<String>,
    pub use_printer_defaults: Option<bool>,
    pub horizontal_dpi: Option<u32>,
    pub vertical_dpi: Option<u32>,
    pub use_first_page_number: bool,
    pub has_page_setup: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub copies: Option<u32>,
    pub cell_comments: Option<String>,
    pub print_errors: Option<String>,
}

impl PrinterSettingsPageSetupFingerprint {
    pub fn from_print_settings(settings: &PrintSettings) -> Self {
        Self {
            paper_size: settings.paper_size,
            paper_width: settings.paper_width.clone(),
            paper_height: settings.paper_height.clone(),
            orientation: settings.orientation.clone(),
            scale: settings.scale,
            fit_to_width: settings.fit_to_width,
            fit_to_height: settings.fit_to_height,
            black_and_white: settings.black_and_white,
            draft: settings.draft,
            first_page_number: settings.first_page_number,
            page_order: settings.page_order.clone(),
            use_printer_defaults: settings.use_printer_defaults,
            horizontal_dpi: settings.horizontal_dpi,
            vertical_dpi: settings.vertical_dpi,
            use_first_page_number: settings.use_first_page_number,
            has_page_setup: settings.has_page_setup,
            copies: settings.copies,
            cell_comments: settings.cell_comments.clone(),
            print_errors: settings.print_errors.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageMargins {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
    pub header: f64,
    pub footer: f64,
}

impl Default for PageMargins {
    fn default() -> Self {
        Self {
            top: 0.75,
            bottom: 0.75,
            left: 0.7,
            right: 0.7,
            header: 0.3,
            footer: 0.3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct HeaderFooter {
    pub odd_header: Option<String>,
    pub odd_footer: Option<String>,
    pub even_header: Option<String>,
    pub even_footer: Option<String>,
    pub first_header: Option<String>,
    pub first_footer: Option<String>,
    pub different_odd_even: bool,
    pub different_first: bool,
    /// Whether header/footer should scale with document scaling.
    /// None means not specified (ECMA-376 default is true).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_with_doc: Option<bool>,
    /// Whether header/footer should align with page margins.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align_with_margins: Option<bool>,
}

/// A single page break entry preserving all OOXML attributes for round-trip fidelity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageBreakEntry {
    /// Row or column index where the break occurs.
    pub id: u32,
    /// Minimum row/column for the break.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub min: u32,
    /// Maximum row/column for the break.
    pub max: u32,
    /// Whether this is a manual break.
    #[serde(default)]
    pub manual: bool,
    /// Whether this is a page-to-page break.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pt: bool,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PageBreaks {
    pub row_breaks: Vec<PageBreakEntry>,
    pub col_breaks: Vec<PageBreakEntry>,
}

/// Position of a header/footer image in the page layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HfImagePosition {
    LeftHeader,
    CenterHeader,
    RightHeader,
    LeftFooter,
    CenterFooter,
    RightFooter,
}

/// Header/footer image metadata stored in the compute engine document.
///
/// Follows the floating-object pattern: stores image references (path or data-URL),
/// not binary blobs. Image binaries live in BinaryPassthrough (round-trip) or are
/// decoded from data-URLs on export (API-created).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderFooterImageInfo {
    pub position: HfImagePosition,
    /// Image source — resolved path (e.g., "../media/image1.png") for imported,
    /// or data-URL ("data:image/png;base64,...") for API-created.
    pub src: String,
    /// Descriptive title.
    pub title: String,
    /// Width in points.
    pub width_pt: f64,
    /// Height in points.
    pub height_pt: f64,
}
