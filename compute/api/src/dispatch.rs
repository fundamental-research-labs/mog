//! Actor dispatch layer — serializes access to the `!Send + !Sync` engine.
//!
//! The engine lives on a dedicated thread. Commands are sent via a channel,
//! and replies come back on bounded(1) oneshots.
//!
//! ## Closure-based dispatch
//!
//! Instead of a per-method `Cmd` enum variant, we use `call_engine` which
//! accepts a closure. This allows sub-API modules to add engine calls
//! independently without modifying this file.

use crate::edit_checkpoint::{CellEditCheckpoint, CellEditEvidence, CellEditTracker};
use crate::error::ComputeApiError;

mod actor {
    use super::*;
    use compute_core::storage::engine::ComputeEngine;
    use crossbeam_channel::{Sender, bounded};
    use std::any::Any;
    use std::thread;

    /// An erased command — a boxed closure that runs on the engine thread.
    struct ErasedCmd(Box<dyn FnOnce(&mut ComputeEngine, &mut CellEditTracker) + Send>);

    enum Cmd {
        Execute(ErasedCmd),
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
        pub fn spawn(engine: ComputeEngine) -> Result<Self, ComputeApiError> {
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
            f: impl FnOnce(&mut ComputeEngine) -> T + Send + 'static,
        ) -> Result<T, ComputeApiError> {
            self.execute(move |engine, tracker| {
                tracker.allow_mutation()?;
                tracker.invalidate("unsupported_mutation");
                Ok(f(engine))
            })?
        }

        fn execute<T: Send + 'static>(
            &self,
            f: impl FnOnce(&mut ComputeEngine, &mut CellEditTracker) -> T + Send + 'static,
        ) -> Result<T, ComputeApiError> {
            let (reply_tx, reply_rx) = bounded::<Box<dyn Any + Send>>(1);
            let cmd = Cmd::Execute(ErasedCmd(Box::new(move |engine, tracker| {
                let result = f(engine, tracker);
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
            f: impl FnOnce(&ComputeEngine) -> T + Send + 'static,
        ) -> Result<T, ComputeApiError> {
            self.execute(move |engine, _| f(engine))
        }

        /// Only audited bookkeeping/calculation operations may bypass the
        /// default invalidation. They still cannot mutate a frozen workbook.
        pub(crate) fn call_preserving_checkpoint<T: Send + 'static>(
            &self,
            f: impl FnOnce(&mut ComputeEngine) -> T + Send + 'static,
        ) -> Result<T, ComputeApiError> {
            self.execute(move |engine, tracker| {
                tracker.allow_mutation()?;
                let result = f(engine);
                tracker.audit_projections(engine);
                Ok(result)
            })?
        }

        /// The only admitted authored mutation: capture positions from the same
        /// owned typed batch that the engine executes, without an extra vector.
        pub(crate) fn call_typed_cell_edit(
            &self,
            updates: Vec<(cell_types::SheetId, u32, u32, crate::mutation::CellInput)>,
        ) -> Result<
            Result<snapshot_types::MutationResult, value_types::ComputeError>,
            ComputeApiError,
        > {
            self.execute(move |engine, tracker| {
                tracker.allow_mutation()?;
                tracker.capture(
                    engine,
                    updates
                        .iter()
                        .map(|(sheet, row, col, _)| (*sheet, *row, *col)),
                );
                let result = engine.batch_set_cells_by_position(updates, false);
                tracker.audit_projections(engine);
                if result.is_err() {
                    tracker.invalidate("typed_edit_failed");
                }
                Ok(result)
            })?
        }

        pub(crate) fn begin_cell_edit_checkpoint(
            &self,
        ) -> Result<CellEditCheckpoint, ComputeApiError> {
            self.execute(|_, tracker| tracker.begin())?
        }

        pub(crate) fn cell_edit_evidence(
            &self,
            id: CellEditCheckpoint,
            freeze: bool,
        ) -> Result<CellEditEvidence, ComputeApiError> {
            self.execute(move |engine, tracker| tracker.inspect(engine, id, freeze))?
        }

        pub(crate) fn invalidate_cell_edit_checkpoint(
            &self,
            reason: &'static str,
        ) -> Result<(), ComputeApiError> {
            self.execute(move |_, tracker| tracker.invalidate(reason))
        }
    }

    /// Engine event loop — runs on the dedicated thread.
    ///
    /// Exits when every [`Dispatch`] handle has been dropped (channel
    /// disconnect). Do not send shutdown from `Drop` of a cloned handle:
    /// `Workbook::sheets()` clones `Dispatch` for a temporary sub-API.
    fn engine_loop(mut engine: ComputeEngine, rx: crossbeam_channel::Receiver<Cmd>) {
        let mut tracker = CellEditTracker::default();
        for cmd in rx {
            match cmd {
                Cmd::Execute(ErasedCmd(f)) => f(&mut engine, &mut tracker),
            }
        }
    }
}

pub use actor::Dispatch;

impl Dispatch {
    /// Spawn the engine on its thread and return a handle.
    pub fn from_engine(
        engine: compute_core::storage::engine::ComputeEngine,
    ) -> Result<Self, ComputeApiError> {
        Self::spawn(engine)
    }
}
