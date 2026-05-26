//! Opt-in XLSX import/export phase profiling.
//!
//! Disabled by default. Set `MOG_XLSX_ROUNDTRIP_PROFILE=1` to emit concise JSON
//! lines to stderr for production L2 import/export phases.

use std::sync::OnceLock;

use crate::time_compat::WasmSafeInstant;

const ENV_VAR: &str = "MOG_XLSX_ROUNDTRIP_PROFILE";

static ENABLED: OnceLock<bool> = OnceLock::new();

#[inline]
pub(crate) fn enabled() -> bool {
    *ENABLED.get_or_init(|| {
        std::env::var(ENV_VAR)
            .map(|value| {
                let normalized = value.trim().to_ascii_lowercase();
                matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
            })
            .unwrap_or(false)
    })
}

#[must_use]
pub(crate) struct PhaseTimer {
    operation: &'static str,
    phase: &'static str,
    start: Option<WasmSafeInstant>,
    counters: Vec<(&'static str, u64)>,
}

impl PhaseTimer {
    #[inline]
    pub(crate) fn new(operation: &'static str, phase: &'static str) -> Self {
        Self {
            operation,
            phase,
            start: enabled().then(WasmSafeInstant::now),
            counters: Vec::new(),
        }
    }

    #[inline]
    pub(crate) fn counter(&mut self, name: &'static str, value: impl Into<u64>) {
        if self.start.is_some() {
            self.counters.push((name, value.into()));
        }
    }
}

impl Drop for PhaseTimer {
    fn drop(&mut self) {
        let Some(start) = self.start else {
            return;
        };

        let elapsed = start.elapsed();
        let mut payload = serde_json::Map::new();
        payload.insert(
            "target".to_string(),
            serde_json::Value::String("mog_xlsx_roundtrip_profile".to_string()),
        );
        payload.insert(
            "operation".to_string(),
            serde_json::Value::String(self.operation.to_string()),
        );
        payload.insert(
            "phase".to_string(),
            serde_json::Value::String(self.phase.to_string()),
        );
        payload.insert(
            "elapsed_ms".to_string(),
            serde_json::Value::Number(serde_json::Number::from(elapsed.as_millis() as u64)),
        );

        if !self.counters.is_empty() {
            let mut counters = serde_json::Map::new();
            for (name, value) in &self.counters {
                counters.insert(
                    (*name).to_string(),
                    serde_json::Value::Number(serde_json::Number::from(*value)),
                );
            }
            payload.insert("counters".to_string(), serde_json::Value::Object(counters));
        }

        eprintln!("{}", serde_json::Value::Object(payload));
    }
}
