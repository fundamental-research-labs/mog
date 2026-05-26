//! Local elapsed-time budget clock for solver algorithms.
//!
//! This module is intentionally package-local. It exposes only instants and
//! durations for solver budgets; semantic wall time, IDs, entropy, and host
//! runtime facts must come from caller-owned contracts.

#[cfg(not(target_arch = "wasm32"))]
pub use native::BudgetInstant;

#[cfg(target_arch = "wasm32")]
pub use wasm::BudgetInstant;

#[cfg(not(target_arch = "wasm32"))]
mod native {
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
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::time::Duration;

    #[derive(Clone, Copy, Debug)]
    pub struct BudgetInstant(f64);

    impl BudgetInstant {
        #[inline]
        pub fn now() -> Self {
            Self(js_sys::Date::now())
        }

        #[inline]
        pub fn elapsed(&self) -> Duration {
            let elapsed_ms = (js_sys::Date::now() - self.0).max(0.0);
            Duration::from_millis(elapsed_ms as u64)
        }
    }
}
