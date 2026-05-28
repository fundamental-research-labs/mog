//! Header/footer format codes for use in headers and footers.
//!
//! These codes are interpreted by Excel when rendering headers and footers.
//!
//! # Example
//!
//! ```
//! use ooxml_types::print::hf_codes;
//!
//! // Create a header with page number on the right
//! let header = format!("{}Page {}", hf_codes::RIGHT_SECTION, hf_codes::PAGE_NUMBER);
//! // Result: "&RPage &P"
//! ```

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
