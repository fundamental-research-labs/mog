//! Excel Theme Parser for XLSX files.
//!
//! This module parses DrawingML Theme definitions from `xl/theme/theme*.xml` files
//! in XLSX archives. Themes define the visual appearance of workbooks including
//! color schemes, fonts, and format schemes.
//!
//! # DrawingML Theming Overview
//!
//! Office Open XML (OOXML) uses DrawingML for themes, defined in ECMA-376 Part 1,
//! Section 20.1.6. A theme contains:
//!
//! - **Color Scheme** (`clrScheme`): 12 named colors used throughout the document
//!   - dk1, lt1: Dark and light text/background colors
//!   - dk2, lt2: Secondary dark and light colors
//!   - accent1-6: Six accent colors
//!   - hlink, folHlink: Hyperlink and followed hyperlink colors
//!
//! - **Font Scheme** (`fontScheme`): Major (headings) and minor (body) font definitions
//!   - latin: Latin script font (e.g., "Calibri Light")
//!   - ea: East Asian script font
//!   - cs: Complex script font
//!
//! - **Format Scheme** (`fmtScheme`): Fill, line, and effect styles
//!   - fillStyleLst: Fill patterns and gradients
//!   - lnStyleLst: Line/border styles
//!   - effectStyleLst: Shadow, glow, reflection effects
//!
//! # Theme Color Resolution
//!
//! Excel cells and chart elements reference colors using theme indices or direct RGB.
//! The `ThemeColor` enum represents these color references:
//!
//! - `Rgb`: Direct ARGB/RGB color (e.g., "FF4472C4")
//! - `Theme`: Index into the color scheme (0-11)
//! - `Indexed`: Legacy indexed palette color
//!
//! Theme colors can have tints applied (lightening/darkening).
//!
//! # Example Theme XML Structure
//!
//! ```xml
//! <a:theme name="Office Theme">
//!   <a:themeElements>
//!     <a:clrScheme name="Office">
//!       <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
//!       <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
//!       <a:dk2><a:srgbClr val="44546A"/></a:dk2>
//!       <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
//!       <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
//!       ...
//!     </a:clrScheme>
//!     <a:fontScheme name="Office">
//!       <a:majorFont>
//!         <a:latin typeface="Calibri Light"/>
//!         <a:ea typeface=""/>
//!         <a:cs typeface=""/>
//!       </a:majorFont>
//!       <a:minorFont>
//!         <a:latin typeface="Calibri"/>
//!         ...
//!       </a:minorFont>
//!     </a:fontScheme>
//!     <a:fmtScheme name="Office">
//!       <a:fillStyleLst>...</a:fillStyleLst>
//!       <a:lnStyleLst>...</a:lnStyleLst>
//!       <a:effectStyleLst>...</a:effectStyleLst>
//!     </a:fmtScheme>
//!   </a:themeElements>
//! </a:theme>
//! ```
//!
//! # Usage
//!
//! ```ignore
//! use xlsx_parser::themes::Theme;
//!
//! let theme_xml = archive.get_theme()?;
//! let theme = Theme::parse(&theme_xml);
//!
//! // Get accent color 1
//! // Get accent color 1 hex value
//! let accent1_hex = &theme.color_scheme.accent1;
//!
//! // Get heading font
//! let heading_font = &theme.font_scheme.major_font.latin.typeface;
//! ```

// Submodules
pub mod colors;
pub mod effects;
pub mod fonts;
pub mod formats;
pub mod types;
pub mod write;

// Re-export all public types
pub use colors::ColorScheme;
pub use fonts::{FontCollection, FontScheme, ScriptFont, ThemeFontDef};
pub use formats::parse_drawing_color;
pub use types::{FormatScheme, RgbColor, Theme, ThemeColor};

#[cfg(test)]
mod tests;
