use crate::types::{Objective, SolverConfig};

pub(super) const DEFAULT_PRECISION: f64 = 1e-6;

pub(super) fn root_config(target: f64, guess: f64) -> SolverConfig {
    SolverConfig {
        objective: Objective::Target(target),
        x0: vec![guess],
        max_evals: 100,
        ftol: DEFAULT_PRECISION,
        max_time_ms: 0,
        ..Default::default()
    }
}

pub(super) fn nr_config(guess: f64, ftol: f64) -> SolverConfig {
    SolverConfig {
        objective: Objective::Target(0.0),
        x0: vec![guess],
        ftol,
        xtol: 1e-14,
        max_evals: 2000,
        max_time_ms: 0,
        ..Default::default()
    }
}
