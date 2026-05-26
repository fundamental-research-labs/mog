//! Stateless gate primitives on `YrsComputeEngine` — R3.1.
//!
//! Three methods that the `bridge-delegate` macro calls from its gated
//! wrappers. None mutate engine state; all take `&Principal` by argument
//! (engine holds no identity). They're internal to the engine — not
//! `#[bridge::*]`-annotated — because the macro-emitted code references
//! them directly on the engine value, not through a bridge descriptor.
//!
//! - `active_matrix(&principal, sheet)` — wraps `SecurityState::active_matrix`
//!   and materialises the `GridColumnIndex` adapter against the engine's
//!   in-memory `GridIndex` on the engine thread.
//! - `effective_access(&principal, target)` — delegates to `SecurityState::evaluate`.
//! - `check_write(&principal, target, required)` — pre-check used by
//!   write/structural gating at sheet-scope and workbook-scope. Returns
//!   `SecurityError::Denied` on failure, filled with a best-effort
//!   `operation` label chosen by the macro emission site.

use std::sync::Arc;

use cell_types::{ColId, SheetId};
use compute_security::{
    AccessLevel, AccessTarget, ColumnIndex, Principal, SecurityError, SecurityEvent,
    SheetAccessMatrix,
};

use super::YrsComputeEngine;
use crate::identity::GridIndex;

/// Adapter that exposes the engine's in-memory `GridIndex` as a
/// `ColumnIndex` for `PolicyEngine::evaluate_sheet`. The `&dyn
/// ColumnIndex` is passed down the cache path so a missed matrix builds
/// column overrides keyed against the current structure.
///
/// `pub(crate)` — consumed only by the engine-side primitives below;
/// downstream codegens and external crates don't see it.
pub(crate) struct GridColumnIndex<'a> {
    grid: Option<&'a GridIndex>,
}

impl<'a> GridColumnIndex<'a> {
    pub(crate) fn new(grid: Option<&'a GridIndex>) -> Self {
        Self { grid }
    }
}

impl<'a> ColumnIndex for GridColumnIndex<'a> {
    fn position_of(&self, col: ColId) -> Option<u32> {
        self.grid.and_then(|g| g.col_index(&col))
    }

    fn column_count(&self) -> u32 {
        self.grid.map(|g| g.col_count()).unwrap_or(0)
    }
}

impl YrsComputeEngine {
    /// Push a `SecurityEvent` onto the engine's event buffer. This is the
    /// sole public entrypoint for emitting events at the engine layer —
    /// the buffer itself stays private so the only way to enqueue an
    /// event is through this method (matching `security_ops`'s
    /// `push_event` free function).
    ///
    /// Called from:
    /// - `check_write` below, on the denial branch.
    /// - The `bridge-delegate` macro's range-scope denial path, which
    ///   synthesises `SecurityError::Denied` directly rather than
    ///   routing through `check_write`.
    ///
    /// The buffer is bounded; see `SecurityEventBuffer::push` for the
    /// oldest-dropped-on-overflow semantics.
    pub fn push_security_event(&self, event: SecurityEvent) {
        self.security_events.push(event);
    }

    /// Resolve (or build) the access matrix for a (principal, sheet)
    /// pair at the current policy and structure versions. Called from
    /// every gated read/write that lives at cell-or-range scope.
    ///
    /// The caller's hot path fetches the matrix once per call and reuses
    /// it across per-cell / per-range post-filters — the `SecurityState`
    /// cache keys on `(principal_identity, sheet, policy_version,
    /// structure_version)` so repeated fetches in the same engine turn
    /// hit the same `Arc`.
    pub fn active_matrix(&self, principal: &Principal, sheet: SheetId) -> Arc<SheetAccessMatrix> {
        let col_idx = GridColumnIndex::new(self.grid_index(&sheet));
        self.security.active_matrix(principal, sheet, &col_idx)
    }

    /// Evaluate effective access for a target without caching. Used for
    /// attenuation checks (R5.1) and diagnostic paths; the per-call
    /// matrix cache is the fast path for cell/range operations.
    pub fn effective_access(&self, principal: &Principal, target: &AccessTarget) -> AccessLevel {
        self.security.evaluate(principal, target)
    }

    /// Authorise a write or structural mutation at sheet- or
    /// workbook-scope. Cell- and range-scope gating uses `active_matrix`
    /// directly (policies never target individual cells — the matrix IS
    /// the cell primitive, per ARCHITECTURE.md §6.5). This is the
    /// coarser pre-check path invoked only when the macro emits a
    /// `scope = "sheet"` or `scope = "workbook"` write.
    ///
    /// `operation` is the caller-visible method name (e.g. `"set_cell"`)
    /// supplied by the delegate macro. On denial, the engine emits a
    /// `SecurityEvent::AccessDenied` carrying the same label before
    /// returning `SecurityError::Denied` — SDK consumers polling
    /// `wb_security_drain_events` see the full diagnostic stream.
    pub fn check_write(
        &self,
        principal: &Principal,
        target: &AccessTarget,
        required: AccessLevel,
        operation: &'static str,
    ) -> Result<(), SecurityError> {
        let actual = self.security.evaluate(principal, target);
        if actual >= required {
            Ok(())
        } else {
            // Emit the diagnostic event before synthesising the error so
            // SDK consumers draining the buffer see the denial even when
            // the caller drops the returned `Err` without surfacing it.
            self.push_security_event(SecurityEvent::AccessDenied {
                principal_tags: principal.tags().to_vec(),
                target: target.clone(),
                operation: operation.to_string(),
            });
            Err(SecurityError::Denied {
                principal: principal.clone(),
                target: target.clone(),
                required,
                actual,
                operation,
            })
        }
    }
}
