//! Yrs `update_v1` buffer for provider synchronization.
//!
//! When a `YrsComputeEngine` is constructed, we install one
//! `compute_collab::subscribe_update_v1` listener on the underlying yrs
//! `Doc`. Every committed write transaction fires the listener once; we
//! push the v1-encoded update bytes into [`UpdateBuffer`]. The bridge
//! exposes `compute_drain_pending_updates`, which the kernel-side
//! orchestrator polls (via a microtask tick) and fans out to attached
//! Providers.
//!
//! # Why pull, not push
//!
//! The cross-Dispatch-actor boundary on native (NAPI / Tauri) makes a
//! true push channel costly: we'd need a long-running threadsafe-function
//! handle bound to the engine thread. Pull-at-tick is sufficient because:
//!
//! - Volume is normally bounded by transaction count. Some transports can still
//!   surface very large user edits as many small update payloads, so drains are
//!   chunked under a byte cap instead of requiring the entire pending queue to
//!   fit in one bridge result.
//! - Microtask coalescing on the TS side absorbs the per-tick latency.
//! - If push notifications are needed later, the bridge layer can grow a real
//!   notification channel without changing the buffer's API — the buffer
//!   already exposes `len()` for a "is there anything?" probe.
//!
//! # Why unbounded
//!
//! Bounded eviction would silently drop user edits, breaking the
//! IndexedDB-Provider's "no edit lost on refresh" contract. Total
//! volume is bounded by transaction count between drains; at 60Hz drain
//! cadence even a pathological 1KHz commit rate accumulates only ~17
//! entries per tick. Memory pressure is not a real concern for the single-tab,
//! single-doc editing use case.

use std::fmt;
use std::sync::{Arc, Mutex};

use value_types::ComputeError;

/// Defensive cap for live provider `update_v1` drains.
///
/// Imported base state must reach providers through full-state snapshots, not
/// live update fan-out. A payload this large is overwhelmingly likely to be a
/// leaked bootstrap transaction; reject it before bridge serialization tries to
/// allocate a JS/WASM array for the bytes.
pub(crate) const MAX_PROVIDER_UPDATE_BYTES: usize = 64 * 1024 * 1024;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UpdateSource {
    UserMutation,
    UndoRedo,
    ImportBootstrap,
    FullHydration,
    InternalRebuild,
}

impl fmt::Display for UpdateSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let label = match self {
            UpdateSource::UserMutation => "user_mutation",
            UpdateSource::UndoRedo => "undo_redo",
            UpdateSource::ImportBootstrap => "import_bootstrap",
            UpdateSource::FullHydration => "full_hydration",
            UpdateSource::InternalRebuild => "internal_rebuild",
        };
        f.write_str(label)
    }
}

#[derive(Debug)]
struct PendingUpdate {
    source: UpdateSource,
    bytes: Vec<u8>,
}

/// Append-only queue of v1-encoded yrs updates pending a Provider drain.
///
/// One per [`YrsComputeEngine`](super::YrsComputeEngine). Wrapped in
/// `Arc<Mutex<>>` because the yrs `observe_update_v1` callback runs on
/// the commit path with `Send + Sync + 'static` bounds, while the bridge
/// drain calls run on the dispatch actor thread; both need shared
/// mutable access.
#[derive(Debug, Default)]
pub(crate) struct UpdateBuffer {
    inner: Mutex<Vec<PendingUpdate>>,
}

impl UpdateBuffer {
    /// Push one v1-encoded update payload.
    ///
    /// Called from the `subscribe_update_v1` callback exactly once per
    /// `txn.commit()`. Per yrs's `observe_update_v1` contract, the
    /// payload is the encoded delta for the entire transaction — bulk
    /// transactions produce one (large) payload, not one per mutation.
    pub(crate) fn push(&self, update: Vec<u8>) {
        self.push_with_source(UpdateSource::UserMutation, update);
    }

    /// Push one v1-encoded update payload with an explicit diagnostic source.
    ///
    /// Source tags are intentionally metadata only: the provider protocol still
    /// drains a flat `Vec<Vec<u8>>`, while guardrail errors can report which
    /// class of transaction leaked into the live-update path.
    pub(crate) fn push_with_source(&self, source: UpdateSource, update: Vec<u8>) {
        let mut guard = self.inner.lock().expect("UpdateBuffer poisoned");
        guard.push(PendingUpdate {
            source,
            bytes: update,
        });
    }

    /// Drain all pending updates. Returns them in commit order (FIFO).
    ///
    /// The Provider-protocol contract (§3.3) guarantees orchestrator
    /// fan-out preserves yrs commit order. Returning a `Vec<Vec<u8>>`
    /// preserves that — callers feed the slice into Providers in
    /// iteration order.
    #[allow(dead_code)]
    pub(crate) fn drain(&self) -> Vec<Vec<u8>> {
        let mut guard = self.inner.lock().expect("UpdateBuffer poisoned");
        std::mem::take(&mut *guard)
            .into_iter()
            .map(|pending| pending.bytes)
            .collect()
    }

    /// Drain pending updates after enforcing the per-drain cap.
    ///
    /// A single update larger than the cap is rejected as a likely bootstrap
    /// leak. Multiple smaller updates are drained as a FIFO prefix whose total
    /// bytes fit under the cap, leaving the tail queued for the next drain.
    pub(crate) fn drain_checked(&self) -> Result<Vec<Vec<u8>>, ComputeError> {
        self.drain_checked_with_cap(MAX_PROVIDER_UPDATE_BYTES)
    }

    fn drain_checked_with_cap(&self, cap_bytes: usize) -> Result<Vec<Vec<u8>>, ComputeError> {
        let mut guard = self.inner.lock().expect("UpdateBuffer poisoned");
        let pending_updates = guard.len();
        if let Some(oversized) = guard.iter().find(|pending| pending.bytes.len() > cap_bytes) {
            return Err(ComputeError::InvalidInput {
                message: format!(
                    "bootstrap update leaked into provider drain: updateBytes={}, pendingUpdates={}, source={}, capBytes={}",
                    oversized.bytes.len(),
                    pending_updates,
                    oversized.source,
                    cap_bytes,
                ),
            });
        }

        let mut drain_len = 0usize;
        let mut total_bytes = 0usize;
        for pending in guard.iter() {
            let update_bytes = pending.bytes.len();
            if drain_len > 0 && total_bytes.saturating_add(update_bytes) > cap_bytes {
                break;
            }
            total_bytes += update_bytes;
            drain_len += 1;
        }

        if drain_len == guard.len() {
            return Ok(std::mem::take(&mut *guard)
                .into_iter()
                .map(|pending| pending.bytes)
                .collect());
        }

        Ok(guard
            .drain(0..drain_len)
            .into_iter()
            .map(|pending| pending.bytes)
            .collect())
    }

    /// Drop all pending updates without returning them.
    ///
    /// Used when an engine replaces its underlying Yrs document with imported
    /// base state. Bytes from the old document are not causally valid for the
    /// replacement document and must not later fan out as live provider edits.
    pub(crate) fn clear(&self) {
        let mut guard = self.inner.lock().expect("UpdateBuffer poisoned");
        guard.clear();
    }

    /// Current pending count (diagnostic; races under concurrent
    /// push/drain but that's fine — this is a hint to skip a no-op
    /// bridge round-trip).
    #[allow(dead_code)]
    pub(crate) fn len(&self) -> usize {
        self.inner.lock().expect("UpdateBuffer poisoned").len()
    }
}

/// Install the `subscribe_update_v1` observer on `doc` and wire it to
/// `buffer`. Returns the subscription handle — the caller must store it
/// alongside the engine; dropping it unsubscribes.
///
/// Called once at engine construction time (from
/// [`construction::assemble_engine_inner`](super::construction)).
pub(crate) fn install_observer(
    doc: &yrs::Doc,
    buffer: &Arc<UpdateBuffer>,
) -> compute_collab::UpdateSubscriptionHandle {
    let buffer = Arc::clone(buffer);
    compute_collab::subscribe_update_v1(doc, move |bytes| {
        buffer.push(bytes.to_vec());
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drain_checked_rejects_bootstrap_sized_payload_with_source_diagnostic() {
        let buffer = UpdateBuffer::default();
        buffer.push_with_source(UpdateSource::ImportBootstrap, vec![0; 5]);

        let err = buffer
            .drain_checked_with_cap(4)
            .expect_err("oversized provider drain should be rejected");
        let message = err.to_string();
        assert!(
            message.contains("bootstrap update leaked into provider drain"),
            "{message}"
        );
        assert!(message.contains("source=import_bootstrap"), "{message}");
        assert!(message.contains("capBytes=4"), "{message}");
        assert_eq!(buffer.len(), 1, "diagnostic rejection must not drop bytes");
    }

    #[test]
    fn drain_checked_preserves_fifo_bytes_for_normal_updates() {
        let buffer = UpdateBuffer::default();
        buffer.push_with_source(UpdateSource::UserMutation, vec![1, 2, 3]);
        buffer.push_with_source(UpdateSource::UndoRedo, vec![4, 5]);

        let drained = buffer
            .drain_checked()
            .expect("normal provider updates should drain");
        assert_eq!(drained, vec![vec![1, 2, 3], vec![4, 5]]);
        assert_eq!(buffer.len(), 0);
    }

    #[test]
    fn drain_checked_chunks_valid_updates_over_total_cap() {
        let buffer = UpdateBuffer::default();
        buffer.push_with_source(UpdateSource::UserMutation, vec![1, 1, 1]);
        buffer.push_with_source(UpdateSource::UserMutation, vec![2, 2, 2, 2]);
        buffer.push_with_source(UpdateSource::UserMutation, vec![3]);

        let first = buffer
            .drain_checked_with_cap(5)
            .expect("valid provider updates should drain in chunks");
        assert_eq!(first, vec![vec![1, 1, 1]]);
        assert_eq!(buffer.len(), 2);

        let second = buffer
            .drain_checked_with_cap(5)
            .expect("remaining provider updates should drain in FIFO order");
        assert_eq!(second, vec![vec![2, 2, 2, 2], vec![3]]);
        assert_eq!(buffer.len(), 0);
    }
}
