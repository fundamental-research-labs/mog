//! Shared style domain types.
//!
//! `ooxml_types::styles` is the canonical OOXML vocabulary. The XLSX parser
//! keeps this module as the local domain import path so read and write code do
//! not grow separate style type facades.

pub use ooxml_types::styles::{
    AlignmentDef, BorderDef, BorderSideDef, BorderStyle, CellStyleDef, CellXfDef, ColorDef,
    ColorsDef, DxfDef, FillDef, FontDef, FontScheme, GradientStop, GradientType, HorizontalAlign,
    NumberFormatDef, PatternType, ProtectionDef, Stylesheet, TableStyleDef, TableStyleElementDef,
    TableStyleType, UnderlineStyle, VerticalAlign, VerticalAlignRun,
};
