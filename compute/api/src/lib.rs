//! `compute-api` — Ergonomic Rust API facade for the spreadsheet compute engine.
//!
//! Provides `Workbook` and `Sheet` handles with actor-based thread-safe access
//! to the underlying `YrsComputeEngine`. The engine lives on a dedicated thread
//! (native) or is accessed directly (WASM). Handles are `Clone + Send + Sync`.
//!
//! # Stateless pure APIs
//!
//! Functions that don't require a `Workbook` instance (pivot computation,
//! table filtering, chart transforms, etc.) are exposed under [`pure`].

mod address;
pub mod bridge_service;
pub mod dispatch;
mod error;
pub mod pure;
mod sdk_value;
mod sheet;
mod types;
mod workbook;

pub use address::{CellAddress, CellRange};
pub use bridge_service::ComputeService;
pub use error::ComputeApiError;
pub use sdk_value::SdkValue;
pub use sheet::Sheet;
pub use types::*;
pub use workbook::Workbook;

// Re-export engine types for convenience
pub use compute_core::CellInfo;

// Module shim so bridge_delegate macro expansions in bridge_service.rs can
// resolve `super::mutation::BridgeSortOptions` (the descriptor in features.rs
// uses `super::mutation::BridgeSortOptions` which becomes `super::mutation` in
// the delegate expansion context).
pub mod mutation {
    pub use compute_core::bridge_types::{BridgeSortOptions, CellInput};
}

// Re-export sub-API types for convenience
pub use sheet::{
    bindings::SheetBindings, charts::SheetCharts, comments::SheetComments,
    conditional::SheetConditionalFormats, filters::SheetFilters, formats::SheetFormats,
    hyperlinks::SheetHyperlinks, layout::SheetLayout, objects::SheetObjects, outline::SheetOutline,
    pivots::SheetPivots, print::SheetPrint, protection::SheetProtection, slicers::SheetSlicers,
    sparklines::SheetSparklines, structure::SheetStructure, tables::SheetTables,
    validation::SheetValidation,
};

pub use workbook::{
    history::WorkbookHistory, names::WorkbookNames, protection::WorkbookProtection,
    scenarios::WorkbookScenarios, settings::WorkbookSettings, sheets::WorkbookSheets,
    styles::WorkbookStyles,
};
