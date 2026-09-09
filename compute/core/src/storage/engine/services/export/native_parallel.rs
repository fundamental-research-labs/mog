//! Execution boundary for native worksheet export.
//!
//! Export projects typed DrawingML objects from native workbook storage.
//! Deserializing the nested OOXML chart model needs more stack in debug builds
//! than Rayon's default workers provide. The caller's stack size (including the
//! compute API actor's stack) does not apply to parallel iterator workers.

use std::sync::OnceLock;

use rayon::{ThreadPool, ThreadPoolBuilder};
use value_types::ComputeError;

/// Reuse one pool across workbooks without changing a host application's global
/// Rayon pool. Every sheet projection, including nested parallel work, inherits
/// the same OOXML stack budget.
pub(super) fn install<T: Send>(operation: impl FnOnce() -> T + Send) -> Result<T, ComputeError> {
    static POOL: OnceLock<Result<ThreadPool, String>> = OnceLock::new();
    let pool = POOL.get_or_init(|| {
        ThreadPoolBuilder::new()
            .thread_name(|index| format!("xlsx-export-{index}"))
            .stack_size(16 * 1024 * 1024)
            .build()
            .map_err(|error| format!("failed to start XLSX export workers: {error}"))
    });
    match pool {
        Ok(pool) => Ok(pool.install(operation)),
        Err(message) => Err(ComputeError::ExportError {
            message: message.clone(),
        }),
    }
}
