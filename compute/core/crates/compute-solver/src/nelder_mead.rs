//! Adaptive Nelder-Mead simplex method (Gao & Han 2012).
//!
//! Derivative-free optimization using an adaptive simplex that adjusts its
//! reflection, expansion, contraction, and shrink parameters based on the
//! problem dimension.

use crate::bounds::project_vec;
use crate::harness::EvalHarness;
use crate::types::{BudgetExhausted, SolverConfig, SolverResult, TerminationReason};

pub fn solve_nelder_mead<F: FnMut(&[f64]) -> f64>(func: F, config: &SolverConfig) -> SolverResult {
    let n = config.ndim();
    assert!(n >= 1, "nelder_mead: need at least 1 variable");
    let mut harness = EvalHarness::new(
        func,
        config.objective,
        config.max_evals,
        config.max_time_ms,
        n,
    );
    let bounds = config.effective_bounds();
    let has_bounds = config.has_bounds();
    let nf = n as f64;
    let alpha: f64 = 1.0;
    let beta: f64 = 1.0 + 2.0 / nf;
    let gamma: f64 = 0.75 - 1.0 / (2.0 * nf);
    let sigma: f64 = 1.0 - 1.0 / nf;
    let nv = n + 1;
    let mut simplex: Vec<Vec<f64>> = Vec::with_capacity(nv);
    let mut fvals: Vec<f64> = Vec::with_capacity(nv);
    let mut v0 = config.x0.clone();
    if has_bounds {
        project_vec(&mut v0, &bounds);
    }
    match harness.eval(&v0) {
        Ok(f) => {
            simplex.push(v0);
            fvals.push(f);
        }
        Err(_) => return budget_result(&harness, 0),
    }
    for i in 0..n {
        let mut vi = simplex[0].clone();
        let delta = if vi[i].abs() < 1e-15 {
            0.025
        } else {
            0.05 * vi[i]
        };
        vi[i] += delta;
        if has_bounds {
            project_vec(&mut vi, &bounds);
        }
        match harness.eval(&vi) {
            Ok(f) => {
                simplex.push(vi);
                fvals.push(f);
            }
            Err(_) => return budget_result(&harness, 0),
        }
    }
    let mut iters: u32 = 0;
    let max_stagnation = 200 * n as u32;
    let mut stagnation_count: u32 = 0;
    let mut prev_best_f = fvals[0];
    sort_simplex(&mut simplex, &mut fvals);
    let termination;
    loop {
        iters += 1;
        let f_best = fvals[0];
        let f_spread = fvals
            .iter()
            .fold(0.0_f64, |acc, &fi| acc.max((fi - f_best).abs()));
        let x_spread = simplex_diameter(&simplex);
        if f_spread < config.ftol && x_spread < config.xtol {
            termination = TerminationReason::Converged;
            break;
        }
        if (f_best - prev_best_f).abs() < 1e-15 {
            stagnation_count += 1;
        } else {
            stagnation_count = 0;
        }
        prev_best_f = f_best;
        if stagnation_count >= max_stagnation {
            termination = TerminationReason::Stagnation;
            break;
        }
        let centroid = compute_centroid(&simplex, n);
        let worst_idx = nv - 1;
        let f_worst = fvals[worst_idx];
        let f_second_worst = fvals[worst_idx - 1];
        let f_best = fvals[0];
        let mut x_r = vec![0.0; n];
        for j in 0..n {
            x_r[j] = centroid[j] + alpha * (centroid[j] - simplex[worst_idx][j]);
        }
        if has_bounds {
            project_vec(&mut x_r, &bounds);
        }
        let f_r = match harness.eval(&x_r) {
            Ok(f) => f,
            Err(_) => {
                termination = TerminationReason::MaxEvaluations;
                break;
            }
        };
        if f_r < f_best {
            let mut x_e = vec![0.0; n];
            for j in 0..n {
                x_e[j] = centroid[j] + beta * (x_r[j] - centroid[j]);
            }
            if has_bounds {
                project_vec(&mut x_e, &bounds);
            }
            let f_e = match harness.eval(&x_e) {
                Ok(f) => f,
                Err(_) => {
                    termination = TerminationReason::MaxEvaluations;
                    break;
                }
            };
            if f_e < f_r {
                simplex[worst_idx] = x_e;
                fvals[worst_idx] = f_e;
            } else {
                simplex[worst_idx] = x_r;
                fvals[worst_idx] = f_r;
            }
        } else if f_r < f_second_worst {
            simplex[worst_idx] = x_r;
            fvals[worst_idx] = f_r;
        } else if f_r < f_worst {
            let mut x_c = vec![0.0; n];
            for j in 0..n {
                x_c[j] = centroid[j] + gamma * (x_r[j] - centroid[j]);
            }
            if has_bounds {
                project_vec(&mut x_c, &bounds);
            }
            let f_c = match harness.eval(&x_c) {
                Ok(f) => f,
                Err(_) => {
                    termination = TerminationReason::MaxEvaluations;
                    break;
                }
            };
            if f_c <= f_r {
                simplex[worst_idx] = x_c;
                fvals[worst_idx] = f_c;
            } else if shrink_simplex(
                &mut simplex,
                &mut fvals,
                sigma,
                has_bounds,
                &bounds,
                &mut harness,
            )
            .is_err()
            {
                termination = TerminationReason::MaxEvaluations;
                break;
            }
        } else {
            let mut x_c = vec![0.0; n];
            for j in 0..n {
                x_c[j] = centroid[j] - gamma * (centroid[j] - simplex[worst_idx][j]);
            }
            if has_bounds {
                project_vec(&mut x_c, &bounds);
            }
            let f_c = match harness.eval(&x_c) {
                Ok(f) => f,
                Err(_) => {
                    termination = TerminationReason::MaxEvaluations;
                    break;
                }
            };
            if f_c < f_worst {
                simplex[worst_idx] = x_c;
                fvals[worst_idx] = f_c;
            } else if shrink_simplex(
                &mut simplex,
                &mut fvals,
                sigma,
                has_bounds,
                &bounds,
                &mut harness,
            )
            .is_err()
            {
                termination = TerminationReason::MaxEvaluations;
                break;
            }
        }
        sort_simplex(&mut simplex, &mut fvals);
    }
    let converged = termination == TerminationReason::Converged;
    let message = match termination {
        TerminationReason::Converged => format!(
            "Converged after {} iterations ({} evals)",
            iters,
            harness.evals()
        ),
        TerminationReason::MaxEvaluations => format!(
            "Max evaluations ({}) reached after {} iterations",
            harness.evals(),
            iters
        ),
        TerminationReason::MaxTime => format!(
            "Time limit reached after {} iters ({} evals, {}ms)",
            iters,
            harness.evals(),
            harness.elapsed_ms()
        ),
        TerminationReason::Stagnation => format!(
            "Stagnation after {} iters ({} evals)",
            iters,
            harness.evals()
        ),
        TerminationReason::NumericalError => format!(
            "Numerical error after {} iters ({} evals)",
            iters,
            harness.evals()
        ),
    };
    SolverResult {
        converged,
        x: harness.best_x().to_vec(),
        fun: harness.best_raw_f(),
        evals: harness.evals(),
        iters,
        elapsed_ms: harness.elapsed_ms(),
        termination,
        message,
    }
}

fn sort_simplex(simplex: &mut [Vec<f64>], fvals: &mut [f64]) {
    let n = simplex.len();
    for i in 1..n {
        let mut j = i;
        while j > 0 && fvals[j] < fvals[j - 1] {
            fvals.swap(j, j - 1);
            simplex.swap(j, j - 1);
            j -= 1;
        }
    }
}

fn compute_centroid(simplex: &[Vec<f64>], n: usize) -> Vec<f64> {
    let ndim = simplex[0].len();
    let mut centroid = vec![0.0; ndim];
    for vertex in simplex.iter().take(n) {
        for j in 0..ndim {
            centroid[j] += vertex[j];
        }
    }
    let inv_n = 1.0 / n as f64;
    for c in centroid.iter_mut() {
        *c *= inv_n;
    }
    centroid
}

fn simplex_diameter(simplex: &[Vec<f64>]) -> f64 {
    let best = &simplex[0];
    let mut max_d = 0.0_f64;
    for v in simplex.iter().skip(1) {
        for (a, b) in v.iter().zip(best.iter()) {
            max_d = max_d.max((a - b).abs());
        }
    }
    max_d
}

fn shrink_simplex<F: FnMut(&[f64]) -> f64>(
    simplex: &mut [Vec<f64>],
    fvals: &mut [f64],
    sigma: f64,
    has_bounds: bool,
    bounds: &[crate::types::Bound],
    harness: &mut EvalHarness<F>,
) -> Result<(), BudgetExhausted> {
    let n = simplex[0].len();
    let best = simplex[0].clone();
    for i in 1..simplex.len() {
        for j in 0..n {
            simplex[i][j] = best[j] + sigma * (simplex[i][j] - best[j]);
        }
        if has_bounds {
            project_vec(&mut simplex[i], bounds);
        }
        fvals[i] = harness.eval(&simplex[i])?;
    }
    Ok(())
}

fn budget_result<F: FnMut(&[f64]) -> f64>(harness: &EvalHarness<F>, iters: u32) -> SolverResult {
    SolverResult {
        converged: false,
        x: harness.best_x().to_vec(),
        fun: harness.best_raw_f(),
        evals: harness.evals(),
        iters,
        elapsed_ms: harness.elapsed_ms(),
        termination: TerminationReason::MaxEvaluations,
        message: format!(
            "Budget exhausted during init after {} evals",
            harness.evals()
        ),
    }
}
