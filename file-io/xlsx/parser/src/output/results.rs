//! Result and response types for XLSX parsing operations.
//!
//! This module contains all the struct types used to return parse results,
//! including timing information, error details, and parsed cell data.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::infra::error::ParseErrorDetail;

mod cells;
mod comments;
mod controls;
mod errors;
mod metadata;
mod ole;
mod print;
mod status;
mod styles;
mod tables;
#[cfg(test)]
mod tests;
mod timings;
mod views;
mod workbook;

pub use cells::*;
pub use comments::*;
pub use controls::*;
pub use errors::*;
pub use metadata::*;
pub use ole::*;
pub use print::*;
pub use status::*;
pub use styles::*;
pub use tables::*;
pub use timings::*;
pub use views::*;
pub use workbook::*;

// Re-export serde-compatible range and pane types from the canonical OOXML
// worksheet vocabulary crate.
// These types use snake_case serde field names for compatibility with existing
// JSON output. This differs from the TypeScript-facing camelCase DTOs.
pub use ooxml_types::worksheet::{ColWidth, MergeRange, Pane, PaneState, RowHeight, SheetPane};

// Re-export style enums used as public field types on FontOutput, FillOutput,
// BorderSideOutput, AlignmentOutput. This lets downstream consumers (e.g.,
// compute-core) name these types without adding ooxml-types as a direct
// dependency.
pub use crate::domain::styles::types::{
    BorderStyle, HorizontalAlign, PatternType, UnderlineStyle, VerticalAlign,
};

// Re-exports from json_utils (moved for separation of concerns)
pub use crate::infra::json::{errors_to_json, escape_json_string};

// Re-export from error (moved for separation of concerns)
pub use crate::infra::error::mode_from_u32;

// Re-export A1 range parsing utilities from the canonical module.
pub use crate::infra::a1::{parse_a1_cell, parse_a1_range};

pub(super) fn is_false(v: &bool) -> bool {
    !*v
}

pub(super) fn is_zero(v: &u8) -> bool {
    *v == 0
}

pub(super) fn is_true(v: &bool) -> bool {
    *v
}

pub(super) fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

pub(super) fn is_default_color_id(v: &u32) -> bool {
    *v == 64
}

pub(super) fn is_default_zoom_scale(v: &u32) -> bool {
    *v == 100
}
