use std::collections::VecDeque;

use crate::snapshot::{
    RuntimeDiagnosticsOptions, RuntimeDiagnosticsPage, RuntimeOperationDiagnostic,
};

const RUNTIME_DIAGNOSTIC_RETENTION: usize = 1024;

#[derive(Debug, Default)]
pub(crate) struct RuntimeDiagnosticsStore {
    diagnostics: VecDeque<RuntimeOperationDiagnostic>,
    evicted: bool,
    next_sequence: u64,
}

impl RuntimeDiagnosticsStore {
    pub(crate) fn assign_and_record(&mut self, diagnostics: &mut [RuntimeOperationDiagnostic]) {
        if diagnostics.is_empty() {
            return;
        }
        for diagnostic in diagnostics.iter_mut() {
            self.next_sequence = self.next_sequence.saturating_add(1);
            let sequence = self.next_sequence.to_string();
            diagnostic.id = format!("runtime-diagnostic-{sequence}");
            diagnostic.sequence = sequence;
        }
        self.diagnostics.extend(diagnostics.iter().cloned());
        while self.diagnostics.len() > RUNTIME_DIAGNOSTIC_RETENTION {
            self.diagnostics.pop_front();
            self.evicted = true;
        }
    }

    pub(crate) fn clear(&mut self) {
        self.diagnostics.clear();
        self.evicted = false;
        self.next_sequence = 0;
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
        let mut diagnostics = vec![diagnostic(0), diagnostic(0), diagnostic(0)];
        store.assign_and_record(&mut diagnostics);

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
        let mut diagnostics: Vec<_> = (1..=1030).map(|_| diagnostic(0)).collect();
        store.assign_and_record(&mut diagnostics);

        let page = store.page(RuntimeDiagnosticsOptions {
            since_sequence: Some("1".to_string()),
            limit: Some(1),
        });

        assert_eq!(page.diagnostics.len(), 1);
        assert_eq!(page.diagnostics[0].sequence, "7");
        assert!(page.truncated);
    }

    #[test]
    fn clear_resets_retention_and_sequence() {
        let mut store = RuntimeDiagnosticsStore::default();
        let mut diagnostics = vec![diagnostic(0)];
        store.assign_and_record(&mut diagnostics);
        store.clear();

        let mut after_clear = vec![diagnostic(0)];
        store.assign_and_record(&mut after_clear);
        let page = store.page(RuntimeDiagnosticsOptions::default());

        assert_eq!(page.diagnostics.len(), 1);
        assert_eq!(page.diagnostics[0].sequence, "1");
        assert!(!page.truncated);
    }
}
