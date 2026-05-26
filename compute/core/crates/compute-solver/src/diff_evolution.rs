//! Differential Evolution — population-based global optimizer.
//!
//! Implements classic DE/rand/1/bin with adaptive strategy cycling and dithered F.
//! Well-suited for non-smooth, multi-modal, noisy, or black-box objective functions.
//!
//! # Algorithm
//!
//! 1. **Initialize** a population of `max(15, 10 * n)` candidate solutions via
//!    Latin Hypercube Sampling (when all bounds are finite) or Gaussian perturbation
//!    from the initial guess.
//! 2. **Mutate** using cycling strategies: `best/1/bin`, `rand/1/bin`, `current-to-best/1/bin`.
//! 3. **Crossover** via binomial crossover with CR = 0.7.
//! 4. **Select** the trial if it is at least as good as the parent.
//! 5. **Converge** when population fitness standard deviation drops below ftol,
//!    or when best fitness stagnates for 50 generations.

use crate::bounds;
use crate::harness::EvalHarness;
use crate::types::{Bound, SolverConfig, SolverResult, TerminationReason};
use rand::Rng;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

/// Crossover rate for binomial crossover.
const CR: f64 = 0.7;

/// Number of stagnation generations before termination.
const STAGNATION_LIMIT: u32 = 50;

/// Mutation strategy identifier (cycled per generation).
#[derive(Debug, Clone, Copy)]
#[allow(clippy::enum_variant_names)]
enum Strategy {
    Best1Bin,
    Rand1Bin,
    CurrentToBest1Bin,
}

impl Strategy {
    /// Cycle through strategies by generation index.
    fn from_gen(generation: u32) -> Self {
        match generation % 3 {
            0 => Strategy::Best1Bin,
            1 => Strategy::Rand1Bin,
            _ => Strategy::CurrentToBest1Bin,
        }
    }
}

/// Compute the population size: `max(15, 10 * ndim)`.
fn pop_size(ndim: usize) -> usize {
    15_usize.max(10 * ndim)
}

/// Check if all bounds are finite (both lower and upper present).
fn all_bounds_finite(bounds: &[Bound], ndim: usize) -> bool {
    if bounds.len() < ndim {
        return false;
    }
    bounds[..ndim]
        .iter()
        .all(|b| b.lower.is_some() && b.upper.is_some())
}

/// Initialize population using Latin Hypercube Sampling.
///
/// Divides each dimension into `np` equal strata, samples one point per stratum,
/// then shuffles the column assignments so each stratum-row is used exactly once
/// across dimensions.
fn init_lhs(rng: &mut ChaCha8Rng, np: usize, bounds: &[Bound], ndim: usize) -> Vec<Vec<f64>> {
    let mut pop = vec![vec![0.0; ndim]; np];

    for d in 0..ndim {
        let lo = bounds[d].lower.unwrap();
        let hi = bounds[d].upper.unwrap();

        // Create a permutation for this dimension
        let mut perm: Vec<usize> = (0..np).collect();
        // Fisher-Yates shuffle
        for i in (1..np).rev() {
            let j = rng.gen_range(0..=i);
            perm.swap(i, j);
        }

        for i in 0..np {
            let stratum = perm[i];
            // Random point within the stratum
            let u: f64 = rng.r#gen();
            let frac = (stratum as f64 + u) / np as f64;
            pop[i][d] = lo + frac * (hi - lo);
        }
    }

    pop
}

/// Initialize population using Gaussian perturbation from x0.
fn init_perturbation(
    rng: &mut ChaCha8Rng,
    np: usize,
    x0: &[f64],
    bounds: &[Bound],
) -> Vec<Vec<f64>> {
    let ndim = x0.len();
    let mut pop = Vec::with_capacity(np);

    for _ in 0..np {
        let mut individual = Vec::with_capacity(ndim);
        for val in x0.iter().take(ndim) {
            let scale = val.abs() * 0.5 + 0.1;
            // Box-Muller for standard normal
            let u1: f64 = rng.r#gen::<f64>().max(1e-300);
            let u2: f64 = rng.r#gen();
            let z = (-2.0 * u1.ln()).sqrt() * (2.0 * std::f64::consts::PI * u2).cos();
            individual.push(val + scale * z);
        }
        // Project into bounds
        bounds::project_vec(&mut individual, bounds);
        pop.push(individual);
    }

    pop
}

/// Select `count` distinct random indices from `[0, n)`, excluding indices in `exclude`.
fn distinct_indices(rng: &mut ChaCha8Rng, n: usize, count: usize, exclude: &[usize]) -> Vec<usize> {
    let mut result = Vec::with_capacity(count);
    let max_attempts = count * 100;
    let mut attempts = 0;
    while result.len() < count && attempts < max_attempts {
        let idx = rng.gen_range(0..n);
        if !exclude.contains(&idx) && !result.contains(&idx) {
            result.push(idx);
        }
        attempts += 1;
    }
    result
}

/// Create a mutant vector using the specified strategy.
#[allow(clippy::too_many_arguments)]
fn mutate(
    strategy: Strategy,
    pop: &[Vec<f64>],
    _fitness: &[f64],
    current_idx: usize,
    best_idx: usize,
    f_scale: f64,
    rng: &mut ChaCha8Rng,
    ndim: usize,
) -> Vec<f64> {
    let np = pop.len();
    let mut trial = vec![0.0; ndim];

    match strategy {
        Strategy::Best1Bin => {
            let idxs = distinct_indices(rng, np, 2, &[current_idx, best_idx]);
            let r1 = idxs[0];
            let r2 = idxs[1];
            for d in 0..ndim {
                trial[d] = pop[best_idx][d] + f_scale * (pop[r1][d] - pop[r2][d]);
            }
        }
        Strategy::Rand1Bin => {
            let idxs = distinct_indices(rng, np, 3, &[current_idx]);
            let r1 = idxs[0];
            let r2 = idxs[1];
            let r3 = idxs[2];
            for d in 0..ndim {
                trial[d] = pop[r1][d] + f_scale * (pop[r2][d] - pop[r3][d]);
            }
        }
        Strategy::CurrentToBest1Bin => {
            let idxs = distinct_indices(rng, np, 2, &[current_idx, best_idx]);
            let r1 = idxs[0];
            let r2 = idxs[1];
            for d in 0..ndim {
                trial[d] = pop[current_idx][d]
                    + f_scale * (pop[best_idx][d] - pop[current_idx][d])
                    + f_scale * (pop[r1][d] - pop[r2][d]);
            }
        }
    }

    trial
}

/// Perform binomial crossover between parent and mutant.
///
/// At least one dimension (j_rand) is always taken from the mutant to ensure
/// the trial vector differs from the parent.
fn crossover(parent: &[f64], mutant: &[f64], rng: &mut ChaCha8Rng, ndim: usize) -> Vec<f64> {
    let j_rand = rng.gen_range(0..ndim);
    let mut trial = Vec::with_capacity(ndim);
    for d in 0..ndim {
        if d == j_rand || rng.r#gen::<f64>() < CR {
            trial.push(mutant[d]);
        } else {
            trial.push(parent[d]);
        }
    }
    trial
}

/// Check population convergence: `std(fitness) <= ftol + ftol * |mean(fitness)|`.
fn is_converged(fitness: &[f64], ftol: f64) -> bool {
    // Filter out infinite fitness values for convergence check
    let finite: Vec<f64> = fitness.iter().copied().filter(|f| f.is_finite()).collect();
    if finite.len() < 2 {
        return false;
    }

    let n_finite = finite.len() as f64;
    let mean = finite.iter().sum::<f64>() / n_finite;
    let variance = finite.iter().map(|f| (f - mean).powi(2)).sum::<f64>() / n_finite;
    let std = variance.sqrt();

    std <= ftol + ftol * mean.abs()
}

/// Find the index of the best (lowest fitness) individual.
fn best_index(fitness: &[f64]) -> usize {
    let mut best = 0;
    let mut best_f = fitness[0];
    for (i, &f) in fitness.iter().enumerate().skip(1) {
        if f < best_f {
            best_f = f;
            best = i;
        }
    }
    best
}

/// Minimize `func` using Differential Evolution.
///
/// DE is a population-based global optimizer that works well on non-smooth,
/// multi-modal, and noisy landscapes. It requires bounded search domains for
/// efficient initialization (Latin Hypercube Sampling); unbounded dimensions
/// fall back to Gaussian perturbation from the initial guess.
///
/// # Parameters
///
/// - `func`: objective function `f(x) -> f64`
/// - `config`: solver configuration (bounds, tolerances, budget, seed)
///
/// # Returns
///
/// A [`SolverResult`] with the best point found and convergence information.
pub fn solve_de<F: FnMut(&[f64]) -> f64>(func: F, config: &SolverConfig) -> SolverResult {
    let ndim = config.ndim();
    assert!(ndim > 0, "solve_de: ndim must be > 0");

    let effective_bounds = config.effective_bounds();
    let np = pop_size(ndim);

    // --- RNG setup ---
    let mut rng = match config.seed {
        Some(seed) => ChaCha8Rng::seed_from_u64(seed),
        None => ChaCha8Rng::seed_from_u64(0),
    };

    // --- Harness for objective evaluation ---
    let mut harness = EvalHarness::new(
        func,
        config.objective,
        config.max_evals,
        config.max_time_ms,
        ndim,
    );

    // --- Population initialization ---
    let mut pop = if all_bounds_finite(&effective_bounds, ndim) {
        init_lhs(&mut rng, np, &effective_bounds, ndim)
    } else {
        init_perturbation(&mut rng, np, &config.x0, &effective_bounds)
    };

    // Include x0 as the first individual (replace pop[0])
    if !config.x0.is_empty() {
        let mut x0_clamped = config.x0.clone();
        bounds::project_vec(&mut x0_clamped, &effective_bounds);
        pop[0] = x0_clamped;
    }

    // Project all individuals into bounds
    for individual in &mut pop {
        bounds::project_vec(individual, &effective_bounds);
    }

    // --- Initial fitness evaluation ---
    let mut fitness = Vec::with_capacity(np);
    for individual in &pop {
        match harness.eval(individual) {
            Ok(f) => fitness.push(f),
            Err(_) => {
                // Budget exhausted during initialization
                return build_result(&harness, 0, false, TerminationReason::MaxEvaluations);
            }
        }
    }

    // --- Main DE loop ---
    let mut generation: u32 = 0;
    let mut stagnation_count: u32 = 0;
    let mut prev_best_f = fitness[best_index(&fitness)];
    let mut converged = false;
    #[allow(unused_assignments)]
    let mut termination = TerminationReason::MaxEvaluations;

    loop {
        generation += 1;

        // Adaptive dithering: F ~ U[0.5, 1.0] per generation
        let f_scale = rng.gen_range(0.5..=1.0);

        // Determine current strategy
        let strategy = Strategy::from_gen(generation);

        // Find current best index
        let bi = best_index(&fitness);

        // Trial population
        let mut new_pop = pop.clone();
        let mut new_fitness = fitness.clone();
        let mut budget_exhausted = false;

        for i in 0..np {
            // Mutation
            let mutant = mutate(strategy, &pop, &fitness, i, bi, f_scale, &mut rng, ndim);

            // Crossover
            let mut trial = crossover(&pop[i], &mutant, &mut rng, ndim);

            // Bounds enforcement
            bounds::project_vec(&mut trial, &effective_bounds);

            // Evaluate trial
            match harness.eval(&trial) {
                Ok(trial_f) => {
                    // Selection: trial replaces parent if at least as good
                    if trial_f <= fitness[i] {
                        new_pop[i] = trial;
                        new_fitness[i] = trial_f;
                    }
                }
                Err(_) => {
                    budget_exhausted = true;
                    break;
                }
            }
        }

        pop = new_pop;
        fitness = new_fitness;

        if budget_exhausted {
            termination = TerminationReason::MaxEvaluations;
            break;
        }

        // --- Convergence check ---
        if is_converged(&fitness, config.ftol) {
            converged = true;
            termination = TerminationReason::Converged;
            break;
        }

        // --- Stagnation check ---
        let current_best_f = fitness[best_index(&fitness)];
        if (current_best_f - prev_best_f).abs() < f64::EPSILON {
            stagnation_count += 1;
        } else {
            stagnation_count = 0;
        }
        prev_best_f = current_best_f;

        if stagnation_count >= STAGNATION_LIMIT {
            // Check if we're converged enough via ftol
            if is_converged(&fitness, config.ftol.max(1e-6)) {
                converged = true;
                termination = TerminationReason::Converged;
            } else {
                termination = TerminationReason::Stagnation;
            }
            break;
        }
    }

    // TODO: NM polish after NM is implemented

    build_result(&harness, generation, converged, termination)
}

/// Build a `SolverResult` from the harness's best-so-far state.
fn build_result<F: FnMut(&[f64]) -> f64>(
    harness: &EvalHarness<F>,
    iters: u32,
    converged: bool,
    termination: TerminationReason,
) -> SolverResult {
    let message = match termination {
        TerminationReason::Converged => "DE converged: population fitness spread below ftol".into(),
        TerminationReason::MaxEvaluations => {
            format!("DE stopped: max evaluations ({}) reached", harness.evals())
        }
        TerminationReason::MaxTime => {
            format!(
                "DE stopped: time limit ({}ms) reached",
                harness.elapsed_ms()
            )
        }
        TerminationReason::Stagnation => {
            format!("DE stopped: best fitness stagnated for {STAGNATION_LIMIT} generations")
        }
        TerminationReason::NumericalError => "DE stopped: numerical error".into(),
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
