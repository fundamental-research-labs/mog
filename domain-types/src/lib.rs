//! Shared domain types for the XLSX pipeline.
//!
//! This crate is the single source of truth for domain types used across:
//! - **Parser**: produces `ParseOutput` from XLSX bytes (position-keyed)
//! - **Yrs storage**: stores domain objects as structured Y.Maps via `yrs_schema` modules
//! - **XLSX writer**: consumes `ParseOutput` to produce XLSX bytes
//! - **Compute-core**: consumes the subset it needs (CF evaluation, pivot computation)
//!
//! # Architecture
//!
//! ```text
//! ParseOutput (position-keyed)  ─── parser produces, writer consumes
//!     │
//!     ├── SheetData
//!     │   ├── cells: Vec<CellData>
//!     │   ├── charts: Vec<ChartSpec>
//!     │   ├── conditional_formats: Vec<ConditionalFormat>
//!     │   └── ... (all domain objects)
//!     │
//!     └── style_palette: Vec<DocumentFormat>
//!
//! YrsSchema modules              ─── structured Yrs read/write per domain
//!     ├── comment::to_yrs_prelim() / from_yrs_map()
//!     ├── chart::to_yrs_prelim() / from_yrs_map()
//!     └── ... (one module per domain)
//! ```

// Canonical cell formatting types (CellFormat, FontSize, CellBorders, etc.)
mod cell_format;
pub use cell_format::*;

// Theme color resolution utilities (HSL, tint, theme refs)
pub mod theme_color;

// XLSX palette entry types (DocumentFormat, FontFormat, etc.)
mod format;
pub use format::*;

// Position-keyed container types
mod parse_output;
pub use parse_output::*;

// XLSX package ownership, provenance, and export diagnostics contracts.
mod package_policy;
pub use package_policy::*;

// Document properties
mod properties;
pub use properties::*;

// Workbook metadata (`xl/metadata.xml`)
mod metadata;
pub use metadata::*;

// Import diagnostics (diagnostics, stats, force-recalc hints)
mod diagnostics;
pub use diagnostics::*;

// Full-fidelity domain types (charts, CF, validation, comments, etc.)
pub mod domain;
pub use domain::*;

// Style resolution (OOXML multi-level → flat DocumentFormat palette)
pub mod style_resolver;

// OOXML ↔ pixel unit conversion (column widths, row heights)
pub mod units;

// Structured Yrs read/write modules (one per domain)
#[cfg(feature = "yrs")]
pub mod yrs_schema;

/// Serde helper: returns true if `v` is false (for `skip_serializing_if`).
pub fn is_false(v: &bool) -> bool {
    !v
}

/// Serde helper: returns true if `v` is zero.
pub fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

/// Serde helper: default value of `true` for bool fields.
pub fn default_true() -> bool {
    true
}

/// Serde helper: returns true if the ime_mode is the OOXML default
/// (`noControl`), so it can be omitted on serialization.
pub fn is_default_ime_mode(v: &crate::domain::validation::ImeMode) -> bool {
    matches!(v, crate::domain::validation::ImeMode::NoControl)
}

// Re-export foundation types that are part of the public API
pub use ooxml_types::workbook::SheetState;
pub use value_types::CellValue;
