//! Styles parser for XLSX formatting
//!
//! This module parses styles.xml to extract cell formatting information,
//! particularly number formats which are essential for correctly interpreting
//! date values (which are stored as numbers in Excel).

mod borders;
mod cell_formats;
mod colors;
mod dxfs;
mod fills;
mod fonts;
mod number_formats;
mod raw;
mod stylesheet;
mod support;
mod table_styles;

// Re-export shared style types for compatibility with existing read-side consumers.
pub use super::types::*;

pub use fonts::parse_known_fonts;
pub use number_formats::{builtin_format, get_number_format, is_date_format};
pub use stylesheet::parse_styles;

#[cfg(test)]
use {
    cell_formats::{parse_cell_styles, parse_cell_xfs},
    colors::parse_colors,
    dxfs::parse_dxfs,
    fonts::parse_fonts,
    number_formats::{is_builtin_date_format, is_date_format_code},
    table_styles::parse_table_styles,
};

#[cfg(test)]
mod tests;
