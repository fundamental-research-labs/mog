//! Elapsed-time utilities for compute-core.
//!
//! This module is intentionally local to compute-core. It exists only for
//! elapsed-time budgets and profiling; semantic wall time must be supplied by
//! callers through explicit APIs.

use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
pub struct ElapsedInstant(Instant);

impl ElapsedInstant {
    #[inline]
    pub fn now() -> Self {
        Self(Instant::now())
    }

    #[inline]
    pub fn checked_add(&self, duration: Duration) -> Option<Self> {
        self.0.checked_add(duration).map(Self)
    }

    #[inline]
    pub fn elapsed(&self) -> Duration {
        self.0.elapsed()
    }
}

impl PartialEq for ElapsedInstant {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl Eq for ElapsedInstant {}

impl PartialOrd for ElapsedInstant {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ElapsedInstant {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.cmp(&other.0)
    }
}

impl std::ops::Add<Duration> for ElapsedInstant {
    type Output = Self;

    fn add(self, rhs: Duration) -> Self {
        Self(self.0 + rhs)
    }
}
