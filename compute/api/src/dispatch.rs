//! Actor dispatch layer — serializes access to the `!Send + !Sync` engine.
//!
//! On native targets the engine lives on a dedicated thread, commands are sent
//! via a channel, and replies come back on bounded(1) oneshots. On WASM the
//! engine is owned via `Rc<RefCell>` and called synchronously.
//!
//! Both targets expose an identical public API so that `Workbook` and `Sheet`
//! are target-agnostic.
//!
//! ## Closure-based dispatch
//!
//! Instead of a per-method `Cmd` enum variant, we use `call_engine` which
//! accepts a closure. This allows sub-API modules to add engine calls
//! independently without modifying this file.

use crate::error::ComputeApiError;

// =========================================================================
// Native dispatch (threaded actor)
// =========================================================================

#[cfg(feature = "native")]
mod native {
    use super::*;
    use compute_core::storage::engine::YrsComputeEngine;
    use crossbeam_channel::{Sender, bounded};
    use std::any::Any;
    use std::thread;

    /// An erased command — a boxed closure that runs on the engine thread.
    struct ErasedCmd(Box<dyn FnOnce(&mut YrsComputeEngine) + Send>);

    enum Cmd {
        Execute(ErasedCmd),
        Shutdown,
    }

    /// Actor handle for the engine thread. `Clone` to share across `Workbook`
    /// and `Sheet` handles.
    pub struct Dispatch {
        tx: Sender<Cmd>,
    }

    impl Clone for Dispatch {
        fn clone(&self) -> Self {
            Dispatch {
                tx: self.tx.clone(),
            }
        }
    }

    impl Dispatch {
        /// Spawn the engine on a dedicated thread and return a `Dispatch` handle.
        pub fn spawn(engine: YrsComputeEngine) -> Result<Self, ComputeApiError> {
            let (tx, rx) = crossbeam_channel::unbounded();
            thread::Builder::new()
                .name("compute-engine".into())
                .stack_size(16 * 1024 * 1024) // 16 MB — needed for deep serde recursion in OOXML chart export
                .spawn(move || engine_loop(engine, rx))?;
            Ok(Dispatch { tx })
        }

        /// Execute a closure on the engine thread with mutable access.
        ///
        /// This is the primary dispatch primitive. All sub-API methods use this
        /// to call engine methods without needing per-method Cmd variants.
        pub fn call_engine<T: Send + 'static>(
            &self,
            f: impl FnOnce(&mut YrsComputeEngine) -> T + Send + 'static,
        ) -> Result<T, ComputeApiError> {
            let (reply_tx, reply_rx) = bounded::<Box<dyn Any + Send>>(1);
            let cmd = Cmd::Execute(ErasedCmd(Box::new(move |engine| {
                let result = f(engine);
                let _ = reply_tx.send(Box::new(result) as Box<dyn Any + Send>);
            })));
            self.tx
                .send(cmd)
                .map_err(|_| ComputeApiError::EngineShutdown)?;
            let boxed = reply_rx
                .recv()
                .map_err(|_| ComputeApiError::EngineShutdown)?;
            // SAFETY: We know the type because we boxed it ourselves above.
            Ok(*boxed.downcast::<T>().expect("dispatch type mismatch"))
        }

        /// Execute a closure on the engine thread with shared access.
        ///
        /// Convenience wrapper — the engine loop always has `&mut`, but this
        /// makes call-site intent clearer.
        pub fn query_engine<T: Send + 'static>(
            &self,
            f: impl FnOnce(&YrsComputeEngine) -> T + Send + 'static,
        ) -> Result<T, ComputeApiError> {
            self.call_engine(move |engine| f(engine))
        }
    }

    impl Drop for Dispatch {
        fn drop(&mut self) {
            // Best-effort shutdown — if the engine thread is already gone, ignore.
            let _ = self.tx.send(Cmd::Shutdown);
        }
    }

    /// Engine event loop — runs on the dedicated thread.
    fn engine_loop(mut engine: YrsComputeEngine, rx: crossbeam_channel::Receiver<Cmd>) {
        for cmd in rx {
            match cmd {
                Cmd::Execute(ErasedCmd(f)) => f(&mut engine),
                Cmd::Shutdown => break,
            }
        }
    }
}

// =========================================================================
// WASM dispatch (direct, single-threaded)
// =========================================================================

#[cfg(not(feature = "native"))]
mod wasm {
    use super::*;
    use compute_core::storage::engine::YrsComputeEngine;
    use std::cell::RefCell;
    use std::rc::Rc;

    /// Direct dispatch — no thread, no channel. Calls into the engine
    /// synchronously through `Rc<RefCell<...>>`.
    pub struct Dispatch {
        engine: Rc<RefCell<YrsComputeEngine>>,
    }

    impl Clone for Dispatch {
        fn clone(&self) -> Self {
            Dispatch {
                engine: self.engine.clone(),
            }
        }
    }

    impl Dispatch {
        /// Wrap an engine for direct single-threaded access.
        pub fn new(engine: YrsComputeEngine) -> Self {
            Dispatch {
                engine: Rc::new(RefCell::new(engine)),
            }
        }

        /// Execute a closure with mutable engine access.
        pub fn call_engine<T: 'static>(
            &self,
            f: impl FnOnce(&mut YrsComputeEngine) -> T,
        ) -> Result<T, ComputeApiError> {
            Ok(f(&mut self.engine.borrow_mut()))
        }

        /// Execute a closure with shared engine access.
        pub fn query_engine<T: 'static>(
            &self,
            f: impl FnOnce(&YrsComputeEngine) -> T,
        ) -> Result<T, ComputeApiError> {
            Ok(f(&*self.engine.borrow()))
        }
    }
}

// =========================================================================
// Re-export the target-appropriate Dispatch
// =========================================================================

#[cfg(feature = "native")]
pub use native::Dispatch;

#[cfg(not(feature = "native"))]
pub use wasm::Dispatch;

// =========================================================================
// Unified constructor — works regardless of feature flags
// =========================================================================

impl Dispatch {
    /// Create a `Dispatch` from an engine instance.
    ///
    /// On native: spawns a dedicated engine thread.
    /// On WASM: wraps in Rc<RefCell> for synchronous access.
    pub fn from_engine(
        engine: compute_core::storage::engine::YrsComputeEngine,
    ) -> Result<Self, ComputeApiError> {
        #[cfg(feature = "native")]
        {
            Self::spawn(engine)
        }
        #[cfg(not(feature = "native"))]
        {
            Ok(Self::new(engine))
        }
    }
}
