//! Theme types (ECMA-376 DrawingML Theming — Part 1, Section 20.1.6).
//!
//! Canonical vocabulary types for Office theme definitions. These types are shared
//! by both the read (parser) and write (writer) sides of the xlsx-parser crate.
//!
//! # Overview
//!
//! A theme (`CT_OfficeStyleSheet`) contains:
//! - **Theme Elements** (`CT_BaseStyles`): color scheme, font scheme, format scheme
//! - **Object Defaults** (`CT_ObjectStyleDefaults`): default styles for shapes, lines, text
//! - **Extra Color Scheme List** (`CT_ColorSchemeList`): additional color scheme/mapping pairs
//! - **Custom Color List** (`CT_CustomColorList`): user-defined custom colors
//!
//! # Color Scheme (`CT_ColorScheme`)
//! 12 named color slots using `DrawingColor` (EG_ColorChoice) — dk1, lt1, dk2, lt2,
//! accent1-6, hlink, folHlink.
//!
//! # Font Scheme (`CT_FontScheme`)
//! Major (headings) and minor (body) font collections with script-specific mappings.
//!
//! # Format Scheme (`CT_FmtScheme`)
//! Fill styles, line styles, effect styles, and background fill styles.
//!
//! # Color Mapping (`CT_ColorMapping`)
//! Maps logical presentation slots (bg1, tx1, ...) to scheme color indices.

mod base;
mod colors;
mod custom_colors;
mod fonts;
mod format;
mod mapping;
mod object_defaults;
mod stylesheet;

pub use base::{BaseStyles, BaseStylesOverride};
pub use colors::{ColorScheme, ColorSchemeIndex, ThemeColorIndex};
pub use custom_colors::{CustomColor, CustomColorList};
pub use fonts::{FontCollection, FontScheme, ScriptFont, ThemeFontDef};
pub use format::{EffectStyleItem, FormatScheme};
pub use mapping::{ColorMapping, ColorMappingOverride, ColorSchemeAndMapping, ColorSchemeList};
pub use object_defaults::{DefaultShapeDefinition, ObjectStyleDefaults};
pub use stylesheet::{ClipboardStyleSheet, OfficeStyleSheet};

#[cfg(test)]
mod tests;
