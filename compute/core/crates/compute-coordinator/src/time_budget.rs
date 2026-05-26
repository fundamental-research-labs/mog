//! Local monotonic-ish clock for coordinator TTLs.
//!
//! Coordinator locks and participant freshness are session-local elapsed-time
//! mechanics. This type cannot produce wall-clock timestamps, IDs, entropy, or
//! host/runtime facts.

#[cfg(not(target_arch = "wasm32"))]
pub use native::CoordinatorInstant;

#[cfg(target_arch = "wasm32")]
pub use wasm::CoordinatorInstant;

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::time::{Duration, Instant};

    #[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
    pub struct CoordinatorInstant(Instant);

    impl CoordinatorInstant {
        #[inline]
        pub fn now() -> Self {
            Self(Instant::now())
        }
    }

    impl std::ops::Add<Duration> for CoordinatorInstant {
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
    pub struct CoordinatorInstant(f64);

    impl CoordinatorInstant {
        #[inline]
        pub fn now() -> Self {
            Self(js_sys::Date::now())
        }
    }

    impl PartialEq for CoordinatorInstant {
        fn eq(&self, other: &Self) -> bool {
            self.0 == other.0
        }
    }

    impl Eq for CoordinatorInstant {}

    impl PartialOrd for CoordinatorInstant {
        fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
            Some(self.cmp(other))
        }
    }

    impl Ord for CoordinatorInstant {
        fn cmp(&self, other: &Self) -> std::cmp::Ordering {
            self.0
                .partial_cmp(&other.0)
                .unwrap_or(std::cmp::Ordering::Equal)
        }
    }

    impl std::ops::Add<Duration> for CoordinatorInstant {
        type Output = Self;

        fn add(self, rhs: Duration) -> Self {
            Self(self.0 + rhs.as_millis() as f64)
        }
    }
}
