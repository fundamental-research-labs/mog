//! Security event buffer — R5.4.
//!
//! Collects `SecurityEvent`s emitted by `security_ops` (policy CRUD) and
//! by gated-call enforcement (access denial, ambiguity). SDK bindings
//! drain the buffer on a tick via `wb_security_drain_events`; kernel and
//! Python event relays forward the drained list into their subscriber
//! infrastructure.
//!
//! We do not wire a push-notification channel in the engine because the
//! bridge layer is pull-only today — adding a push channel would require
//! a new delegate pattern (long-running subscription across the Dispatch
//! actor boundary) which is out of scope for R5. Pull-at-tick is the
//! minimum that unblocks SDK surfacing without forcing a cross-thread
//! event fan-out design.
//!
//! The buffer is bounded (ring buffer of last N events) — if a burst of
//! events exceeds N before the SDK drains, the oldest are dropped. This
//! matches the security-event policy (unbounded = memory-leak risk,
//! especially for long-running server sessions).

use std::collections::VecDeque;
use std::sync::Mutex;

use compute_security::SecurityEvent;

use super::ComputeEngine;

/// Soft cap on in-flight events. 256 is well above any realistic burst
/// for the R5 scope (policy CRUD happens at user-interaction speed); a
/// production deployment can raise this without correctness impact.
const EVENT_BUFFER_CAP: usize = 256;

/// Ring buffer of pending events. One per engine; drained by the SDK
/// via `wb_security_drain_events`. `Mutex` is fine here because the
/// engine is single-threaded (actor pattern) but the buffer's API is
/// `&self` so the delegate macro can emit `#[bridge::read]` calls
/// against it without reaching for a `&mut self` path.
///
/// Shared with `SecurityState` so policy publications and API mutation events
/// are drained together.
#[derive(Debug, Default)]
pub(crate) struct SecurityEventBuffer {
    inner: Mutex<VecDeque<SecurityEvent>>,
}

impl SecurityEventBuffer {
    /// Push one diagnostic event, dropping the oldest entry at capacity.
    /// Callers can query the native policy list for current authoritative state.
    pub(crate) fn push(&self, event: SecurityEvent) {
        let mut guard = self.inner.lock().expect("SecurityEventBuffer poisoned");
        if guard.len() >= EVENT_BUFFER_CAP {
            guard.pop_front();
        }
        guard.push_back(event);
    }

    /// Drain all pending events. Returns them in insertion order.
    pub(crate) fn drain(&self) -> Vec<SecurityEvent> {
        let mut guard = self.inner.lock().expect("SecurityEventBuffer poisoned");
        guard.drain(..).collect()
    }

    /// Current pending-count (diagnostic; races under concurrent
    /// push/drain but that's fine — this is a hint).
    #[allow(dead_code)]
    pub(crate) fn len(&self) -> usize {
        self.inner
            .lock()
            .expect("SecurityEventBuffer poisoned")
            .len()
    }
}

/// Push one event into the engine's event buffer. Invoked from the
/// `security_ops` CRUD methods after the mutation succeeds, and from
/// the delegate-emitted denial path via a future hook (not in R5's
/// emission surface — the B.1 macro emits denial errors but not
/// events; events flow through the typed return-error path on the
/// SDK side today).
pub(crate) fn push_event(engine: &ComputeEngine, event: SecurityEvent) {
    engine.security_events.push(event);
}
