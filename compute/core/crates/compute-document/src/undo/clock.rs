use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use yrs::sync::Clock;

/// Capture timeout in milliseconds. Must match `Options.capture_timeout_millis`
/// so the yrs merge logic behaves consistently with our clock increments.
pub(in crate::undo) const MERGE_TIMEOUT: u64 = 1_000_000;

/// A virtual clock that controls whether consecutive yrs transactions merge
/// into a single undo step or remain separate.
///
/// In **normal mode** (default), each call to `now()` jumps forward by
/// `2 * MERGE_TIMEOUT`, guaranteeing the gap exceeds the capture timeout
/// and every transaction becomes its own undo step.
///
/// In **batch mode** (`enter_batch()`), each call to `now()` increments by
/// just 1, keeping the gap well within the capture timeout so all
/// transactions merge into a single undo step.
pub(in crate::undo) struct UndoClock {
    counter: AtomicU64,
    in_batch: AtomicBool,
}

impl UndoClock {
    pub(in crate::undo) fn new() -> Self {
        Self {
            counter: AtomicU64::new(0),
            in_batch: AtomicBool::new(false),
        }
    }

    pub(in crate::undo) fn enter_batch(&self) {
        self.in_batch.store(true, Ordering::Relaxed);
    }

    pub(in crate::undo) fn exit_batch(&self) {
        self.in_batch.store(false, Ordering::Relaxed);
    }
}

impl Clock for UndoClock {
    fn now(&self) -> u64 {
        if self.in_batch.load(Ordering::Relaxed) {
            // Batch mode: small increments -> gap < MERGE_TIMEOUT -> merge
            self.counter.fetch_add(1, Ordering::Relaxed) + 1
        } else {
            // Normal mode: large increments -> gap > MERGE_TIMEOUT -> separate
            self.counter.fetch_add(MERGE_TIMEOUT * 2, Ordering::Relaxed) + MERGE_TIMEOUT * 2
        }
    }
}
