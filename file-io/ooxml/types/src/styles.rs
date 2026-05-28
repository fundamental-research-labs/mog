//! Style types facade for OOXML styles (`xl/styles.xml`).
//!
//! The implementation is split by stylesheet domain (tokens, colours, fonts,
//! fills, borders, cell formats, named records, table styles, and the root
//! stylesheet), while this module remains the stable public import surface.

mod borders;
mod cell_formats;
mod colors;
mod enums;
mod fills;
mod fonts;
mod number_formats;
mod records;
mod stylesheet;
mod table_style_types;

pub use borders::{BorderDef, BorderSideDef};
pub use cell_formats::{AlignmentDef, CellXfDef, ProtectionDef};
pub use colors::{ColorDef, ColorsDef, IndexedColors, MruColors, RgbColor};
pub use enums::{
    BorderStyle, FontScheme, GradientType, HorizontalAlign, PatternType, UnderlineStyle,
    VerticalAlign,
};
pub use fills::{FillDef, GradientStop};
pub use fonts::FontDef;
pub use number_formats::{NumFmts, NumberFormatDef};
pub use records::{CellStyleDef, DxfDef};
pub use stylesheet::Stylesheet;
pub use table_style_types::{TableStyleDef, TableStyleElementDef, TableStyleType};

pub use crate::shared::VerticalAlignRun;

#[cfg(test)]
mod tests;
