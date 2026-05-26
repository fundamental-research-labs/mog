//! Position boundary types — trait-based position resolution for geometry-aware analysis.
//!
//! This module defines the boundary between the symbolic dependency graph
//! (keyed by [`CellId`]) and the geometric world (sheet, row, col positions).
//!
//! The core abstraction is [`PositionResolver`]: a pure lookup trait that maps
//! `CellId` → `Option<CellPosition>`. It lives in `compute-graph` and depends
//! only on types the crate already owns. `CellMirror` implements it up in
//! `compute-core`. No inverse dependency is introduced.
//!
//! ## Design principles
//!
//! - **Zero allocation** — implementors (e.g., `CellMirror`) already have position maps;
//!   no need to copy them into a snapshot.
//! - **Composable** — [`WithOverrides`] wraps a base resolver with caller-supplied
//!   position overrides for hypothetical edits.
//! - **Completeness is query-relative** — [`AnalysisCompleteness`] is computed by
//!   the analysis methods during execution, not reported by the resolver.

use std::cell::Cell;

use cell_types::{CellId, SheetId};
use rustc_hash::FxHashMap;

use crate::DepTarget;

/// Position of a cell in the geometric world.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CellPosition {
    /// The sheet this cell belongs to.
    pub sheet: SheetId,
    /// Zero-based row index.
    pub row: u32,
    /// Zero-based column index.
    pub col: u32,
}

/// Pure lookup: given a [`CellId`], return its current position.
///
/// The trait is intentionally minimal — it does not report completeness.
/// Completeness is relative to the query universe (which cells the analysis
/// actually visits), not the storage object. The analysis methods on
/// [`DependencyGraph`](crate::DependencyGraph) compute [`AnalysisCompleteness`]
/// internally by tracking resolution misses.
pub trait PositionResolver {
    /// Resolve a cell's position. Returns `None` if the cell has no known position.
    fn resolve(&self, cell_id: &CellId) -> Option<CellPosition>;
}

/// Blanket implementation: any closure matching the signature is a [`PositionResolver`].
///
/// This enables ergonomic usage in tests and transitional code:
/// ```ignore
/// let resolver = |id: &CellId| -> Option<CellPosition> { ... };
/// let affected = graph.affected_cells(&changed, &resolver);
/// ```
impl<F> PositionResolver for F
where
    F: Fn(&CellId) -> Option<CellPosition>,
{
    #[inline]
    fn resolve(&self, cell_id: &CellId) -> Option<CellPosition> {
        self(cell_id)
    }
}

/// Composable position overlay for hypothetical edits.
///
/// Wraps a base resolver with caller-supplied position overrides. Overrides
/// take precedence — if a `CellId` is in the overrides map, the base resolver
/// is not consulted. Used by [`DependencyGraph::would_create_cycle`](crate::DependencyGraph::would_create_cycle)
/// to inject positions for cells that don't yet exist in the graph.
///
/// # Examples
///
/// ```
/// use compute_graph::positions::{CellPosition, PositionResolver, WithOverrides};
/// use cell_types::{CellId, SheetId};
///
/// let base = |_: &CellId| -> Option<CellPosition> { None };
/// let new_cell = CellId::from_raw(99);
/// let sheet = SheetId::from_raw(1);
///
/// let resolver = WithOverrides::new(base)
///     .with_override(new_cell, CellPosition { sheet, row: 5, col: 0 });
///
/// assert!(resolver.resolve(&new_cell).is_some());
/// ```
pub struct WithOverrides<P: PositionResolver> {
    base: P,
    overrides: FxHashMap<CellId, CellPosition>,
}

impl<P: PositionResolver> WithOverrides<P> {
    /// Create a new overlay with no overrides.
    pub fn new(base: P) -> Self {
        Self {
            base,
            overrides: FxHashMap::default(),
        }
    }

    /// Add a position override for a specific cell.
    #[must_use]
    pub fn with_override(mut self, cell_id: CellId, position: CellPosition) -> Self {
        self.overrides.insert(cell_id, position);
        self
    }
}

impl<P: PositionResolver> PositionResolver for WithOverrides<P> {
    #[inline]
    fn resolve(&self, cell_id: &CellId) -> Option<CellPosition> {
        self.overrides
            .get(cell_id)
            .copied()
            .or_else(|| self.base.resolve(cell_id))
    }
}

/// Decorator that wraps any [`PositionResolver`] and tracks whether any
/// resolution miss occurred. Callers create a `TrackedResolver`, pass it
/// (by reference) through analysis helpers, and then query [`had_miss`] or
/// [`completeness`] to determine whether the result is exact or approximate.
///
/// Uses interior mutability ([`Cell<bool>`]) so it can be shared by `&`
/// across multiple analysis phases.
pub(crate) struct TrackedResolver<'a, R: PositionResolver + ?Sized> {
    inner: &'a R,
    had_miss: Cell<bool>,
}

impl<'a, R: PositionResolver + ?Sized> TrackedResolver<'a, R> {
    pub(crate) const fn new(inner: &'a R) -> Self {
        Self {
            inner,
            had_miss: Cell::new(false),
        }
    }

    #[allow(dead_code)]
    pub(crate) fn had_miss(&self) -> bool {
        self.had_miss.get()
    }

    pub(crate) fn reset(&self) {
        self.had_miss.set(false);
    }

    pub(crate) fn completeness(&self) -> AnalysisCompleteness {
        if self.had_miss.get() {
            AnalysisCompleteness::Incomplete
        } else {
            AnalysisCompleteness::Exact
        }
    }
}

impl<R: PositionResolver + ?Sized> PositionResolver for TrackedResolver<'_, R> {
    fn resolve(&self, cell_id: &CellId) -> Option<CellPosition> {
        let result = self.inner.resolve(cell_id);
        if result.is_none() {
            self.had_miss.set(true);
        }
        result
    }
}

/// Describes whether a geometry-aware analysis had complete position data.
///
/// Replaces the previous `DirtySetCompleteness` — the new name reflects that
/// completeness applies to all geometry-aware analyses (dirty-set, topo sort,
/// cycle detection), not just dirty-set expansion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnalysisCompleteness {
    /// Every visited cell had a resolvable position — the result is exact.
    Exact,
    /// At least one visited cell had no resolvable position. The result is
    /// conservative (may over-invalidate) but never fabricates structure.
    Incomplete,
}

/// Result wrapper that pairs a value with its [`AnalysisCompleteness`].
///
/// Implements `Deref<Target = T>` and `into_value()` so callers that don't
/// need completeness can access the inner value directly. The type still
/// signals that completeness information exists.
///
/// # Examples
///
/// ```
/// use compute_graph::positions::{Analyzed, AnalysisCompleteness};
///
/// let result: Analyzed<Vec<u32>> = Analyzed {
///     value: vec![1, 2, 3],
///     completeness: AnalysisCompleteness::Exact,
/// };
///
/// // Deref access
/// assert_eq!(result.len(), 3);
///
/// // Explicit completeness check
/// assert_eq!(result.completeness, AnalysisCompleteness::Exact);
///
/// // Consume
/// let inner = result.into_value();
/// assert_eq!(inner, vec![1, 2, 3]);
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Analyzed<T> {
    /// The analysis result.
    pub value: T,
    /// Whether the result is exact or approximate.
    pub completeness: AnalysisCompleteness,
}

impl<T> Analyzed<T> {
    /// Consume the wrapper and return the inner value.
    pub fn into_value(self) -> T {
        self.value
    }

    /// Map the inner value, preserving completeness.
    pub fn map<U>(self, f: impl FnOnce(T) -> U) -> Analyzed<U> {
        Analyzed {
            value: f(self.value),
            completeness: self.completeness,
        }
    }
}

impl<T> std::ops::Deref for Analyzed<T> {
    type Target = T;

    fn deref(&self) -> &T {
        &self.value
    }
}

/// A proposed dependency change for hypothetical cycle checking.
///
/// Used by [`DependencyGraph::would_create_cycle`](crate::DependencyGraph::would_create_cycle)
/// to evaluate whether a proposed formula edit would create a cycle, considering
/// both the current graph state and the proposed change.
///
/// The `cell` may or may not already exist in the graph. Its position should be
/// supplied via [`WithOverrides`] if it's not yet in the position resolver.
///
/// # Examples
///
/// ```
/// use compute_graph::positions::HypotheticalDependencyEdit;
/// use compute_graph::DepTarget;
/// use cell_types::CellId;
///
/// let edit = HypotheticalDependencyEdit {
///     cell: CellId::from_raw(42),
///     new_precedents: vec![DepTarget::Cell(CellId::from_raw(1))],
/// };
/// ```
pub struct HypotheticalDependencyEdit {
    /// The cell whose dependencies would change.
    pub cell: CellId,
    /// The proposed new precedents (replaces all existing precedents for this cell).
    pub new_precedents: Vec<DepTarget>,
}
