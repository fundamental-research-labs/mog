//! Pivot table types — re-exported from the `pivot-types` crate.
//!
//! All types live in `pivot-types` (a standalone, dependency-light crate).
//! This module re-exports everything so that `crate::types::*` paths
//! continue to work throughout compute-pivot.

pub use pivot_types::PivotEngineConfig as PivotTableConfig;
pub use pivot_types::*;

mod pivot_table_def_ext;
pub use pivot_table_def_ext::PivotTableDefExt;
