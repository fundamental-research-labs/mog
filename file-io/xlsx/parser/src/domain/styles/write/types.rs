//! Style types — re-exported from `ooxml_types::styles` (canonical OOXML vocabulary).
//!
//! All struct and enum types are defined in `ooxml-types`. This module
//! re-exports them so that write-side code has a single import path.

pub use ooxml_types::styles::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellStyleDef, CellXfDef, ColorDef,
    ColorsDef, DxfDef, FillDef, FontDef, FontScheme, GradientStop, GradientType, HorizontalAlign,
    NumberFormatDef, PatternType, ProtectionDef, TableStyleDef, TableStyleElementDef,
    TableStyleType, UnderlineStyle, VerticalAlign, VerticalAlignRun,
};
