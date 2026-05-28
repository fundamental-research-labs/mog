//! Shared result validators for dispatch tests.

use crate::types::{SolverConfig, SolverResult, TerminationReason};

pub(super) fn assert_result_invariants(result: &SolverResult, config: &SolverConfig, label: &str) {
    // Dimensionality preserved
    assert_eq!(
        result.x.len(),
        config.x0.len(),
        "{}: result.x.len()={} != x0.len()={}",
        label,
        result.x.len(),
        config.x0.len()
    );
    // At least one function evaluation
    assert!(
        result.evals > 0,
        "{}: evals must be > 0, got {}",
        label,
        result.evals
    );
    // Message is non-empty
    assert!(
        !result.message.is_empty(),
        "{}: message must be non-empty",
        label
    );
    // If converged, termination must be Converged
    if result.converged {
        assert_eq!(
            result.termination,
            TerminationReason::Converged,
            "{}: converged but termination={:?}",
            label,
            result.termination
        );
    }
}
