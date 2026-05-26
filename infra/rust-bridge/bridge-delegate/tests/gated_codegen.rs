//! Gated delegate codegen tests.
//!
//! The `bridge_delegate::delegate!` macro expands into real Rust; these tests
//! drive it through the production macro surface with a synthetic descriptor,
//! then exercise the emitted methods at runtime against a fake dispatch/engine
//! pair. The stub types (`Principal`, `AccessLevel`, `AccessTarget`,
//! `SheetAccessMatrix`, `redact_scalar`, ...) are defined inline so the test
//! crate depends only on bridge-delegate — no coupling to compute-security
//! (which is being stood up by a parallel agent and whose R0.2/R0.3 shapes
//! are not yet on dev).
//!
//! Test strategy:
//! - **Positive (token-shape) regression**: `gated = false` must produce code
//!   that does not reference `security_active` or `active_principal`. We check
//!   this by grepping the file source of the expansion — since macro output
//!   isn't directly introspectable here, we check behavior instead: passing a
//!   bogus atomic/arc-swap through and confirming no gated paths fire.
//! - **Positive (runtime fail-safe)**: drive the fast path and gated path with
//!   the four (security_active × principal) combinations.
//! - **Negative (compile_error)**: these live under `tests/trybuild.rs` which
//!   spawns a nested compiler with `trybuild`.
//!
//! Type references in the emitted code resolve against the stubs defined in
//! this file's `compute_security` / `compute_wire` modules (declared at the
//! crate root via `#[path = "..."]` so the expansion can use
//! `compute_security::Principal` etc.).

// The emitted delegate body references `compute_security::*` and
// `compute_wire::*` — we satisfy those via local shim modules.
pub mod compute_security {
    use std::sync::atomic::{AtomicU32, Ordering};

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Principal {
        pub tags: Vec<PrincipalTag>,
    }

    pub type PrincipalTag = String;

    impl Principal {
        /// Test stub: the real `Principal::anonymous` takes a
        /// `&PrincipalPool` so interned-identity cache keys stay sound.
        /// The stub ignores the pool — identity aliasing doesn't matter
        /// at the codegen level; what's tested here is shape, not cache
        /// behaviour.
        pub fn anonymous(_pool: &PrincipalPool) -> Self {
            Principal { tags: Vec::new() }
        }

        pub fn named(tag: &str) -> Self {
            Principal {
                tags: vec![tag.into()],
            }
        }

        pub fn tags(&self) -> &[PrincipalTag] {
            &self.tags
        }
    }

    /// Stub pool. Real `PrincipalPool` canonicalises tag lists and hands
    /// out interned `Arc<[PrincipalTag]>` slabs; tests don't need that —
    /// `anonymous` returns a fresh `Principal` every call.
    pub struct PrincipalPool;

    impl PrincipalPool {
        pub fn new() -> Self {
            PrincipalPool
        }
    }

    impl Default for PrincipalPool {
        fn default() -> Self {
            Self::new()
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
    pub enum AccessLevel {
        None,
        Structure,
        Read,
        Write,
        Admin,
    }

    /// Matches the shape expected by the macro — just enough to call `.get(row, col)`
    /// and satisfy the Arc wrapper expected by `active_matrix`.
    pub struct SheetAccessMatrix {
        pub default_level: AccessLevel,
        pub redactions: AtomicU32,
    }

    impl SheetAccessMatrix {
        pub fn new(default_level: AccessLevel) -> Self {
            Self {
                default_level,
                redactions: AtomicU32::new(0),
            }
        }
        pub fn get(&self, _row: u32, _col: u32) -> AccessLevel {
            self.redactions.fetch_add(1, Ordering::Relaxed);
            self.default_level
        }
        pub fn is_uniform(&self) -> Option<AccessLevel> {
            Some(self.default_level)
        }
    }

    // Stub AccessTarget — mirrors compute-security::policy::AccessTarget shape
    // well enough for the macro-emitted constructor calls to resolve.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum AccessTarget {
        Workbook,
        Sheet { sheet_id: SheetId },
        Column { sheet_id: SheetId, col_id: u32 },
    }

    impl AccessTarget {
        pub fn cell(sheet_id: SheetId, _addr: CellAddr) -> Self {
            AccessTarget::Sheet { sheet_id }
        }
    }

    // Minimal SheetId / CellAddr / CellRange types for the test harness.
    // Production uses cell-types; tests don't need the real shape.
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct SheetId(pub u32);
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct CellAddr {
        pub row: u32,
        pub col: u32,
    }
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub struct CellRange {
        pub start: CellAddr,
        pub end: CellAddr,
    }

    pub fn redact_scalar<T: Default>(raw: T, level: AccessLevel) -> T {
        match level {
            AccessLevel::None => T::default(),
            _ => raw,
        }
    }

    pub fn filter_range_values<T: Default>(
        values: &mut Vec<T>,
        _start_row: u32,
        _start_col: u32,
        _end_row: u32,
        _end_col: u32,
        matrix: &SheetAccessMatrix,
    ) {
        if matches!(matrix.is_uniform(), Some(AccessLevel::None)) {
            for v in values.iter_mut() {
                *v = T::default();
            }
        }
    }

    /// Stub error mirroring `compute_security::SecurityError` just enough
    /// for the macro emission to compile. The gated writes under R3.1
    /// emit `SecurityError::Denied { ... }.into()`, so the stub needs a
    /// matching variant shape.
    #[derive(Debug)]
    pub enum SecurityError {
        Denied {
            principal: Principal,
            target: AccessTarget,
            required: AccessLevel,
            actual: AccessLevel,
            operation: &'static str,
        },
        Message(String),
    }
    impl SecurityError {
        /// Test-only constructor: preserves the old string-wrapping
        /// ergonomics so existing tests can still build a denied error
        /// inline.
        pub fn message(s: impl Into<String>) -> Self {
            SecurityError::Message(s.into())
        }
    }
    impl std::fmt::Display for SecurityError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                SecurityError::Denied {
                    operation,
                    required,
                    actual,
                    ..
                } => {
                    write!(
                        f,
                        "Denied: op={} required={:?} actual={:?}",
                        operation, required, actual
                    )
                }
                SecurityError::Message(s) => write!(f, "{}", s),
            }
        }
    }
    impl std::error::Error for SecurityError {}

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub enum SecurityEvent {
        AccessDenied {
            principal_tags: Vec<PrincipalTag>,
            target: AccessTarget,
            operation: String,
        },
    }

    // The delegate's dispatch error-path goes DispatchError → ComputeError → E.
    // Tests need the conversion to the method's declared error type.
    impl From<super::value_types::ComputeError> for SecurityError {
        fn from(e: super::value_types::ComputeError) -> Self {
            SecurityError::Message(e.to_string())
        }
    }
}

pub mod compute_wire {
    use super::compute_security::{AccessLevel, SheetAccessMatrix};

    pub fn filter_viewport_buffer(buf: &mut Vec<u8>, matrix: &SheetAccessMatrix) {
        if matches!(matrix.is_uniform(), Some(AccessLevel::None)) {
            buf.clear();
        }
    }
}

// ---------------------------------------------------------------------------
// Synthetic engine + service harness
// ---------------------------------------------------------------------------

pub use compute_security::{
    AccessLevel, AccessTarget, CellAddr, CellRange, Principal, PrincipalPool, SheetAccessMatrix,
    SheetId,
};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

/// Fake engine — same shape as YrsComputeEngine but hand-implemented. Tracks
/// how many times each gated helper fires so the tests can assert.
pub struct FakeEngine {
    pub matrix_level: AccessLevel,
    /// Workbook-scope `effective_access` return value. Defaults to
    /// Admin so workbook-scope reads pass through unless the test
    /// explicitly asks for denial.
    pub workbook_effective: AccessLevel,
    pub check_write_result: Result<(), compute_security::SecurityError>,
    pub matrix_calls: std::sync::atomic::AtomicU32,
    pub check_write_calls: std::sync::atomic::AtomicU32,
    pub effective_access_calls: std::sync::atomic::AtomicU32,
}

impl FakeEngine {
    pub fn new() -> Self {
        Self {
            matrix_level: AccessLevel::Admin,
            workbook_effective: AccessLevel::Admin,
            check_write_result: Ok(()),
            matrix_calls: std::sync::atomic::AtomicU32::new(0),
            check_write_calls: std::sync::atomic::AtomicU32::new(0),
            effective_access_calls: std::sync::atomic::AtomicU32::new(0),
        }
    }

    /// Stub mirror of `YrsComputeEngine::effective_access` — only
    /// meaningfully distinguishes `Workbook`; other targets piggy-back
    /// on `matrix_level` since the tests don't exercise them via this
    /// entry point.
    pub fn effective_access(&self, _p: &Principal, target: &AccessTarget) -> AccessLevel {
        self.effective_access_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        match target {
            AccessTarget::Workbook => self.workbook_effective,
            _ => self.matrix_level,
        }
    }

    // These are the engine-side methods referenced by the descriptor below.
    // All return Result to match the descriptor's `fallible;` marker.
    pub fn get_cell_value(
        &self,
        _sheet: SheetId,
        _addr: CellAddr,
    ) -> Result<u32, compute_security::SecurityError> {
        Ok(42)
    }
    pub fn get_range(
        &self,
        _sheet: SheetId,
        _range: CellRange,
    ) -> Result<Vec<u32>, compute_security::SecurityError> {
        Ok(vec![1, 2, 3])
    }
    pub fn get_viewport(
        &self,
        _sheet: SheetId,
        _bounds: u32,
    ) -> Result<Vec<u8>, compute_security::SecurityError> {
        Ok(vec![0xAA, 0xBB, 0xCC])
    }
    pub fn list_sheets(&self) -> Result<Vec<u32>, compute_security::SecurityError> {
        Ok(vec![0, 1, 2])
    }
    /// Scope-sheet scalar read — used by R4.2 to confirm that a scope="sheet"
    /// method with a non-Vec<u8> return type does NOT run through
    /// `filter_viewport_buffer` (only byte-returning sheet reads do). Falls
    /// through to the macro's passthrough arm.
    pub fn sheet_row_count(&self, _sheet: SheetId) -> Result<u32, compute_security::SecurityError> {
        Ok(99)
    }
    pub fn set_cell(
        &mut self,
        _sheet: SheetId,
        _addr: CellAddr,
        _v: u32,
    ) -> Result<(), compute_security::SecurityError> {
        Ok(())
    }
    pub fn insert_rows(
        &mut self,
        _sheet: SheetId,
        _at: u32,
        _n: u32,
    ) -> Result<(), compute_security::SecurityError> {
        Ok(())
    }
    pub fn add_policy(
        &mut self,
        _policy: u32,
        _caller: &Principal,
    ) -> Result<u64, compute_security::SecurityError> {
        Ok(7)
    }

    // Gate primitives — consumed by the macro's gated path.
    pub fn active_matrix(&self, _p: &Principal, _sheet: SheetId) -> Arc<SheetAccessMatrix> {
        self.matrix_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Arc::new(SheetAccessMatrix::new(self.matrix_level))
    }
    pub fn active_matrix_workbook(&self, _p: &Principal) -> Arc<SheetAccessMatrix> {
        self.matrix_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Arc::new(SheetAccessMatrix::new(self.matrix_level))
    }
    pub fn check_write(
        &self,
        _p: &Principal,
        _target: &AccessTarget,
        _level: AccessLevel,
        _operation: &'static str,
    ) -> Result<(), compute_security::SecurityError> {
        self.check_write_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.check_write_result
            .as_ref()
            .map(|_| ())
            .map_err(|e| compute_security::SecurityError::message(e.to_string()))
    }

    pub fn push_security_event(&self, _event: compute_security::SecurityEvent) {}
}

/// Single-threaded dispatch — simpler than spawning a thread for test hermeticity.
pub struct FakeDispatch {
    engine: std::cell::RefCell<FakeEngine>,
}

impl FakeDispatch {
    pub fn new() -> Self {
        Self {
            engine: std::cell::RefCell::new(FakeEngine::new()),
        }
    }

    pub fn engine(&self) -> std::cell::RefMut<'_, FakeEngine> {
        self.engine.borrow_mut()
    }

    pub fn call_engine<T: 'static>(
        &self,
        f: impl FnOnce(&mut FakeEngine) -> T,
    ) -> Result<T, FakeDispatchError> {
        let mut engine = self.engine.borrow_mut();
        Ok(f(&mut engine))
    }

    pub fn query_engine<T: 'static>(
        &self,
        f: impl FnOnce(&FakeEngine) -> T,
    ) -> Result<T, FakeDispatchError> {
        let engine = self.engine.borrow();
        Ok(f(&engine))
    }
}

#[derive(Debug)]
pub struct FakeDispatchError(pub String);
impl std::fmt::Display for FakeDispatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}
impl std::error::Error for FakeDispatchError {}

/// Stand-in for ComputeService.
pub struct StubService {
    pub dispatch: FakeDispatch,
    pub active_principal: arc_swap::ArcSwap<Option<Principal>>,
    pub security_active: Arc<AtomicBool>,
    /// The gated codegen calls `self.principal_pool` when building a
    /// fail-safe anonymous `Principal`. Matches the production
    /// `ComputeService` field name.
    pub principal_pool: Arc<PrincipalPool>,
}

// The macro-generated bodies reference `value_types::ComputeError` via the
// default error path; define a shim compatible with .to_string().
pub mod value_types {
    #[derive(Debug)]
    pub enum ComputeError {
        Eval { message: String },
    }
    impl std::fmt::Display for ComputeError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                ComputeError::Eval { message } => write!(f, "{}", message),
            }
        }
    }
    impl std::error::Error for ComputeError {}
}

// Note: we set `skip_default_imports = true` on the delegate! invocations
// below, so the macro does not emit `use compute_core::*` — no shim needed.

// ---------------------------------------------------------------------------
// Synthetic descriptor macros — mimic the shape bridge-core emits.
// One with `gated = true`, one with `gated = false`.
// ---------------------------------------------------------------------------

/// Descriptor containing one method of each gated kind + pure/lifecycle.
/// Scopes declared so it's valid under `gated = true`.
#[macro_export]
macro_rules! __bridge_descriptor_stub_gated {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = stub;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method read get_range {
                params { [prim] sheet: SheetId, [prim] range: CellRange, }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "range";
            }
            method read get_viewport {
                params { [prim] sheet: SheetId, [prim] bounds: u32, }
                return_type = Vec<u8>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method read list_sheets {
                params { }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
            }
            method read sheet_row_count {
                params { [prim] sheet: SheetId, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method structural insert_rows {
                params { [prim] sheet: SheetId, [prim] at: u32, [prim] n: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write add_policy {
                params { [prim] policy: u32, [serde] caller: &Principal, }
                return_type = u64;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
                needs_principal;
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = stub;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method read get_range {
                params { [prim] sheet: SheetId, [prim] range: CellRange, }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "range";
            }
            method read get_viewport {
                params { [prim] sheet: SheetId, [prim] bounds: u32, }
                return_type = Vec<u8>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method read list_sheets {
                params { }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
            }
            method read sheet_row_count {
                params { [prim] sheet: SheetId, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method structural insert_rows {
                params { [prim] sheet: SheetId, [prim] at: u32, [prim] n: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write add_policy {
                params { [prim] policy: u32, [serde] caller: &Principal, }
                return_type = u64;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
                needs_principal;
            }
        }
    };
}

/// Descriptor without scope/needs_principal — used for `gated = false` regression.
/// Produces pre-B.1 codegen.
#[macro_export]
macro_rules! __bridge_descriptor_stub_plain {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = plain;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = plain;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
            }
        }
    };
}

// ---------------------------------------------------------------------------
// Arc-swap minimal shim (the real one is a separate crate; we avoid a dep).
// ---------------------------------------------------------------------------
mod arc_swap {
    use std::sync::{Arc, Mutex};

    pub struct ArcSwap<T> {
        inner: Mutex<Arc<T>>,
    }
    impl<T> ArcSwap<T> {
        pub fn new(v: Arc<T>) -> Self {
            Self {
                inner: Mutex::new(v),
            }
        }
        pub fn load_full(&self) -> Arc<T> {
            self.inner.lock().unwrap().clone()
        }
        pub fn store(&self, v: Arc<T>) {
            *self.inner.lock().unwrap() = v;
        }
    }
}

// ---------------------------------------------------------------------------
// Invoke the macro under both configurations and verify runtime behavior.
// ---------------------------------------------------------------------------

// Gated expansion: wires security fast-path + gated path into every
// read/write/structural method on StubService.
bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__bridge_descriptor_stub_gated,
);

// Non-gated expansion: a different service type so the two do not collide.
pub struct PlainService {
    pub dispatch: FakeDispatch,
}

bridge_delegate::delegate!(
    target = PlainService,
    dispatch = dispatch,
    skip_default_imports = true,
    crate::__bridge_descriptor_stub_plain,
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

fn new_service() -> StubService {
    StubService {
        dispatch: FakeDispatch::new(),
        active_principal: arc_swap::ArcSwap::new(Arc::new(None)),
        security_active: Arc::new(AtomicBool::new(false)),
        principal_pool: Arc::new(PrincipalPool::new()),
    }
}

#[test]
fn gated_false_with_no_principal_passthrough() {
    // security_active = false, principal = None → fast path, no matrix fetch.
    let svc = new_service();
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42);
    assert_eq!(
        svc.dispatch
            .engine()
            .matrix_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0,
        "fast path must skip matrix fetch"
    );
}

#[test]
fn gated_false_with_some_principal_still_passthrough() {
    // Session-set principal is irrelevant until the document opts in.
    let svc = new_service();
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:foo"))));
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42);
    assert_eq!(
        svc.dispatch
            .engine()
            .matrix_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0
    );
}

#[test]
fn gated_true_with_no_principal_uses_anonymous() {
    // security_active = true, principal = None → anonymous fail-safe.
    // With matrix_level = None, redact_scalar returns default.
    let svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, u32::default(), "anonymous + None level must redact");
    assert_eq!(
        svc.dispatch
            .engine()
            .matrix_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        1,
        "gated path must fetch matrix"
    );
}

#[test]
fn gated_true_with_some_principal_normal_resolution() {
    let svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:owner"))));
    svc.dispatch.engine().matrix_level = AccessLevel::Read;
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42, "Read level passes through raw value");
}

#[test]
fn security_active_flip_changes_path() {
    let svc = new_service();
    // Call 1: fast path.
    let _ = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    let calls_after_first = svc
        .dispatch
        .engine()
        .matrix_calls
        .load(std::sync::atomic::Ordering::Relaxed);
    // Flip → call 2: gated path.
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    let calls_after_second = svc
        .dispatch
        .engine()
        .matrix_calls
        .load(std::sync::atomic::Ordering::Relaxed);
    assert_eq!(calls_after_first, 0);
    assert_eq!(calls_after_second, 1);
}

#[test]
fn cell_write_gated_true_denied_when_matrix_denies() {
    // R3.1 — cell-scope writes check `matrix.get(row, col)` instead of
    // the old `check_write(&AccessTarget::cell(sheet, addr), ...)`.
    // Matrix-level None → write denied with SecurityError::Denied.
    let mut svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let err = svc
        .set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 5)
        .unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("Denied") || err_str.contains("denied"),
        "cell write under matrix-None must surface a Denied error, got: {}",
        err_str
    );
    // check_write is NOT called for cell-scope writes (the matrix IS the
    // cell-level primitive). Matrix-fetch counts as the gating call.
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0,
        "cell-scope writes do not call check_write"
    );
    assert_eq!(
        svc.dispatch
            .engine()
            .matrix_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        1,
        "cell-scope writes fetch the matrix once"
    );
}

#[test]
fn cell_write_gated_true_allowed_when_matrix_permits() {
    let mut svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::Write;
    svc.set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 5)
        .unwrap();
}

#[test]
fn cell_write_gated_false_does_not_touch_matrix() {
    let mut svc = new_service();
    // security_active stays false → fast path straight dispatch.
    svc.set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 5)
        .unwrap();
    assert_eq!(
        svc.dispatch
            .engine()
            .matrix_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0,
        "fast path must skip matrix fetch"
    );
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0,
        "fast path must skip check_write"
    );
}

#[test]
fn structural_uses_admin_level() {
    // We can't easily introspect the AccessLevel argument without extending
    // the stub, but we can confirm that (a) the structural method compiles
    // under gated = true with scope = "sheet", (b) the gated path runs
    // check_write. The stricter admin-vs-write assertion is a unit-level
    // concern for the R0.3 engine impl, not the macro.
    let mut svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.insert_rows(SheetId(0), 0, 1).unwrap();
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        1
    );
}

#[test]
fn needs_principal_bypasses_fast_path() {
    // security_active = false — a normal write would take the fast path, but
    // needs_principal methods must still thread the principal.
    let mut svc = new_service();
    let pid = svc.add_policy(123).unwrap();
    assert_eq!(pid, 7);
    // check_write IS called (gated path taken even when security_active is false)
    // because the macro skips fast-path emission for needs_principal methods.
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        1,
        "needs_principal bypasses fast path"
    );
}

#[test]
fn needs_principal_signature_strips_trailing_param() {
    // The public signature hides `caller: &Principal`; verified by the call
    // above compiling with just `(policy)` as the argument.
    let mut svc = new_service();
    // One positional arg — if the trailing &Principal leaked through the
    // public signature, this wouldn't compile.
    let _pid = svc.add_policy(1).unwrap();
}

#[test]
fn range_read_uses_filter_range_values() {
    let svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let vals = svc
        .get_range(
            SheetId(0),
            CellRange {
                start: CellAddr { row: 0, col: 0 },
                end: CellAddr { row: 1, col: 1 },
            },
        )
        .unwrap();
    // filter_range_values clears values when uniform None.
    assert!(
        vals.iter().all(|v| *v == 0),
        "range filter redacts uniform None"
    );
}

#[test]
fn viewport_read_uses_filter_viewport_buffer() {
    let svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let buf = svc.get_viewport(SheetId(0), 0).unwrap();
    assert!(buf.is_empty(), "viewport filter clears uniform None");
}

#[test]
fn workbook_read_gated_denied_when_effective_below_read() {
    // Bug 2 fix: workbook-scope reads must pre-check
    // `effective_access(principal, Workbook) >= Read` and surface a
    // `SecurityError::Denied` when below. Without the fix the principal
    // was fetched, discarded, and the engine call went through.
    let svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:guest"))));
    // Workbook-level effective access says None (below Read).
    svc.dispatch.engine().workbook_effective = AccessLevel::None;
    let err = svc.list_sheets().unwrap_err();
    let err_str = err.to_string();
    assert!(
        err_str.contains("Denied") || err_str.contains("denied"),
        "workbook-scope read below Read must surface Denied, got: {}",
        err_str
    );
    // effective_access was consulted exactly once on the gated path.
    assert_eq!(
        svc.dispatch
            .engine()
            .effective_access_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        1,
        "gated workbook read must pre-check effective_access"
    );
}

#[test]
fn workbook_read_gated_allowed_when_effective_at_or_above_read() {
    let svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.active_principal
        .store(Arc::new(Some(Principal::named("agent:reader"))));
    svc.dispatch.engine().workbook_effective = AccessLevel::Read;
    let sheets = svc.list_sheets().unwrap();
    assert_eq!(sheets, vec![0, 1, 2]);
    assert_eq!(
        svc.dispatch
            .engine()
            .effective_access_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        1
    );
}

#[test]
fn workbook_read_gated_false_skips_effective_access() {
    // Fast path is preserved: with security_active == false, the gated
    // workbook-read pre-check never fires.
    let svc = new_service();
    svc.dispatch.engine().workbook_effective = AccessLevel::None;
    let sheets = svc.list_sheets().unwrap();
    assert_eq!(sheets, vec![0, 1, 2]);
    assert_eq!(
        svc.dispatch
            .engine()
            .effective_access_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0,
        "fast path must skip the workbook effective_access pre-check"
    );
}

#[test]
fn security_active_flip_true_to_false_returns_to_fast_path() {
    // R2.3: the activation latch must support both directions. Flip
    // true → false and confirm the fast path is re-engaged.
    let svc = new_service();
    // Start gated: first call consults effective_access.
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.dispatch.engine().workbook_effective = AccessLevel::Read;
    let _ = svc.list_sheets().unwrap();
    let calls_after_gated = svc
        .dispatch
        .engine()
        .effective_access_calls
        .load(std::sync::atomic::Ordering::Relaxed);
    // Flip off: next call must take the fast path, no new pre-check.
    svc.security_active
        .store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = svc.list_sheets().unwrap();
    let calls_after_flip_off = svc
        .dispatch
        .engine()
        .effective_access_calls
        .load(std::sync::atomic::Ordering::Relaxed);
    assert_eq!(calls_after_gated, 1);
    assert_eq!(
        calls_after_flip_off, 1,
        "flipping security_active back to false must restore fast path"
    );
}

/// R4.2 post-filter lookup table: `scope = "sheet"` with a non-byte return
/// (here: `u32`) must NOT route through `filter_viewport_buffer`. The macro
/// falls through to the passthrough arm (the raw value returns unchanged),
/// which is the intended behaviour — scalar sheet-level reads don't carry
/// per-cell data for the viewport filter to redact.
///
/// If someone later rewires the table so scope="sheet" emits the viewport
/// filter unconditionally, this test fails: our fake `filter_viewport_buffer`
/// takes `&mut Vec<u8>`, which doesn't typecheck against `u32`, so the build
/// breaks before runtime — but if the emission switched to a scalar redactor
/// by mistake, we'd also see the raw value change, which this assertion
/// locks down.
#[test]
fn sheet_scope_scalar_read_is_passthrough() {
    let svc = new_service();
    svc.security_active
        .store(true, std::sync::atomic::Ordering::Relaxed);
    svc.dispatch.engine().matrix_level = AccessLevel::None;
    let v = svc.sheet_row_count(SheetId(0)).unwrap();
    // Stub returns 99. If the macro were redacting this via redact_scalar
    // against a None-level matrix, we'd see `u32::default() == 0`.
    assert_eq!(v, 99, "scope=sheet + scalar must not be post-filtered");
}

// ---------------------------------------------------------------------------
// Regression — gated = false emits the old shape
// ---------------------------------------------------------------------------

#[test]
fn non_gated_service_has_no_principal_state() {
    // If gated = false leaked any security plumbing into PlainService, the
    // call to set_cell would trip on missing active_principal/security_active
    // fields. Their absence here (PlainService has only `dispatch`) is the
    // regression guard.
    let mut svc = PlainService {
        dispatch: FakeDispatch::new(),
    };
    svc.set_cell(SheetId(0), CellAddr { row: 0, col: 0 }, 7)
        .unwrap();
    assert_eq!(
        svc.dispatch
            .engine()
            .check_write_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0,
        "non-gated service never calls check_write"
    );
}

// ---------------------------------------------------------------------------
// Re-emitted descriptor shape check
// ---------------------------------------------------------------------------
// The delegate macro re-emits `__bridge_descriptor_StubService_stub` for
// downstream bindings. Under B.1 it must strip `scope = "..."`,
// `needs_principal;`, and collapse `method structural` → `method write` so
// bridge-napi/pyo3/wasm (which don't yet handle those tokens) keep building.
// The receiver-macro pattern below captures the re-emitted DSL and asserts
// the expected shape by matching its exact tokens.

macro_rules! __assert_reemitted_shape {
    (
        bridge_version = 1;
        group = stub;
        type_name = StubService;
        method read get_cell_value {
            params { [prim] sheet: $_s1:ty, [prim] addr: $_a1:ty, }
            return_type = u32;
            error_type = $_e1:path;
            fallible;
        }
        method read get_range {
            params { [prim] sheet: $_s2:ty, [prim] range: $_r2:ty, }
            return_type = Vec<u32>;
            error_type = $_e2:path;
            fallible;
        }
        method read get_viewport {
            params { [prim] sheet: $_s3:ty, [prim] bounds: u32, }
            return_type = Vec<u8>;
            error_type = $_e3:path;
            fallible;
        }
        method read list_sheets {
            params { }
            return_type = Vec<u32>;
            error_type = $_e4:path;
            fallible;
        }
        method read sheet_row_count {
            params { [prim] sheet: $_s_src:ty, }
            return_type = u32;
            error_type = $_esrc:path;
            fallible;
        }
        method write set_cell {
            params { [prim] sheet: $_s5:ty, [prim] addr: $_a5:ty, [prim] v: u32, }
            return_type = ();
            error_type = $_e5:path;
            fallible;
        }
        method write insert_rows {   // structural collapses to write
            params { [prim] sheet: $_s6:ty, [prim] at: u32, [prim] n: u32, }
            return_type = ();
            error_type = $_e6:path;
            fallible;
        }
        method write add_policy {    // needs_principal stripped; no &Principal in public params
            params { [prim] policy: u32, }
            return_type = u64;
            error_type = $_e7:path;
            fallible;
        }
    ) => {
        #[test]
        fn reemitted_descriptor_has_expected_shape() {
            // Compile success = expected shape matched.
        }
    };
}

__bridge_descriptor_StubService_stub!(__assert_reemitted_shape);

#[test]
fn non_gated_read_goes_straight_to_engine() {
    let svc = PlainService {
        dispatch: FakeDispatch::new(),
    };
    let v = svc
        .get_cell_value(SheetId(0), CellAddr { row: 0, col: 0 })
        .unwrap();
    assert_eq!(v, 42);
    assert_eq!(
        svc.dispatch
            .engine()
            .matrix_calls
            .load(std::sync::atomic::Ordering::Relaxed),
        0,
        "non-gated read never fetches matrix"
    );
}
