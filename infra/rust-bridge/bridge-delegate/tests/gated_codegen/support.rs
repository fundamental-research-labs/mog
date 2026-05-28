pub mod compute_security {
    use std::sync::atomic::{AtomicU32, Ordering};

    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct Principal {
        pub tags: Vec<PrincipalTag>,
    }

    pub type PrincipalTag = String;

    impl Principal {
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
                } => write!(
                    f,
                    "Denied: op={} required={:?} actual={:?}",
                    operation, required, actual
                ),
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

pub use compute_security::{
    AccessLevel, AccessTarget, CellAddr, CellRange, Principal, PrincipalPool, SheetAccessMatrix,
    SheetId,
};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub struct FakeEngine {
    pub matrix_level: AccessLevel,
    pub workbook_effective: AccessLevel,
    pub check_write_result: Result<(), compute_security::SecurityError>,
    pub matrix_calls: std::sync::atomic::AtomicU32,
    pub check_write_calls: std::sync::atomic::AtomicU32,
    pub effective_access_calls: std::sync::atomic::AtomicU32,
    pub last_check_write_required: Mutex<Option<AccessLevel>>,
    pub last_add_policy_caller: Option<Principal>,
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
            last_check_write_required: Mutex::new(None),
            last_add_policy_caller: None,
        }
    }

    pub fn effective_access(&self, _p: &Principal, target: &AccessTarget) -> AccessLevel {
        self.effective_access_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        match target {
            AccessTarget::Workbook => self.workbook_effective,
            _ => self.matrix_level,
        }
    }

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
        caller: &Principal,
    ) -> Result<u64, compute_security::SecurityError> {
        self.last_add_policy_caller = Some(caller.clone());
        Ok(7)
    }

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
        level: AccessLevel,
        _operation: &'static str,
    ) -> Result<(), compute_security::SecurityError> {
        self.check_write_calls
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        *self.last_check_write_required.lock().unwrap() = Some(level);
        self.check_write_result
            .as_ref()
            .map(|_| ())
            .map_err(|e| compute_security::SecurityError::message(e.to_string()))
    }

    pub fn push_security_event(&self, _event: compute_security::SecurityEvent) {}
}

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

pub struct StubService {
    pub dispatch: FakeDispatch,
    pub active_principal: arc_swap::ArcSwap<Option<Principal>>,
    pub security_active: Arc<AtomicBool>,
    pub principal_pool: Arc<PrincipalPool>,
}

pub struct PlainService {
    pub dispatch: FakeDispatch,
}

pub fn new_service() -> StubService {
    StubService {
        dispatch: FakeDispatch::new(),
        active_principal: arc_swap::ArcSwap::new(Arc::new(None)),
        security_active: Arc::new(AtomicBool::new(false)),
        principal_pool: Arc::new(PrincipalPool::new()),
    }
}

pub mod arc_swap {
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
