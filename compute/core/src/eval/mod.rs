//! AST Evaluator — async recursive descent evaluator that walks AST nodes.
//!
//! Resolves references via data-access traits, dispatches to functions,
//! handles type coercion and error propagation.
//!
//! ## Architecture
//!
//! Two trait hierarchies govern data flow:
//! - [`EvalDataAccess`] — async data reads (cell values, ranges). Owned
//!   exclusively by the `Evaluator`; never passed to functions.
//! - [`EvalMetadata`] — sync positional/structural queries (sheet lookup,
//!   defined names, tables). Passed to `PureFunction::call()` as `&dyn`.
//!
//! ## Subsystems
//!
//! - [`engine`] — AST dispatch, scope management, operators, aggregation primitives
//! - [`context`] — EvalDataAccess/EvalMetadata traits (impls in eval_bridge)
//! - [`cache`] — Multi-tier caching (workbook, epoch, range, subexpr, lambda)
//! - [`lookup`] — INDEX/MATCH/VLOOKUP/HLOOKUP/XLOOKUP dispatch + lookup index
//! - [`functions`] — Special function dispatch (SUMPRODUCT, SUBTOTAL, GETPIVOTDATA, etc.)
//! - [`coordination`] — Column tracking, cycle detection, iterative solver, vectorized eval

use std::sync::LazyLock;

use crate::functions::FunctionRegistry;

// ---------------------------------------------------------------------------
// Subsystem modules
// ---------------------------------------------------------------------------

pub(crate) mod cache;
pub(crate) mod context;
pub(crate) mod coordination;
pub(crate) mod engine;
pub(crate) mod eval_value;
pub mod external;
pub(crate) mod functions;
pub(crate) mod lookup;

pub(crate) mod clock;

#[cfg(test)]
mod test_helpers;

#[cfg(test)]
#[path = "eval_tests/mod.rs"]
mod tests;

// ---------------------------------------------------------------------------
// Public re-exports (external API)
// ---------------------------------------------------------------------------

pub use cache::epoch_cache::EpochCacheStats;
pub use cache::range_store::RangeKey;
pub use cache::workbook_cache::{CacheCountersSnapshot, WorkbookCacheStatsSnapshot};
pub use context::traits::{
    EvalDataAccess, EvalMetadata, EvaluationContext, IndexedLookupResult, sync_block_on,
};
pub use engine::evaluator::Evaluator;
pub use external::{
    AccessPrincipal, ActorId, DocumentId, ExternalEvaluationContext, ExternalLinkDiagnostic,
    ExternalRangeResult, ExternalValueFreshness, ExternalValueProvider, ExternalValueResult,
    ExternalValueStatus, WorkbookSessionId,
};

// ---------------------------------------------------------------------------
// Internal re-exports for sibling submodules (accessible via `super::`)
// ---------------------------------------------------------------------------

// eval_primitives.rs needs: super::{agg_sum, agg_average, agg_count, ...}
use engine::aggregate::{
    agg_average, agg_count, agg_counta, agg_countblank, agg_max, agg_min, agg_sum,
};

// resolve_cell_ref_position is a free function used internally
#[allow(unused_imports)]
use lookup::range_geometry::resolve_cell_ref_position;

// ---------------------------------------------------------------------------
// Imports used by the monolith that test submodules still depend on via
// `use super::*;` — keep these so ASTNode, BinOp, etc. remain accessible.
// ---------------------------------------------------------------------------

#[allow(unused_imports)]
use compute_parser::{ASTNode, BinOp, UnaryOp};

#[allow(unused_imports)]
use cell_types::{CellId, SheetId};

#[allow(unused_imports)]
use value_types::DenseColumn;

#[allow(unused_imports)]
use rustc_hash::FxHashMap;

// ---------------------------------------------------------------------------
// Global FunctionRegistry singleton (initialized once, shared read-only)
// ---------------------------------------------------------------------------

pub(crate) static GLOBAL_REGISTRY: LazyLock<FunctionRegistry> =
    LazyLock::new(FunctionRegistry::new);

// ---------------------------------------------------------------------------
// Safety limits
// ---------------------------------------------------------------------------

const MAX_DEPTH: u32 = 512;
const MAX_OPERATIONS: u32 = 10_000_000;
const MAX_SCOPE_DEPTH: usize = 512;
