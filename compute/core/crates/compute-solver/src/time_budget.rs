//! Local elapsed-time budget clock for solver algorithms.
//!
//! This module is intentionally package-local. It exposes only instants and
//! durations for solver budgets; semantic wall time, IDs, entropy, and host
//! runtime facts must come from caller-owned contracts.

use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
pub struct BudgetInstant(Instant);

impl BudgetInstant {
    #[inline]
    pub fn now() -> Self {
        Self(Instant::now())
    }

    #[inline]
    pub fn elapsed(&self) -> Duration {
        self.0.elapsed()
    }
}
