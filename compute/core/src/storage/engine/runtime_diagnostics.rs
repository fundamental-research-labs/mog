use std::collections::VecDeque;

use crate::snapshot::{
    RuntimeDiagnosticsOptions, RuntimeDiagnosticsPage, RuntimeOperationDiagnostic,
};

const RUNTIME_DIAGNOSTIC_RETENTION: usize = 1024;

#[derive(Debug, Default)]
pub(crate) struct RuntimeDiagnosticsStore {
    diagnostics: VecDeque<RuntimeOperationDiagnostic>,
    evicted: bool,
}

impl RuntimeDiagnosticsStore {
    pub(crate) fn record(&mut self, diagnostics: &[RuntimeOperationDiagnostic]) {
        if diagnostics.is_empty() {
            return;
        }
        self.diagnostics.extend(diagnostics.iter().cloned());
        while self.diagnostics.len() > RUNTIME_DIAGNOSTIC_RETENTION {
            self.diagnostics.pop_front();
            self.evicted = true;
        }
    }

    pub(crate) fn page(&self, options: RuntimeDiagnosticsOptions) -> RuntimeDiagnosticsPage {
        let limit = normalize_limit(options.limit);
        let since = options.since_sequence.as_deref().and_then(parse_sequence);
        let first_retained = self
            .diagnostics
            .front()
            .and_then(|diagnostic| parse_sequence(&diagnostic.sequence));
        let diagnostics: Vec<_> = self
            .diagnostics
            .iter()
            .filter(|diagnostic| {
                since
                    .map(|since| {
                        parse_sequence(&diagnostic.sequence)
                            .map(|sequence| sequence > since)
                            .unwrap_or(false)
                    })
                    .unwrap_or(true)
            })
            .take(limit)
            .cloned()
            .collect();
        let next_sequence = diagnostics
            .last()
            .map(|diagnostic| diagnostic.sequence.clone());
        let truncated = self.evicted
            && since
                .map(|since| {
                    first_retained
                        .map(|first_retained| since < first_retained)
                        .unwrap_or(true)
                })
                .unwrap_or(true);

        RuntimeDiagnosticsPage {
            diagnostics,
            next_sequence,
            truncated,
        }
    }
}

fn normalize_limit(limit: Option<u32>) -> usize {
    limit
        .map(|limit| limit.min(RUNTIME_DIAGNOSTIC_RETENTION as u32) as usize)
        .unwrap_or(RUNTIME_DIAGNOSTIC_RETENTION)
}

fn parse_sequence(sequence: &str) -> Option<u128> {
    sequence.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagnostic(sequence: u128) -> RuntimeOperationDiagnostic {
        RuntimeOperationDiagnostic {
            id: format!("runtime-diagnostic-{sequence}"),
            sequence: sequence.to_string(),
            code: "unsupported_filter_reapply".to_string(),
            severity: "warning".to_string(),
            recoverability: "unsupported_preserved".to_string(),
            operation: "applyFilter".to_string(),
            sheet_id: "sheet-1".to_string(),
            filter_id: Some("filter-1".to_string()),
            filter_kind: Some("autoFilter".to_string()),
            table_id: None,
            reason: Some("iconFilterUnsupported".to_string()),
            reasons: vec!["iconFilterUnsupported".to_string()],
            details: None,
            location: None,
        }
    }

    #[test]
    fn pages_diagnostics_after_since_sequence() {
        let mut store = RuntimeDiagnosticsStore::default();
        store.record(&[diagnostic(1), diagnostic(2), diagnostic(3)]);

        let page = store.page(RuntimeDiagnosticsOptions {
            since_sequence: Some("1".to_string()),
            limit: Some(1),
        });

        assert_eq!(page.diagnostics.len(), 1);
        assert_eq!(page.diagnostics[0].sequence, "2");
        assert_eq!(page.next_sequence.as_deref(), Some("2"));
        assert!(!page.truncated);
    }

    #[test]
    fn reports_truncation_when_since_sequence_predates_retention_window() {
        let mut store = RuntimeDiagnosticsStore::default();
        let diagnostics: Vec<_> = (1..=1030).map(diagnostic).collect();
        store.record(&diagnostics);

        let page = store.page(RuntimeDiagnosticsOptions {
            since_sequence: Some("1".to_string()),
            limit: Some(1),
        });

        assert_eq!(page.diagnostics.len(), 1);
        assert_eq!(page.diagnostics[0].sequence, "7");
        assert!(page.truncated);
    }
}
