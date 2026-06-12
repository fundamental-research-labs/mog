//! Bridge service — auto-generated delegate facade for FFI bindings (WASM, N-API, Tauri).
//!
//! `ComputeService` is the **single bridge surface** for all FFI consumers.
//! WASM, N-API, and Tauri binding crates consume descriptors from `ComputeService`,
//! not from `YrsComputeEngine` directly.
//!
//! **How it works:**
//! - `bridge_delegate::delegate!()` consumes bridge descriptors from `compute-core`
//!   (on `YrsComputeEngine`) and auto-generates delegate methods on `ComputeService`
//!   that call through `Dispatch`.
//! - The macro also re-emits descriptor macros (`__bridge_descriptor_ComputeService_*`)
//!   that WASM/NAPI/Tauri binding crates consume via `generate!()`.
//! - Return types are passed through as-is (including `(Vec<u8>, MutationResult)` for
//!   write methods) so binding crates get viewport patches for TS compatibility.
//!
//! **Result:** Zero hand-written boilerplate. Adding a method to `YrsComputeEngine`
//! with `#[bridge::api]` automatically makes it available on `ComputeService` and
//! across all FFI targets.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use arc_swap::ArcSwap;
use compute_security::{
    AccessExplanation, AccessLevel, AccessPolicy, AccessPolicyPatch, AccessTarget, PolicyId,
    Principal, PrincipalPool, PrincipalTag, SecurityEvent, Template,
};
// Note: `Principal` is still referenced via `self.active_principal`'s
// `ArcSwap<Option<Principal>>` slot and in delegate-macro expansion for
// gated methods (the engine-thread closure materialises
// `Principal::anonymous(&pool)`). The bridge wire surface, however,
// trades `Vec<String>` — see `set_active_principal` / `active_principal`
// for rationale.

use crate::dispatch::Dispatch;
use bridge_core as bridge;

// The delegate macro expands `super::mutation::BridgeSortOptions` from the
// features bridge descriptor. We bring `mutation` into scope so it resolves.
use super::mutation;

// Types required by bridge_delegate macro expansion (referenced in bridge descriptors).
use compute_core::CellInfo;
use compute_core::bridge_types::{PivotExpansionState, PivotTableResult};
use compute_core::storage::engine::CsvImportOptions;
use compute_core::storage::engine::search::{WorkbookComment, WorkbookPivotTable, WorkbookTable};
use compute_core::storage::sheet::{
    filters as sheet_filters, grouping as sheet_grouping, sparklines as sheet_sparklines,
};
use compute_core::storage::workbook::imported_pivots::ImportedPivotViewRecord;
use domain_types::domain::cell_style::CellStyleDef;
use domain_types::domain::comment::{Comment, CommentMention, CommentType};
use domain_types::domain::conditional_format::{CFRule, ConditionalFormat};
use domain_types::domain::floating_object::FloatingObject;
use domain_types::domain::hyperlink::Hyperlink;
use domain_types::domain::merge::{CellMergeInfo, MergeRegion, ResolvedMergedRegion};
use domain_types::domain::sheet::{
    FrozenPanes, PrintRange, PrintTitles, SheetMeta, SheetScrollPosition, SheetSettings,
    SheetViewOptions, SplitViewConfig,
};
use domain_types::domain::slicer::{
    NamedSlicerStyle, SlicerCustomStyle, StoredSlicer, StoredSlicerUpdate,
};
use domain_types::domain::table::Table as CanonicalTable;
use domain_types::domain::validation::{CellValidationResult, ColumnSchema, RangeSchema};
use domain_types::{CellFormat, ImportDiagnostic, ResolvedCellFormat, SheetProtectionOptions};
use snapshot_types::{RuntimeDiagnosticsOptions, RuntimeDiagnosticsPage};

/// Bridge service wrapping the compute engine for FFI exposure.
///
/// Holds a `Dispatch` handle (same mechanism as `Workbook`/`Sheet`).
/// Each instance is stored in a registry keyed by `doc_id`.
///
/// R2.4 fields:
/// - `active_principal` — session-level `Principal`, swappable at any
///   point via `set_active_principal` without `&mut self`. Read by the
///   gated delegate layer (R3.2 flips the flag).
/// - `principal_pool` — intern pool for canonical principals. SDKs call
///   `make_principal(tags)` rather than constructing `Principal`
///   directly so the matrix cache's pointer-identity key stays sound.
/// - `security_active` — `Arc<AtomicBool>` cloned from
///   `SecurityState` on the engine. One source of truth; when the
///   engine's observer flips it on the first policy add, the
///   service-side delegate sees the new value on its next relaxed load.
pub struct ComputeService {
    dispatch: Dispatch,
    active_principal: ArcSwap<Option<Principal>>,
    principal_pool: Arc<PrincipalPool>,
    security_active: Arc<AtomicBool>,
}

impl ComputeService {
    /// Create a new `ComputeService` from a `Dispatch` handle.
    ///
    /// Reads the engine's `security_active` handle during construction.
    /// `Dispatch::spawn` returns only after the engine thread is
    /// running, so `query_engine` here is guaranteed to succeed; if
    /// engine construction ever becomes lazy, this call must move
    /// behind an explicit `attach` step and gated calls must block
    /// until attach completes.
    pub fn new(dispatch: Dispatch) -> Self {
        let security_active = dispatch
            .query_engine(|e| e.security().active_handle())
            .expect("engine is live immediately after Dispatch::spawn");
        Self {
            dispatch,
            active_principal: ArcSwap::new(Arc::new(None)),
            principal_pool: Arc::new(PrincipalPool::new()),
            security_active,
        }
    }

    /// Access the underlying dispatch handle (for binding crates that need
    /// to call `flush_viewport_patches()` on the engine directly).
    pub fn dispatch(&self) -> &Dispatch {
        &self.dispatch
    }

    /// Internal accessor — the delegate macro reads this on every
    /// gated call to decide whether to take the fast path.
    #[allow(dead_code)] // Wired in by R3.2 when `gated = true` is set on the delegate.
    pub(crate) fn security_active_flag(&self) -> &Arc<AtomicBool> {
        &self.security_active
    }

    /// Internal accessor — the delegate macro reads this on every
    /// gated call to materialize the call's principal.
    #[allow(dead_code)]
    pub(crate) fn active_principal_slot(&self) -> &ArcSwap<Option<Principal>> {
        &self.active_principal
    }

    /// Internal accessor — the delegate macro's anonymous-principal
    /// fallback uses this pool.
    #[allow(dead_code)]
    pub(crate) fn principal_pool(&self) -> &Arc<PrincipalPool> {
        &self.principal_pool
    }

    /// Rust-only convenience for interning a tag list into a pool-canonical
    /// `Principal`. The bridge surface uses `Vec<String>` at the wire
    /// boundary (see `make_principal` below for rationale); this helper
    /// exists for engine-level Rust callers that need the `Principal`
    /// type itself (e.g. `wb_security_effective_access`, or integration
    /// tests that cross-check identity against the pool). Not
    /// `#[bridge::*]`-annotated — it stays out of generated FFI.
    #[must_use]
    pub fn intern_principal(&self, tags: Vec<String>) -> Principal {
        self.principal_pool
            .intern(tags.into_iter().map(PrincipalTag::from))
    }
}

// ---------------------------------------------------------------------------
// Auto-generated delegate methods from YrsComputeEngine bridge descriptors.
//
// Each descriptor group generates:
// 1. `impl ComputeService { ... }` with delegate methods
// 2. `__bridge_descriptor_ComputeService_<group>` macro for WASM/NAPI consumption
// ---------------------------------------------------------------------------

bridge_delegate::delegate!(
    target = ComputeService,
    dispatch = dispatch,
    gated = true,
    compute_core::__bridge_descriptor_YrsComputeEngine_core,
    compute_core::__bridge_descriptor_YrsComputeEngine_core_cells,
    compute_core::__bridge_descriptor_YrsComputeEngine_core_sync,
    compute_core::__bridge_descriptor_YrsComputeEngine_core_undo,
    compute_core::__bridge_descriptor_YrsComputeEngine_core_theme,
    compute_core::__bridge_descriptor_YrsComputeEngine_viewport,
    compute_core::__bridge_descriptor_YrsComputeEngine_tables,
    compute_core::__bridge_descriptor_YrsComputeEngine_features,
    compute_core::__bridge_descriptor_YrsComputeEngine_formatting,
    compute_core::__bridge_descriptor_YrsComputeEngine_structural,
    compute_core::__bridge_descriptor_YrsComputeEngine_queries,
    compute_core::__bridge_descriptor_YrsComputeEngine_cell_semantics,
    compute_core::__bridge_descriptor_YrsComputeEngine_search,
    compute_core::__bridge_descriptor_YrsComputeEngine_atomics,
    compute_core::__bridge_descriptor_YrsComputeEngine_layout,
    compute_core::__bridge_descriptor_YrsComputeEngine_objects,
    compute_core::__bridge_descriptor_YrsComputeEngine_objects_comments,
    compute_core::__bridge_descriptor_YrsComputeEngine_objects_floating,
    compute_core::__bridge_descriptor_YrsComputeEngine_objects_groups,
    compute_core::__bridge_descriptor_YrsComputeEngine_objects_hyperlinks,
    compute_core::__bridge_descriptor_YrsComputeEngine_objects_pivots,
    compute_core::__bridge_descriptor_YrsComputeEngine_objects_z_order,
    compute_core::__bridge_descriptor_YrsComputeEngine_delegations,
    compute_core::__bridge_descriptor_YrsComputeEngine_viewport_registry,
    compute_core::__bridge_descriptor_YrsComputeEngine_export,
    compute_core::__bridge_descriptor_YrsComputeEngine_styles,
    compute_core::__bridge_descriptor_YrsComputeEngine_screenshot,
    compute_core::__bridge_descriptor_YrsComputeEngine_security_ops,
);

// ---------------------------------------------------------------------------
// Lifecycle and special methods — defined directly on ComputeService with
// bridge annotations so codegen picks them up for WASM/NAPI/Tauri.
// ---------------------------------------------------------------------------

#[bridge::api(
    group = "service_lifecycle",
    service = "ComputeService",
    key = "doc_id",
    fn_prefix = "compute",
    crate_path = "compute_api"
)]
impl ComputeService {
    /// Create a new `ComputeService` from a workbook snapshot, returning the
    /// service and the initial recalc result.
    #[bridge::lifecycle(create)]
    pub fn init(
        snapshot: snapshot_types::WorkbookSnapshot,
    ) -> Result<(Self, snapshot_types::RecalcResult), value_types::ComputeError> {
        let (engine, recalc) =
            compute_core::storage::engine::YrsComputeEngine::from_snapshot(snapshot)?;
        let dispatch = crate::dispatch::Dispatch::from_engine(engine).map_err(|e| {
            value_types::ComputeError::Eval {
                message: e.to_string(),
            }
        })?;
        Ok((ComputeService::new(dispatch), recalc))
    }

    /// Create a `ComputeService` from raw Yrs state bytes, returning the
    /// service and the initial recalc result.
    ///
    /// Used for collaboration: subsequent participants fork from the
    /// coordinator's authoritative Yrs state to share CellIds and history.
    #[bridge::lifecycle(create_from = "yrs_state")]
    pub fn init_from_yrs_state(
        state: Vec<u8>,
    ) -> Result<(Self, snapshot_types::RecalcResult), value_types::ComputeError> {
        let (engine, recalc) =
            compute_core::storage::engine::YrsComputeEngine::from_yrs_state(&state)?;
        let dispatch = crate::dispatch::Dispatch::from_engine(engine).map_err(|e| {
            value_types::ComputeError::Eval {
                message: format!("dispatch creation failed: {e}"),
            }
        })?;
        Ok((ComputeService::new(dispatch), recalc))
    }

    // -----------------------------------------------------------------
    // Principal + security-session state (R2.4)
    //
    // Wire-form note: `Principal` itself is deliberately NOT serialisable
    // (its canonical identity is the pool slab pointer; a deserialised
    // `Principal` would be foreign to the pool and silently mismatch the
    // matrix cache; see `compute_security::principal`. All four bridge
    // surface methods therefore trade `Vec<String>` at the wire boundary;
    // `ComputeService` owns the intern step on receipt.
    // -----------------------------------------------------------------

    /// Set the active principal for this session from a tag list. Takes
    /// `&self` via `ArcSwap` — the service doesn't need an actor-mutable
    /// borrow, and the ArcSwap is lock-free. Semantics:
    ///
    /// - No policies on document (`security_active == false`): effectively
    ///   a no-op for access decisions.
    /// - Any policy exists: `None`/empty tags means anonymous (deny by
    ///   default); a caller that never sets a principal is *not* owner.
    ///
    /// Annotated `#[bridge::session]` (R2.4) — a dedicated access kind
    /// for interior-mutable `&self` methods. `#[bridge::write]` would
    /// promote the napi/pyo3 wrapper to `&mut self`, which defeats the
    /// ArcSwap design ("SDKs expect to reset the principal at any point
    /// in a session without coordinating with in-flight calls").
    /// `#[bridge::read]` would wrongly suggest no mutation.
    /// `#[bridge::lifecycle]` is reserved for constructors only.
    #[bridge::session]
    pub fn set_active_principal(&self, tags: Option<Vec<String>>) {
        let principal = tags.map(|ts| {
            self.principal_pool
                .intern(ts.into_iter().map(PrincipalTag::from))
        });
        self.active_principal.store(Arc::new(principal));
    }

    /// Observe the current principal as its explicit tag list (derived
    /// `mog:non-owner` is not included — reconstructible from
    /// `Principal::effective_tags` if callers need it).
    ///
    /// `Vec<String>` on the wire for the reasons documented on
    /// `Principal` itself.
    #[bridge::read]
    pub fn active_principal(&self) -> Option<Vec<String>> {
        self.active_principal
            .load()
            .as_ref()
            .as_ref()
            .map(|p| p.tags().iter().map(|t| t.as_str().to_owned()).collect())
    }

    /// Observe whether access-control enforcement is active on this
    /// document. SDKs use this to warn (e.g. "you set a principal but
    /// the document has no policies, so nothing is enforced").
    #[bridge::read]
    pub fn security_active(&self) -> bool {
        self.security_active.load(Ordering::Relaxed)
    }

    /// Canonicalize a tag list through the intern pool and return the
    /// canonical (sorted, deduped) tag list. Returning `Vec<String>`
    /// rather than `Principal` keeps `Principal` off the wire (see the
    /// section note above). The side effect — interning through the
    /// pool — pre-warms the pool so the next `set_active_principal`
    /// call that sees the same tag set hits an existing slab.
    #[bridge::read]
    pub fn make_principal(&self, tags: Vec<String>) -> Vec<String> {
        let p = self
            .principal_pool
            .intern(tags.into_iter().map(PrincipalTag::from));
        p.tags().iter().map(|t| t.as_str().to_owned()).collect()
    }

    /// Perform a full recalculation of all formula cells using the existing
    /// dependency graph and AST caches. Does NOT rebuild the ComputeCore —
    /// just re-evaluates all formulas in topological order.
    #[bridge::write]
    pub fn full_recalc(
        &mut self,
        options: snapshot_types::RecalcOptions,
    ) -> Result<snapshot_types::RecalcResult, value_types::ComputeError> {
        self.dispatch
            .call_engine(move |engine| engine.recalculate_with_options(&options))
            .map_err(|e| value_types::ComputeError::Eval {
                message: e.to_string(),
            })?
    }
}
