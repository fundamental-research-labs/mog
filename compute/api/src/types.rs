//! Re-exports from compute-core type crates.
//!
//! `compute-api` does NOT define parallel type hierarchies. All domain types
//! come from the engine's type crates.

// Cell identity and grid addressing
pub use cell_types::{CellId, CellPos, RangePos, SheetId, SheetPos};

// Range copy operation semantics
pub use domain_types::CopyType;

// Range fill operation requests. These are the bridge types consumed directly
// by the production compute-fill engine and exposed here so API adapters do
// not depend on compute-core's internal module path.
pub use compute_core::bridge_types::{
    BridgeAutoFillRequest, BridgeFillRangeSpec, BridgeFlashFillRequest,
};

// Cell values
pub use value_types::{CellError, CellValue, ComputeError};

// Snapshot and mutation types
pub use snapshot_types::{
    MutationResult, RecalcResult, SheetSnapshot, WorkbookProtectionOptions, WorkbookSnapshot,
};

// Sheet protection options are shared with the structured engine protection
// record; adapters should consume this one public type rather than defining a
// parallel options hierarchy.
pub use domain_types::domain::sheet::SheetProtectionOptions;

// Defined-name bridge types. These are the typed inputs consumed by
// `WorkbookNames` and re-exported so higher-level adapters do not depend on
// compute-core's internal module path.
pub use compute_core::bridge_types::named_ranges::{DefinedNameInput, NamedRangeUpdate};

// Persisted workbook cell styles.  Higher-level adapters should consume the
// same domain record rather than introducing a parallel style representation.
pub use domain_types::domain::cell_style::CellStyleDef;
