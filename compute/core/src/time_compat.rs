//! Cross-platform elapsed-time utilities for compute-core.
//!
//! This module is intentionally local to compute-core. It exists only for
//! elapsed-time budgets and profiling; semantic wall time must be supplied by
//! callers through explicit APIs.

#[cfg(not(target_arch = "wasm32"))]
pub use native::WasmSafeInstant;

#[cfg(target_arch = "wasm32")]
pub use wasm::WasmSafeInstant;

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::time::{Duration, Instant};

    #[derive(Clone, Copy, Debug)]
    pub struct WasmSafeInstant(Instant);

    impl WasmSafeInstant {
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

    impl PartialEq for WasmSafeInstant {
        fn eq(&self, other: &Self) -> bool {
            self.0 == other.0
        }
    }

    impl Eq for WasmSafeInstant {}

    impl PartialOrd for WasmSafeInstant {
        fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
            Some(self.cmp(other))
        }
    }

    impl Ord for WasmSafeInstant {
        fn cmp(&self, other: &Self) -> std::cmp::Ordering {
            self.0.cmp(&other.0)
        }
    }

    impl std::ops::Add<Duration> for WasmSafeInstant {
        type Output = Self;

        fn add(self, rhs: Duration) -> Self {
            Self(self.0 + rhs)
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::time::Duration;

    #[derive(Clone, Copy, Debug)]
    pub struct WasmSafeInstant(f64);

    impl WasmSafeInstant {
        #[inline]
        pub fn now() -> Self {
            Self(js_sys::Date::now())
        }

        #[inline]
        pub fn checked_add(&self, duration: Duration) -> Option<Self> {
            Some(Self(self.0 + duration.as_millis() as f64))
        }

        #[inline]
        pub fn elapsed(&self) -> Duration {
            let elapsed_ms = (js_sys::Date::now() - self.0).max(0.0);
            Duration::from_millis(elapsed_ms as u64)
        }
    }

    impl PartialEq for WasmSafeInstant {
        fn eq(&self, other: &Self) -> bool {
            self.0 == other.0
        }
    }

    impl Eq for WasmSafeInstant {}

    impl PartialOrd for WasmSafeInstant {
        fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
            Some(self.cmp(other))
        }
    }

    impl Ord for WasmSafeInstant {
        fn cmp(&self, other: &Self) -> std::cmp::Ordering {
            self.0
                .partial_cmp(&other.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        }
    }

    impl std::ops::Add<Duration> for WasmSafeInstant {
        type Output = Self;

        fn add(self, rhs: Duration) -> Self {
            Self(self.0 + rhs.as_millis() as f64)
        }
    }
}
