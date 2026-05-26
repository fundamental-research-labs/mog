//! Print settings types (ECMA-376 CT_PageSetup, CT_PageMargins, CT_HeaderFooter, CT_PrintOptions, CT_PageBreak).
//!
//! Unified from xlsx-parser read (`print/page_setup.rs`, `print/header_footer.rs`,
//! `print/print_options.rs`) and write (`write/print/types.rs`) sides.

// ============================================================================
// Header/Footer Format Code Constants
// ============================================================================

/// Header/footer format codes for use in headers and footers.
///
/// These codes are interpreted by Excel when rendering headers and footers.
///
/// # Example
///
/// ```
/// use ooxml_types::print::hf_codes;
///
/// // Create a header with page number on the right
/// let header = format!("{}Page {}", hf_codes::RIGHT_SECTION, hf_codes::PAGE_NUMBER);
/// // Result: "&RPage &P"
/// ```
pub mod hf_codes {
    /// Current page number (`&P`)
    pub const PAGE_NUMBER: &str = "&P";
    /// Total number of pages (`&N`)
    pub const TOTAL_PAGES: &str = "&N";
    /// Current date (`&D`)
    pub const DATE: &str = "&D";
    /// Current time (`&T`)
    pub const TIME: &str = "&T";
    /// File path (`&Z`)
    pub const FILE_PATH: &str = "&Z";
    /// File name (`&F`)
    pub const FILE_NAME: &str = "&F";
    /// Sheet name (tab name) (`&A`)
    pub const SHEET_NAME: &str = "&A";
    /// Bold on/off toggle (`&B`)
    pub const BOLD_ON: &str = "&B";
    /// Italic on/off toggle (`&I`)
    pub const ITALIC_ON: &str = "&I";
    /// Underline on/off toggle (`&U`)
    pub const UNDERLINE_ON: &str = "&U";
    /// Strikethrough on/off toggle (`&S`)
    pub const STRIKETHROUGH_ON: &str = "&S";
    /// Subscript on/off toggle (`&Y`)
    pub const SUBSCRIPT_ON: &str = "&Y";
    /// Superscript on/off toggle (`&X`)
    pub const SUPERSCRIPT_ON: &str = "&X";
    /// Left section marker (`&L`)
    pub const LEFT_SECTION: &str = "&L";
    /// Center section marker (`&C`)
    pub const CENTER_SECTION: &str = "&C";
    /// Right section marker (`&R`)
    pub const RIGHT_SECTION: &str = "&R";
    /// Double underline toggle (`&E`)
    pub const DOUBLE_UNDERLINE_ON: &str = "&E";
    /// Picture/graphic placeholder (`&G`)
    pub const PICTURE: &str = "&G";

    /// Create a font specification code.
    ///
    /// # Arguments
    /// * `name` - Font family name (e.g., "Arial")
    /// * `style` - Font style (e.g., "Bold", "Italic", "Regular")
    ///
    /// # Returns
    /// A string like `&"Arial,Bold"`
    pub fn font(name: &str, style: &str) -> String {
        format!("&\"{},{}\"", name, style)
    }

    /// Create a font size code.
    ///
    /// # Arguments
    /// * `size` - Font size in points
    ///
    /// # Returns
    /// A string like `&12`
    pub fn font_size(size: u8) -> String {
        format!("&{}", size)
    }

    /// Create a font color code (RGB hex).
    ///
    /// # Arguments
    /// * `rgb` - RGB color as 6-character hex string (e.g., "FF0000" for red)
    ///
    /// # Returns
    /// A string like `&KFF0000`
    pub fn font_color(rgb: &str) -> String {
        format!("&K{}", rgb)
    }
}

// ============================================================================
// Paper Size Enumeration
// ============================================================================

/// Standard paper sizes (ECMA-376 ST_PaperSize).
///
/// Excel uses numeric IDs to represent paper sizes. This enum covers
/// the most commonly used paper sizes (IDs 1-41). Unknown or vendor-specific
/// IDs are preserved via the `Other(u32)` variant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, Default)]
pub enum PaperSize {
    /// Letter (8.5" x 11") - US default
    #[default]
    Letter,
    /// Letter Small (8.5" x 11")
    LetterSmall,
    /// Tabloid (11" x 17")
    Tabloid,
    /// Ledger (17" x 11")
    Ledger,
    /// Legal (8.5" x 14")
    Legal,
    /// Statement (5.5" x 8.5")
    Statement,
    /// Executive (7.25" x 10.5")
    Executive,
    /// A3 (297mm x 420mm)
    A3,
    /// A4 (210mm x 297mm)
    A4,
    /// A4 Small (210mm x 297mm)
    A4Small,
    /// A5 (148mm x 210mm)
    A5,
    /// B4 JIS (257mm x 364mm)
    B4,
    /// B5 JIS (182mm x 257mm)
    B5,
    /// Folio (8.5" x 13")
    Folio,
    /// Quarto (215mm x 275mm)
    Quarto,
    /// 10" x 14"
    Size10x14,
    /// 11" x 17"
    Size11x17,
    /// Note (8.5" x 11")
    Note,
    /// Envelope #9 (3.875" x 8.875")
    Envelope9,
    /// Envelope #10 (4.125" x 9.5")
    Envelope10,
    /// Envelope #11 (4.5" x 10.375")
    Envelope11,
    /// Envelope #12 (4.75" x 11")
    Envelope12,
    /// Envelope #14 (5" x 11.5")
    Envelope14,
    /// C size sheet (17" x 22")
    CSheet,
    /// D size sheet (22" x 34")
    DSheet,
    /// E size sheet (34" x 44")
    ESheet,
    /// Envelope DL (110mm x 220mm)
    EnvelopeDL,
    /// Envelope C5 (162mm x 229mm)
    EnvelopeC5,
    /// Envelope C3 (324mm x 458mm)
    EnvelopeC3,
    /// Envelope C4 (229mm x 324mm)
    EnvelopeC4,
    /// Envelope C6 (114mm x 162mm)
    EnvelopeC6,
    /// Envelope C65 (114mm x 229mm)
    EnvelopeC65,
    /// Envelope B4 (250mm x 353mm)
    EnvelopeB4,
    /// Envelope B5 (176mm x 250mm)
    EnvelopeB5,
    /// Envelope B6 (176mm x 125mm)
    EnvelopeB6,
    /// Envelope Italy (110mm x 230mm)
    EnvelopeItaly,
    /// Envelope Monarch (3.875" x 7.5")
    EnvelopeMonarch,
    /// 6 3/4 Envelope (3.625" x 6.5")
    Envelope634,
    /// US Standard Fanfold (14.875" x 11")
    USStdFanfold,
    /// German Standard Fanfold (8.5" x 12")
    GermanStdFanfold,
    /// German Legal Fanfold (8.5" x 13")
    GermanLegalFanfold,
    /// Unknown or vendor-specific paper size ID not in the standard range 1-41.
    Other(u32),
}

impl PaperSize {
    /// Create from a numeric paper-size ID.
    pub fn from_u32(value: u32) -> Self {
        match value {
            1 => Self::Letter,
            2 => Self::LetterSmall,
            3 => Self::Tabloid,
            4 => Self::Ledger,
            5 => Self::Legal,
            6 => Self::Statement,
            7 => Self::Executive,
            8 => Self::A3,
            9 => Self::A4,
            10 => Self::A4Small,
            11 => Self::A5,
            12 => Self::B4,
            13 => Self::B5,
            14 => Self::Folio,
            15 => Self::Quarto,
            16 => Self::Size10x14,
            17 => Self::Size11x17,
            18 => Self::Note,
            19 => Self::Envelope9,
            20 => Self::Envelope10,
            21 => Self::Envelope11,
            22 => Self::Envelope12,
            23 => Self::Envelope14,
            24 => Self::CSheet,
            25 => Self::DSheet,
            26 => Self::ESheet,
            27 => Self::EnvelopeDL,
            28 => Self::EnvelopeC5,
            29 => Self::EnvelopeC3,
            30 => Self::EnvelopeC4,
            31 => Self::EnvelopeC6,
            32 => Self::EnvelopeC65,
            33 => Self::EnvelopeB4,
            34 => Self::EnvelopeB5,
            35 => Self::EnvelopeB6,
            36 => Self::EnvelopeItaly,
            37 => Self::EnvelopeMonarch,
            38 => Self::Envelope634,
            39 => Self::USStdFanfold,
            40 => Self::GermanStdFanfold,
            41 => Self::GermanLegalFanfold,
            n => Self::Other(n),
        }
    }

    /// Get the numeric ID for this paper size.
    pub fn as_u32(&self) -> u32 {
        match self {
            Self::Letter => 1,
            Self::LetterSmall => 2,
            Self::Tabloid => 3,
            Self::Ledger => 4,
            Self::Legal => 5,
            Self::Statement => 6,
            Self::Executive => 7,
            Self::A3 => 8,
            Self::A4 => 9,
            Self::A4Small => 10,
            Self::A5 => 11,
            Self::B4 => 12,
            Self::B5 => 13,
            Self::Folio => 14,
            Self::Quarto => 15,
            Self::Size10x14 => 16,
            Self::Size11x17 => 17,
            Self::Note => 18,
            Self::Envelope9 => 19,
            Self::Envelope10 => 20,
            Self::Envelope11 => 21,
            Self::Envelope12 => 22,
            Self::Envelope14 => 23,
            Self::CSheet => 24,
            Self::DSheet => 25,
            Self::ESheet => 26,
            Self::EnvelopeDL => 27,
            Self::EnvelopeC5 => 28,
            Self::EnvelopeC3 => 29,
            Self::EnvelopeC4 => 30,
            Self::EnvelopeC6 => 31,
            Self::EnvelopeC65 => 32,
            Self::EnvelopeB4 => 33,
            Self::EnvelopeB5 => 34,
            Self::EnvelopeB6 => 35,
            Self::EnvelopeItaly => 36,
            Self::EnvelopeMonarch => 37,
            Self::Envelope634 => 38,
            Self::USStdFanfold => 39,
            Self::GermanStdFanfold => 40,
            Self::GermanLegalFanfold => 41,
            Self::Other(n) => *n,
        }
    }

    /// Get the human-readable display name for this paper size.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Letter => "Letter",
            Self::LetterSmall => "Letter Small",
            Self::Tabloid => "Tabloid",
            Self::Ledger => "Ledger",
            Self::Legal => "Legal",
            Self::Statement => "Statement",
            Self::Executive => "Executive",
            Self::A3 => "A3",
            Self::A4 => "A4",
            Self::A4Small => "A4 Small",
            Self::A5 => "A5",
            Self::B4 => "B4 (JIS)",
            Self::B5 => "B5 (JIS)",
            Self::Folio => "Folio",
            Self::Quarto => "Quarto",
            Self::Size10x14 => "10x14",
            Self::Size11x17 => "11x17",
            Self::Note => "Note",
            Self::Envelope9 => "Envelope #9",
            Self::Envelope10 => "Envelope #10",
            Self::Envelope11 => "Envelope #11",
            Self::Envelope12 => "Envelope #12",
            Self::Envelope14 => "Envelope #14",
            Self::CSheet => "C Sheet",
            Self::DSheet => "D Sheet",
            Self::ESheet => "E Sheet",
            Self::EnvelopeDL => "Envelope DL",
            Self::EnvelopeC5 => "Envelope C5",
            Self::EnvelopeC3 => "Envelope C3",
            Self::EnvelopeC4 => "Envelope C4",
            Self::EnvelopeC6 => "Envelope C6",
            Self::EnvelopeC65 => "Envelope C65",
            Self::EnvelopeB4 => "Envelope B4",
            Self::EnvelopeB5 => "Envelope B5",
            Self::EnvelopeB6 => "Envelope B6",
            Self::EnvelopeItaly => "Envelope Italy",
            Self::EnvelopeMonarch => "Envelope Monarch",
            Self::Envelope634 => "6 3/4 Envelope",
            Self::USStdFanfold => "US Std Fanfold",
            Self::GermanStdFanfold => "German Std Fanfold",
            Self::GermanLegalFanfold => "German Legal Fanfold",
            Self::Other(_) => "Other",
        }
    }
}

// ============================================================================
// Orientation Enumeration
// ============================================================================

/// Page orientation (ECMA-376 ST_Orientation).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum Orientation {
    /// Default orientation (usually portrait)
    #[default]
    Default,
    /// Portrait orientation (taller than wide)
    Portrait,
    /// Landscape orientation (wider than tall)
    Landscape,
}

impl Orientation {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "default" => Self::Default,
            "portrait" => Self::Portrait,
            "landscape" => Self::Landscape,
            _ => Self::Default,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Portrait => "portrait",
            Self::Landscape => "landscape",
        }
    }
}

// ============================================================================
// Page Order Enumeration
// ============================================================================

/// Page order for printing (ECMA-376 ST_PageOrder).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum PageOrder {
    /// Print down, then over (default)
    #[default]
    DownThenOver,
    /// Print over, then down
    OverThenDown,
}

impl PageOrder {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "downThenOver" => Self::DownThenOver,
            "overThenDown" => Self::OverThenDown,
            _ => Self::DownThenOver,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::DownThenOver => "downThenOver",
            Self::OverThenDown => "overThenDown",
        }
    }
}

// ============================================================================
// Cell Comments Print Location
// ============================================================================

/// How to print cell comments (ECMA-376 ST_CellComments).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum CellComments {
    /// Don't print comments (default)
    #[default]
    None,
    /// Print comments at the end of the sheet
    AtEnd,
    /// Print comments as displayed on sheet
    AsDisplayed,
}

impl CellComments {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "atEnd" => Self::AtEnd,
            "asDisplayed" => Self::AsDisplayed,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::AtEnd => "atEnd",
            Self::AsDisplayed => "asDisplayed",
        }
    }
}

// ============================================================================
// Print Error Display Mode
// ============================================================================

/// How to print cell errors (ECMA-376 ST_PrintError).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum PrintErrors {
    /// Print errors as displayed (default)
    #[default]
    Displayed,
    /// Print blank instead of errors
    Blank,
    /// Print dashes instead of errors
    Dash,
    /// Print "N/A" instead of errors
    NA,
}

impl PrintErrors {
    /// Parse from an OOXML attribute value.
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "displayed" => Self::Displayed,
            "blank" => Self::Blank,
            "dash" => Self::Dash,
            "NA" => Self::NA,
            _ => Self::Displayed,
        }
    }

    /// Serialize to the OOXML attribute value.
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Displayed => "displayed",
            Self::Blank => "blank",
            Self::Dash => "dash",
            Self::NA => "NA",
        }
    }
}

// ============================================================================
// Page Margins
// ============================================================================

/// Page margin settings (ECMA-376 CT_PageMargins).
///
/// All margin values are in inches.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PageMargins {
    /// Left margin in inches
    pub left: f64,
    /// Right margin in inches
    pub right: f64,
    /// Top margin in inches
    pub top: f64,
    /// Bottom margin in inches
    pub bottom: f64,
    /// Header margin in inches (from top edge to header)
    pub header: f64,
    /// Footer margin in inches (from bottom edge to footer)
    pub footer: f64,
}

impl Default for PageMargins {
    /// Default Excel margins (0.7" left/right, 0.75" top/bottom, 0.3" header/footer).
    fn default() -> Self {
        Self {
            left: 0.7,
            right: 0.7,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
        }
    }
}

impl PageMargins {
    /// Create new page margins with explicit values.
    pub fn new(left: f64, right: f64, top: f64, bottom: f64, header: f64, footer: f64) -> Self {
        Self {
            left,
            right,
            top,
            bottom,
            header,
            footer,
        }
    }

    /// Default Excel margins (alias for `Default::default()`).
    pub fn excel_default() -> Self {
        Self::default()
    }

    /// Create margins with all values set to the same amount.
    pub fn uniform(inches: f64) -> Self {
        Self {
            left: inches,
            right: inches,
            top: inches,
            bottom: inches,
            header: inches,
            footer: inches,
        }
    }

    /// Create narrow margins (0.25" left/right, 0.75" top/bottom, 0.3" header/footer).
    pub fn narrow() -> Self {
        Self {
            left: 0.25,
            right: 0.25,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
        }
    }

    /// Create wide margins (1" left/right/top/bottom, 0.5" header/footer).
    pub fn wide() -> Self {
        Self {
            left: 1.0,
            right: 1.0,
            top: 1.0,
            bottom: 1.0,
            header: 0.5,
            footer: 0.5,
        }
    }
}

// ============================================================================
// Universal Measure (ST_PositiveUniversalMeasure)
// ============================================================================

/// A positive measurement with unit (ECMA-376 ST_PositiveUniversalMeasure).
///
/// Stores the raw string exactly as it appears in XML (e.g., `"210mm"`, `"8.5in"`).
/// Provides type-safe parsing, validation, and unit conversion.
///
/// # Valid formats
/// - `"210mm"` — millimeters
/// - `"8.5in"` — inches
/// - `"21cm"` — centimeters
/// - `"612pt"` — points (1/72 inch)
/// - `"914400emu"` — English Metric Units (1/914400 inch)
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct UniversalMeasure {
    raw: String,
}

/// Unit of measurement for ST_PositiveUniversalMeasure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MeasureUnit {
    /// Inches
    Inches,
    /// Millimeters
    Millimeters,
    /// Centimeters
    Centimeters,
    /// Points (1/72 inch)
    Points,
    /// Picas (1/6 inch; OOXML "pc" or "pi")
    Picas,
    /// English Metric Units (1/914400 inch)
    Emu,
}

impl UniversalMeasure {
    /// Parse from an OOXML attribute value. Returns `None` if the format is invalid.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Option<Self> {
        let s = s.trim();
        if s.is_empty() {
            return None;
        }
        // Validate: must have numeric prefix + known unit suffix
        Self::parse_parts(s)?;
        Some(Self { raw: s.to_string() })
    }

    /// Create from inches.
    #[must_use]
    pub fn inches(value: f64) -> Self {
        Self {
            raw: format!("{value}in"),
        }
    }

    /// Create from millimeters.
    #[must_use]
    pub fn millimeters(value: f64) -> Self {
        Self {
            raw: format!("{value}mm"),
        }
    }

    /// Create from centimeters.
    #[must_use]
    pub fn centimeters(value: f64) -> Self {
        Self {
            raw: format!("{value}cm"),
        }
    }

    /// Create from points.
    #[must_use]
    pub fn points(value: f64) -> Self {
        Self {
            raw: format!("{value}pt"),
        }
    }

    /// Create from picas.
    #[must_use]
    pub fn picas(value: f64) -> Self {
        Self {
            raw: format!("{value}pc"),
        }
    }

    /// Get the raw OOXML string representation.
    #[must_use]
    pub fn to_ooxml(&self) -> &str {
        &self.raw
    }

    /// Convert to inches.
    #[must_use]
    pub fn to_inches(&self) -> f64 {
        let (value, unit) = Self::parse_parts(&self.raw).unwrap_or((0.0, MeasureUnit::Inches));
        match unit {
            MeasureUnit::Inches => value,
            MeasureUnit::Millimeters => value / 25.4,
            MeasureUnit::Centimeters => value / 2.54,
            MeasureUnit::Points => value / 72.0,
            MeasureUnit::Picas => value / 6.0,
            MeasureUnit::Emu => value / 914400.0,
        }
    }

    /// Convert to millimeters.
    #[must_use]
    pub fn to_mm(&self) -> f64 {
        self.to_inches() * 25.4
    }

    /// Get the unit of this measurement.
    #[must_use]
    pub fn unit(&self) -> MeasureUnit {
        Self::parse_parts(&self.raw)
            .map(|(_, u)| u)
            .unwrap_or(MeasureUnit::Inches)
    }

    /// Get the numeric value in its original unit.
    #[must_use]
    pub fn value(&self) -> f64 {
        Self::parse_parts(&self.raw).map(|(v, _)| v).unwrap_or(0.0)
    }

    fn parse_parts(s: &str) -> Option<(f64, MeasureUnit)> {
        let s = s.trim();
        // Order matters: check longer suffixes first to avoid "mm" matching "m" prefix
        if let Some(num) = s.strip_suffix("emu") {
            Some((num.parse().ok()?, MeasureUnit::Emu))
        } else if let Some(num) = s.strip_suffix("mm") {
            Some((num.parse().ok()?, MeasureUnit::Millimeters))
        } else if let Some(num) = s.strip_suffix("cm") {
            Some((num.parse().ok()?, MeasureUnit::Centimeters))
        } else if let Some(num) = s.strip_suffix("pc") {
            Some((num.parse().ok()?, MeasureUnit::Picas))
        } else if let Some(num) = s.strip_suffix("pi") {
            Some((num.parse().ok()?, MeasureUnit::Picas))
        } else if let Some(num) = s.strip_suffix("pt") {
            Some((num.parse().ok()?, MeasureUnit::Points))
        } else if let Some(num) = s.strip_suffix("in") {
            Some((num.parse().ok()?, MeasureUnit::Inches))
        } else {
            None
        }
    }
}

// ============================================================================
// Page Setup
// ============================================================================

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

// ============================================================================
// Print Options
// ============================================================================

/// Print options (ECMA-376 CT_PrintOptions).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct PrintOptions {
    /// Print gridlines
    pub grid_lines: bool,
    /// Print row and column headings (1, 2, 3... and A, B, C...)
    pub headings: bool,
    /// Center content horizontally on page
    pub horizontal_centered: bool,
    /// Center content vertically on page
    pub vertical_centered: bool,
    /// Grid lines setting was explicitly set
    pub grid_lines_set: bool,
}

impl Default for PrintOptions {
    fn default() -> Self {
        Self {
            grid_lines: false,
            headings: false,
            horizontal_centered: false,
            vertical_centered: false,
            grid_lines_set: true, // ECMA-376 §18.3.1.70 default
        }
    }
}

// ============================================================================
// Header/Footer Section
// ============================================================================

/// Represents a parsed section of a header or footer.
///
/// A header/footer string is divided into left, center, and right sections
/// by the `&L`, `&C`, and `&R` delimiters. Other format codes (like `&P`
/// for page number) are preserved verbatim in the section text.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HeaderFooterSection {
    /// Left-aligned content
    pub left: String,
    /// Center-aligned content
    pub center: String,
    /// Right-aligned content
    pub right: String,
}

impl HeaderFooterSection {
    /// Parse a header/footer string into sections.
    ///
    /// Format codes `&L`, `&C`, `&R` delimit sections (case-insensitive).
    /// Other format codes (`&P`, `&N`, `&D`, etc.) are preserved in the content.
    ///
    /// Text before any section marker defaults to the center section.
    ///
    /// # Example
    ///
    /// ```
    /// use ooxml_types::print::HeaderFooterSection;
    ///
    /// let section = HeaderFooterSection::parse("&LPage &P of &N&C&D&RFile: &F");
    /// assert_eq!(section.left, "Page &P of &N");
    /// assert_eq!(section.center, "&D");
    /// assert_eq!(section.right, "File: &F");
    /// ```
    pub fn parse(content: &str) -> Self {
        let mut section = HeaderFooterSection::default();
        let mut current_section = &mut section.center; // Default to center
        let mut chars = content.chars().peekable();
        let mut current_text = String::new();

        while let Some(ch) = chars.next() {
            if ch == '&' {
                if let Some(&next_ch) = chars.peek() {
                    match next_ch {
                        'L' | 'l' => {
                            if !current_text.is_empty() {
                                current_section.push_str(&current_text);
                                current_text.clear();
                            }
                            current_section = &mut section.left;
                            chars.next();
                        }
                        'C' | 'c' => {
                            if !current_text.is_empty() {
                                current_section.push_str(&current_text);
                                current_text.clear();
                            }
                            current_section = &mut section.center;
                            chars.next();
                        }
                        'R' | 'r' => {
                            if !current_text.is_empty() {
                                current_section.push_str(&current_text);
                                current_text.clear();
                            }
                            current_section = &mut section.right;
                            chars.next();
                        }
                        _ => {
                            // Other format code, preserve it
                            current_text.push('&');
                        }
                    }
                } else {
                    current_text.push('&');
                }
            } else {
                current_text.push(ch);
            }
        }

        // Flush remaining text
        if !current_text.is_empty() {
            current_section.push_str(&current_text);
        }

        section
    }

    /// Check if all sections are empty.
    pub fn is_empty(&self) -> bool {
        self.left.is_empty() && self.center.is_empty() && self.right.is_empty()
    }
}

// ============================================================================
// Header/Footer
// ============================================================================

/// Header and footer settings (ECMA-376 CT_HeaderFooter).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct HeaderFooter {
    /// Odd page header (also used for all pages if even/first not specified)
    pub odd_header: Option<String>,
    /// Odd page footer
    pub odd_footer: Option<String>,
    /// Even page header (for different even/odd headers)
    pub even_header: Option<String>,
    /// Even page footer
    pub even_footer: Option<String>,
    /// First page header (for different first page)
    pub first_header: Option<String>,
    /// First page footer
    pub first_footer: Option<String>,
    /// Use different headers/footers for odd and even pages
    pub different_odd_even: bool,
    /// Use different header/footer for the first page
    pub different_first: bool,
    /// Scale headers/footers with document scaling (None = not specified, uses ECMA-376 default of true)
    pub scale_with_doc: Option<bool>,
    /// Align headers/footers with page margins (None = not specified, uses ECMA-376 default of true)
    pub align_with_margins: Option<bool>,
}

impl HeaderFooter {
    /// Get the parsed odd header sections.
    pub fn odd_header_sections(&self) -> HeaderFooterSection {
        self.odd_header
            .as_ref()
            .map(|s| HeaderFooterSection::parse(s))
            .unwrap_or_default()
    }

    /// Get the parsed odd footer sections.
    pub fn odd_footer_sections(&self) -> HeaderFooterSection {
        self.odd_footer
            .as_ref()
            .map(|s| HeaderFooterSection::parse(s))
            .unwrap_or_default()
    }
}

// ============================================================================
// Page Break
// ============================================================================

/// A single page break (ECMA-376 CT_Break).
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PageBreak {
    /// Row or column index where break occurs (0-based)
    pub id: u32,
    /// Minimum row/column for the break
    pub min: u32,
    /// Maximum row/column for the break
    pub max: u32,
    /// Whether this is a manual break (user-inserted)
    pub manual: bool,
    /// Whether this is a page-to-page break
    pub pt: bool,
}

// ============================================================================
// Page Breaks Container
// ============================================================================

/// Container for page breaks (ECMA-376 CT_PageBreak).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct PageBreaks {
    /// Number of breaks (as declared in XML)
    pub count: Option<u32>,
    /// Number of manual breaks
    pub manual_break_count: Option<u32>,
    /// List of page breaks
    pub breaks: Vec<PageBreak>,
}

impl PageBreaks {
    /// Get only manual breaks.
    pub fn manual_breaks(&self) -> impl Iterator<Item = &PageBreak> {
        self.breaks.iter().filter(|b| b.manual)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // PaperSize
    // -----------------------------------------------------------------------

    #[test]
    fn paper_size_default_is_letter() {
        assert_eq!(PaperSize::default(), PaperSize::Letter);
    }

    #[test]
    fn paper_size_from_u32_known() {
        assert_eq!(PaperSize::from_u32(0), PaperSize::Other(0));
        assert_eq!(PaperSize::from_u32(1), PaperSize::Letter);
        assert_eq!(PaperSize::from_u32(5), PaperSize::Legal);
        assert_eq!(PaperSize::from_u32(9), PaperSize::A4);
        assert_eq!(PaperSize::from_u32(11), PaperSize::A5);
        assert_eq!(PaperSize::from_u32(41), PaperSize::GermanLegalFanfold);
    }

    #[test]
    fn paper_size_from_u32_unknown_preserves_id() {
        assert_eq!(PaperSize::from_u32(42), PaperSize::Other(42));
        assert_eq!(PaperSize::from_u32(999), PaperSize::Other(999));
    }

    #[test]
    fn paper_size_as_u32_roundtrip() {
        for id in 0..=41u32 {
            let paper = PaperSize::from_u32(id);
            assert_eq!(paper.as_u32(), id, "roundtrip failed for id {}", id);
        }
        // Other variant also round-trips
        assert_eq!(PaperSize::Other(42).as_u32(), 42);
    }

    #[test]
    fn paper_size_as_str() {
        assert_eq!(PaperSize::Letter.as_str(), "Letter");
        assert_eq!(PaperSize::A4.as_str(), "A4");
        assert_eq!(PaperSize::Legal.as_str(), "Legal");
        assert_eq!(PaperSize::Other(0).as_str(), "Other");
        assert_eq!(PaperSize::Envelope10.as_str(), "Envelope #10");
        assert_eq!(PaperSize::B4.as_str(), "B4 (JIS)");
    }

    // -----------------------------------------------------------------------
    // Orientation
    // -----------------------------------------------------------------------

    #[test]
    fn orientation_default_is_default() {
        assert_eq!(Orientation::default(), Orientation::Default);
    }

    #[test]
    fn orientation_from_ooxml() {
        assert_eq!(Orientation::from_ooxml("default"), Orientation::Default);
        assert_eq!(Orientation::from_ooxml("portrait"), Orientation::Portrait);
        assert_eq!(Orientation::from_ooxml("landscape"), Orientation::Landscape);
        assert_eq!(Orientation::from_ooxml("unknown"), Orientation::Default);
        assert_eq!(Orientation::from_ooxml(""), Orientation::Default);
    }

    #[test]
    fn orientation_to_ooxml() {
        assert_eq!(Orientation::Default.to_ooxml(), "default");
        assert_eq!(Orientation::Portrait.to_ooxml(), "portrait");
        assert_eq!(Orientation::Landscape.to_ooxml(), "landscape");
    }

    #[test]
    fn orientation_roundtrip() {
        for v in [
            Orientation::Default,
            Orientation::Portrait,
            Orientation::Landscape,
        ] {
            assert_eq!(Orientation::from_ooxml(v.to_ooxml()), v);
        }
    }

    // -----------------------------------------------------------------------
    // PageOrder
    // -----------------------------------------------------------------------

    #[test]
    fn page_order_default_is_down_then_over() {
        assert_eq!(PageOrder::default(), PageOrder::DownThenOver);
    }

    #[test]
    fn page_order_from_ooxml() {
        assert_eq!(
            PageOrder::from_ooxml("downThenOver"),
            PageOrder::DownThenOver
        );
        assert_eq!(
            PageOrder::from_ooxml("overThenDown"),
            PageOrder::OverThenDown
        );
        assert_eq!(PageOrder::from_ooxml("unknown"), PageOrder::DownThenOver);
    }

    #[test]
    fn page_order_to_ooxml() {
        assert_eq!(PageOrder::DownThenOver.to_ooxml(), "downThenOver");
        assert_eq!(PageOrder::OverThenDown.to_ooxml(), "overThenDown");
    }

    #[test]
    fn page_order_roundtrip() {
        for v in [PageOrder::DownThenOver, PageOrder::OverThenDown] {
            assert_eq!(PageOrder::from_ooxml(v.to_ooxml()), v);
        }
    }

    // -----------------------------------------------------------------------
    // CellComments
    // -----------------------------------------------------------------------

    #[test]
    fn cell_comments_default_is_none() {
        assert_eq!(CellComments::default(), CellComments::None);
    }

    #[test]
    fn cell_comments_from_ooxml() {
        assert_eq!(CellComments::from_ooxml("none"), CellComments::None);
        assert_eq!(CellComments::from_ooxml("atEnd"), CellComments::AtEnd);
        assert_eq!(
            CellComments::from_ooxml("asDisplayed"),
            CellComments::AsDisplayed
        );
        assert_eq!(CellComments::from_ooxml("bogus"), CellComments::None);
    }

    #[test]
    fn cell_comments_to_ooxml() {
        assert_eq!(CellComments::None.to_ooxml(), "none");
        assert_eq!(CellComments::AtEnd.to_ooxml(), "atEnd");
        assert_eq!(CellComments::AsDisplayed.to_ooxml(), "asDisplayed");
    }

    #[test]
    fn cell_comments_roundtrip() {
        for v in [
            CellComments::None,
            CellComments::AtEnd,
            CellComments::AsDisplayed,
        ] {
            assert_eq!(CellComments::from_ooxml(v.to_ooxml()), v);
        }
    }

    // -----------------------------------------------------------------------
    // PrintErrors
    // -----------------------------------------------------------------------

    #[test]
    fn print_errors_default_is_displayed() {
        assert_eq!(PrintErrors::default(), PrintErrors::Displayed);
    }

    #[test]
    fn print_errors_from_ooxml() {
        assert_eq!(PrintErrors::from_ooxml("displayed"), PrintErrors::Displayed);
        assert_eq!(PrintErrors::from_ooxml("blank"), PrintErrors::Blank);
        assert_eq!(PrintErrors::from_ooxml("dash"), PrintErrors::Dash);
        assert_eq!(PrintErrors::from_ooxml("NA"), PrintErrors::NA);
        assert_eq!(PrintErrors::from_ooxml("other"), PrintErrors::Displayed);
    }

    #[test]
    fn print_errors_to_ooxml() {
        assert_eq!(PrintErrors::Displayed.to_ooxml(), "displayed");
        assert_eq!(PrintErrors::Blank.to_ooxml(), "blank");
        assert_eq!(PrintErrors::Dash.to_ooxml(), "dash");
        assert_eq!(PrintErrors::NA.to_ooxml(), "NA");
    }

    #[test]
    fn print_errors_roundtrip() {
        for v in [
            PrintErrors::Displayed,
            PrintErrors::Blank,
            PrintErrors::Dash,
            PrintErrors::NA,
        ] {
            assert_eq!(PrintErrors::from_ooxml(v.to_ooxml()), v);
        }
    }

    // -----------------------------------------------------------------------
    // PageMargins
    // -----------------------------------------------------------------------

    #[test]
    fn page_margins_default_matches_excel() {
        let m = PageMargins::default();
        assert!((m.left - 0.7).abs() < f64::EPSILON);
        assert!((m.right - 0.7).abs() < f64::EPSILON);
        assert!((m.top - 0.75).abs() < f64::EPSILON);
        assert!((m.bottom - 0.75).abs() < f64::EPSILON);
        assert!((m.header - 0.3).abs() < f64::EPSILON);
        assert!((m.footer - 0.3).abs() < f64::EPSILON);
    }

    #[test]
    fn page_margins_excel_default_equals_default() {
        let a = PageMargins::default();
        let b = PageMargins::excel_default();
        assert_eq!(a, b);
    }

    #[test]
    fn page_margins_new() {
        let m = PageMargins::new(1.0, 1.0, 1.5, 1.5, 0.5, 0.5);
        assert!((m.left - 1.0).abs() < f64::EPSILON);
        assert!((m.right - 1.0).abs() < f64::EPSILON);
        assert!((m.top - 1.5).abs() < f64::EPSILON);
        assert!((m.bottom - 1.5).abs() < f64::EPSILON);
        assert!((m.header - 0.5).abs() < f64::EPSILON);
        assert!((m.footer - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn page_margins_uniform() {
        let m = PageMargins::uniform(0.5);
        assert!((m.left - 0.5).abs() < f64::EPSILON);
        assert!((m.right - 0.5).abs() < f64::EPSILON);
        assert!((m.top - 0.5).abs() < f64::EPSILON);
        assert!((m.bottom - 0.5).abs() < f64::EPSILON);
        assert!((m.header - 0.5).abs() < f64::EPSILON);
        assert!((m.footer - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn page_margins_narrow() {
        let m = PageMargins::narrow();
        assert!((m.left - 0.25).abs() < f64::EPSILON);
        assert!((m.right - 0.25).abs() < f64::EPSILON);
        assert!((m.top - 0.75).abs() < f64::EPSILON);
        assert!((m.bottom - 0.75).abs() < f64::EPSILON);
        assert!((m.header - 0.3).abs() < f64::EPSILON);
        assert!((m.footer - 0.3).abs() < f64::EPSILON);
    }

    #[test]
    fn page_margins_wide() {
        let m = PageMargins::wide();
        assert!((m.left - 1.0).abs() < f64::EPSILON);
        assert!((m.right - 1.0).abs() < f64::EPSILON);
        assert!((m.top - 1.0).abs() < f64::EPSILON);
        assert!((m.bottom - 1.0).abs() < f64::EPSILON);
        assert!((m.header - 0.5).abs() < f64::EPSILON);
        assert!((m.footer - 0.5).abs() < f64::EPSILON);
    }

    // -----------------------------------------------------------------------
    // PageSetup
    // -----------------------------------------------------------------------

    #[test]
    fn page_setup_default() {
        let ps = PageSetup::default();
        assert_eq!(ps.paper_size, PaperSize::Letter);
        assert_eq!(ps.orientation, Orientation::Default);
        assert_eq!(ps.scale, None);
        assert_eq!(ps.fit_to_width, None);
        assert_eq!(ps.fit_to_height, None);
        assert_eq!(ps.first_page_number, None);
        assert!(!ps.use_first_page_number);
        assert_eq!(ps.page_order, PageOrder::DownThenOver);
        assert!(!ps.black_and_white);
        assert!(!ps.draft);
        assert_eq!(ps.cell_comments, CellComments::None);
        assert_eq!(ps.print_errors, PrintErrors::Displayed);
        assert_eq!(ps.horizontal_dpi, None);
        assert_eq!(ps.vertical_dpi, None);
        assert_eq!(ps.copies, None);
        assert_eq!(ps.paper_width, None);
        assert_eq!(ps.paper_height, None);
        assert!(ps.use_printer_defaults);
        assert_eq!(ps.r_id, None);
    }

    // -----------------------------------------------------------------------
    // UniversalMeasure
    // -----------------------------------------------------------------------

    #[test]
    fn universal_measure_parse_inches() {
        let m = UniversalMeasure::from_ooxml("8.5in").unwrap();
        assert_eq!(m.to_ooxml(), "8.5in");
        assert!((m.to_inches() - 8.5).abs() < f64::EPSILON);
        assert_eq!(m.unit(), MeasureUnit::Inches);
        assert!((m.value() - 8.5).abs() < f64::EPSILON);
    }

    #[test]
    fn universal_measure_parse_mm() {
        let m = UniversalMeasure::from_ooxml("210mm").unwrap();
        assert_eq!(m.to_ooxml(), "210mm");
        assert!((m.to_inches() - 210.0 / 25.4).abs() < 0.001);
        assert!((m.to_mm() - 210.0).abs() < 0.001);
        assert_eq!(m.unit(), MeasureUnit::Millimeters);
    }

    #[test]
    fn universal_measure_parse_cm() {
        let m = UniversalMeasure::from_ooxml("21cm").unwrap();
        assert!((m.to_inches() - 21.0 / 2.54).abs() < 0.001);
        assert_eq!(m.unit(), MeasureUnit::Centimeters);
    }

    #[test]
    fn universal_measure_parse_pt() {
        let m = UniversalMeasure::from_ooxml("72pt").unwrap();
        assert!((m.to_inches() - 1.0).abs() < f64::EPSILON);
        assert_eq!(m.unit(), MeasureUnit::Points);
    }

    #[test]
    fn universal_measure_parse_emu() {
        let m = UniversalMeasure::from_ooxml("914400emu").unwrap();
        assert!((m.to_inches() - 1.0).abs() < 0.001);
        assert_eq!(m.unit(), MeasureUnit::Emu);
    }

    #[test]
    fn universal_measure_constructors() {
        assert_eq!(UniversalMeasure::inches(8.5).to_ooxml(), "8.5in");
        assert_eq!(UniversalMeasure::millimeters(210.0).to_ooxml(), "210mm");
        assert_eq!(UniversalMeasure::centimeters(21.0).to_ooxml(), "21cm");
        assert_eq!(UniversalMeasure::points(72.0).to_ooxml(), "72pt");
    }

    #[test]
    fn universal_measure_invalid() {
        assert!(UniversalMeasure::from_ooxml("").is_none());
        assert!(UniversalMeasure::from_ooxml("hello").is_none());
        assert!(UniversalMeasure::from_ooxml("123").is_none());
        assert!(UniversalMeasure::from_ooxml("12px").is_none());
    }

    #[test]
    fn universal_measure_serde_roundtrip() {
        let m = UniversalMeasure::from_ooxml("210mm").unwrap();
        let json = serde_json::to_string(&m).unwrap();
        let m2: UniversalMeasure = serde_json::from_str(&json).unwrap();
        assert_eq!(m, m2);
    }

    #[test]
    fn universal_measure_whitespace_trimmed() {
        let m = UniversalMeasure::from_ooxml("  8.5in  ").unwrap();
        assert_eq!(m.to_ooxml(), "8.5in");
    }

    // -----------------------------------------------------------------------
    // PrintOptions
    // -----------------------------------------------------------------------

    #[test]
    fn print_options_default() {
        let po = PrintOptions::default();
        assert!(!po.grid_lines);
        assert!(!po.headings);
        assert!(!po.horizontal_centered);
        assert!(!po.vertical_centered);
        assert!(po.grid_lines_set);
    }

    // -----------------------------------------------------------------------
    // HeaderFooterSection
    // -----------------------------------------------------------------------

    #[test]
    fn hf_section_left_only() {
        let section = HeaderFooterSection::parse("&LLeft Content");
        assert_eq!(section.left, "Left Content");
        assert!(section.center.is_empty());
        assert!(section.right.is_empty());
    }

    #[test]
    fn hf_section_center_only() {
        let section = HeaderFooterSection::parse("&CCenter Content");
        assert!(section.left.is_empty());
        assert_eq!(section.center, "Center Content");
        assert!(section.right.is_empty());
    }

    #[test]
    fn hf_section_right_only() {
        let section = HeaderFooterSection::parse("&RRight Content");
        assert!(section.left.is_empty());
        assert!(section.center.is_empty());
        assert_eq!(section.right, "Right Content");
    }

    #[test]
    fn hf_section_all_three() {
        let section = HeaderFooterSection::parse("&LLeft&CCenter&RRight");
        assert_eq!(section.left, "Left");
        assert_eq!(section.center, "Center");
        assert_eq!(section.right, "Right");
    }

    #[test]
    fn hf_section_with_format_codes() {
        let section = HeaderFooterSection::parse("&LPage &P of &N&C&D&R&F");
        assert_eq!(section.left, "Page &P of &N");
        assert_eq!(section.center, "&D");
        assert_eq!(section.right, "&F");
    }

    #[test]
    fn hf_section_default_to_center() {
        let section = HeaderFooterSection::parse("Just Text");
        assert!(section.left.is_empty());
        assert_eq!(section.center, "Just Text");
        assert!(section.right.is_empty());
    }

    #[test]
    fn hf_section_case_insensitive() {
        let section = HeaderFooterSection::parse("&lleft&ccenter&rright");
        assert_eq!(section.left, "left");
        assert_eq!(section.center, "center");
        assert_eq!(section.right, "right");
    }

    #[test]
    fn hf_section_trailing_ampersand() {
        let section = HeaderFooterSection::parse("&LText&");
        assert_eq!(section.left, "Text&");
    }

    #[test]
    fn hf_section_is_empty() {
        let empty = HeaderFooterSection::default();
        assert!(empty.is_empty());

        let non_empty = HeaderFooterSection::parse("&CContent");
        assert!(!non_empty.is_empty());
    }

    #[test]
    fn hf_section_empty_string() {
        let section = HeaderFooterSection::parse("");
        assert!(section.is_empty());
    }

    // -----------------------------------------------------------------------
    // HeaderFooter
    // -----------------------------------------------------------------------

    #[test]
    fn header_footer_default() {
        let hf = HeaderFooter::default();
        assert!(hf.odd_header.is_none());
        assert!(hf.odd_footer.is_none());
        assert!(hf.even_header.is_none());
        assert!(hf.even_footer.is_none());
        assert!(hf.first_header.is_none());
        assert!(hf.first_footer.is_none());
        assert!(!hf.different_odd_even);
        assert!(!hf.different_first);
        assert_eq!(hf.scale_with_doc, None);
        assert_eq!(hf.align_with_margins, None);
    }

    #[test]
    fn header_footer_odd_header_sections() {
        let hf = HeaderFooter {
            odd_header: Some("&LLeft&CCenter&RRight".to_string()),
            ..Default::default()
        };
        let sections = hf.odd_header_sections();
        assert_eq!(sections.left, "Left");
        assert_eq!(sections.center, "Center");
        assert_eq!(sections.right, "Right");
    }

    #[test]
    fn header_footer_odd_footer_sections() {
        let hf = HeaderFooter {
            odd_footer: Some("&CPage &P".to_string()),
            ..Default::default()
        };
        let sections = hf.odd_footer_sections();
        assert!(sections.left.is_empty());
        assert_eq!(sections.center, "Page &P");
        assert!(sections.right.is_empty());
    }

    #[test]
    fn header_footer_sections_none() {
        let hf = HeaderFooter::default();
        let sections = hf.odd_header_sections();
        assert!(sections.is_empty());
    }

    // -----------------------------------------------------------------------
    // PageBreak / PageBreaks
    // -----------------------------------------------------------------------

    #[test]
    fn page_break_default() {
        let brk = PageBreak::default();
        assert_eq!(brk.id, 0);
        assert_eq!(brk.min, 0);
        assert_eq!(brk.max, 0);
        assert!(!brk.manual);
        assert!(!brk.pt);
    }

    #[test]
    fn page_breaks_default() {
        let pb = PageBreaks::default();
        assert_eq!(pb.count, None);
        assert_eq!(pb.manual_break_count, None);
        assert!(pb.breaks.is_empty());
    }

    #[test]
    fn page_breaks_manual_breaks_iterator() {
        let pb = PageBreaks {
            count: Some(3),
            manual_break_count: Some(2),
            breaks: vec![
                PageBreak {
                    id: 5,
                    min: 0,
                    max: 16383,
                    manual: true,
                    pt: false,
                },
                PageBreak {
                    id: 7,
                    min: 0,
                    max: 16383,
                    manual: false,
                    pt: false,
                },
                PageBreak {
                    id: 10,
                    min: 0,
                    max: 16383,
                    manual: true,
                    pt: false,
                },
            ],
        };
        let manual: Vec<_> = pb.manual_breaks().collect();
        assert_eq!(manual.len(), 2);
        assert_eq!(manual[0].id, 5);
        assert_eq!(manual[1].id, 10);
    }

    #[test]
    fn page_breaks_manual_breaks_empty() {
        let pb = PageBreaks::default();
        assert_eq!(pb.manual_breaks().count(), 0);
    }

    // -----------------------------------------------------------------------
    // hf_codes module
    // -----------------------------------------------------------------------

    #[test]
    fn hf_codes_constants() {
        assert_eq!(hf_codes::PAGE_NUMBER, "&P");
        assert_eq!(hf_codes::TOTAL_PAGES, "&N");
        assert_eq!(hf_codes::DATE, "&D");
        assert_eq!(hf_codes::TIME, "&T");
        assert_eq!(hf_codes::FILE_PATH, "&Z");
        assert_eq!(hf_codes::FILE_NAME, "&F");
        assert_eq!(hf_codes::SHEET_NAME, "&A");
        assert_eq!(hf_codes::BOLD_ON, "&B");
        assert_eq!(hf_codes::ITALIC_ON, "&I");
        assert_eq!(hf_codes::UNDERLINE_ON, "&U");
        assert_eq!(hf_codes::STRIKETHROUGH_ON, "&S");
        assert_eq!(hf_codes::SUBSCRIPT_ON, "&Y");
        assert_eq!(hf_codes::SUPERSCRIPT_ON, "&X");
        assert_eq!(hf_codes::LEFT_SECTION, "&L");
        assert_eq!(hf_codes::CENTER_SECTION, "&C");
        assert_eq!(hf_codes::RIGHT_SECTION, "&R");
        assert_eq!(hf_codes::DOUBLE_UNDERLINE_ON, "&E");
        assert_eq!(hf_codes::PICTURE, "&G");
    }

    #[test]
    fn hf_codes_font() {
        assert_eq!(hf_codes::font("Arial", "Bold"), "&\"Arial,Bold\"");
        assert_eq!(hf_codes::font("Calibri", "Regular"), "&\"Calibri,Regular\"");
    }

    #[test]
    fn hf_codes_font_size() {
        assert_eq!(hf_codes::font_size(12), "&12");
        assert_eq!(hf_codes::font_size(8), "&8");
    }

    #[test]
    fn hf_codes_font_color() {
        assert_eq!(hf_codes::font_color("FF0000"), "&KFF0000");
        assert_eq!(hf_codes::font_color("000000"), "&K000000");
    }

    #[test]
    fn hf_codes_compose_header() {
        // Build a complete header: left has bold sheet name, center has date, right has page X of Y
        let header = format!(
            "{}{}{}{}{}{}Page {} of {}",
            hf_codes::LEFT_SECTION,
            hf_codes::BOLD_ON,
            hf_codes::SHEET_NAME,
            hf_codes::CENTER_SECTION,
            hf_codes::DATE,
            hf_codes::RIGHT_SECTION,
            hf_codes::PAGE_NUMBER,
            hf_codes::TOTAL_PAGES,
        );
        assert_eq!(header, "&L&B&A&C&D&RPage &P of &N");

        // Verify it parses correctly
        let section = HeaderFooterSection::parse(&header);
        assert_eq!(section.left, "&B&A");
        assert_eq!(section.center, "&D");
        assert_eq!(section.right, "Page &P of &N");
    }
}
