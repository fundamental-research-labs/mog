/**
 * Goal Seek Algorithm Implementation
 *
 * Implements the Goal Seek algorithm using Brent's method with bracketing,
 * with a secant method fallback for cases where bracketing fails.
 *
 * Goal Seek finds the input value `x` such that `f(x) = target`, where `f`
 * is the evaluation function (formula result given input value).
 *
 * Algorithm Strategy:
 * 1. Bracket Finding: Exponential expansion from initial guess to find interval with sign change
 * 2. Brent's Method: Primary solver when bracket found (guaranteed convergence)
 * 3. Secant Fallback: For cases where bracketing fails (discontinuous functions)
 *
 */

import type { GoalSeekParams, GoalSeekResult } from '@mog-sdk/contracts/what-if';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_PRECISION = 0.000001;
const DEFAULT_MAX_CHANGE = 0.001;

// Machine epsilon for floating point comparisons
const EPSILON = 2.220446049250313e-16;

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Goal Seek algorithm using Brent's method with bracketing.
 *
 * Brent's method combines:
 * - Secant method (fast convergence, no derivatives needed)
 * - Bisection (guaranteed convergence when bracketed)
 *
 * This is similar to what Excel uses internally.
 *
 * @param params - Goal Seek parameters
 * @returns Goal Seek result
 */
export function goalSeek(params: GoalSeekParams): GoalSeekResult {
  const {
    evaluate,
    target,
    initialGuess,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    precision = DEFAULT_PRECISION,
    maxChange = DEFAULT_MAX_CHANGE,
  } = params;

  // Special case: initial guess already satisfies the target
  const initialValue = evaluate(initialGuess);
  if (!isFinite(initialValue)) {
    return {
      found: false,
      iterations: 1,
      error: 'non_numeric',
      errorMessage: 'Formula returns non-numeric value at initial guess',
    };
  }

  if (Math.abs(initialValue - target) < precision) {
    return {
      found: true,
      solutionValue: initialGuess,
      achievedValue: initialValue,
      iterations: 1,
    };
  }

  // Try to find initial bracket [a, b] where f(a) and f(b) have opposite signs
  // This ensures a root exists in the interval (required for Brent's method)
  const bracket = findBracket(evaluate, target, initialGuess);

  if (bracket) {
    // Brent's method with the bracket
    return brentsMethod(evaluate, target, bracket.a, bracket.b, maxIterations, precision);
  }

  // Fallback: Secant method without bracket
  // This is less robust but works for cases where bracketing fails
  return secantMethod(evaluate, target, initialGuess, maxIterations, precision, maxChange);
}

// =============================================================================
// Bracket Finding
// =============================================================================

/**
 * Find a bracket [a, b] such that (f(a) - target) and (f(b) - target) have opposite signs.
 * Uses exponential expansion from initial guess.
 *
 * @param evaluate - Function to evaluate
 * @param target - Target value
 * @param guess - Initial guess
 * @returns Bracket {a, b} or null if no bracket found
 */
function findBracket(
  evaluate: (x: number) => number,
  target: number,
  guess: number,
): { a: number; b: number } | null {
  // Shifted function: we want f(x) = 0
  const f = (x: number): number => evaluate(x) - target;

  // Start with a small delta based on the guess magnitude
  let delta = Math.abs(guess) * 0.1 || 0.1;

  // Evaluate at the initial guess
  const fGuess = f(guess);
  if (!isFinite(fGuess)) {
    return null;
  }

  // Try expanding in both directions with exponential growth
  for (let i = 0; i < 60; i++) {
    // Try positive direction
    const upperBound = guess + delta;
    const fUpper = f(upperBound);
    if (isFinite(fUpper)) {
      // Check for sign change (bracket found)
      if (fGuess * fUpper < 0) {
        return fGuess < fUpper ? { a: guess, b: upperBound } : { a: upperBound, b: guess };
      }
    }

    // Try negative direction
    const lowerBound = guess - delta;
    const fLower = f(lowerBound);
    if (isFinite(fLower)) {
      // Check for sign change (bracket found)
      if (fGuess * fLower < 0) {
        return fGuess < fLower ? { a: guess, b: lowerBound } : { a: lowerBound, b: guess };
      }
    }

    // Also check between upper and lower for sign change
    if (isFinite(fUpper) && isFinite(fLower)) {
      if (fUpper * fLower < 0) {
        return fUpper < fLower
          ? { a: upperBound, b: lowerBound }
          : { a: lowerBound, b: upperBound };
      }
    }

    // Exponentially increase delta
    delta *= 2;

    // Avoid extremely large deltas
    if (delta > 1e12) {
      break;
    }
  }

  return null;
}

// =============================================================================
// Brent's Method
// =============================================================================

/**
 * Brent's method - robust root finding with guaranteed convergence.
 *
 * This implementation follows the classic algorithm:
 * - Uses bisection for reliability
 * - Uses secant/inverse quadratic interpolation for speed
 * - Automatically switches between methods based on convergence behavior
 *
 * @param evaluate - Function to evaluate
 * @param target - Target value
 * @param a - One end of bracket
 * @param b - Other end of bracket
 * @param maxIterations - Maximum number of iterations
 * @param precision - Convergence precision
 * @returns Goal Seek result
 */
function brentsMethod(
  evaluate: (x: number) => number,
  target: number,
  a: number,
  b: number,
  maxIterations: number,
  precision: number,
): GoalSeekResult {
  // Shifted function: f(x) = evaluate(x) - target, we want f(x) = 0
  const f = (x: number): number => evaluate(x) - target;

  let fa = f(a);
  let fb = f(b);

  // c will be the previous best estimate
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;

  // Make sure b has the smaller |f| value
  if (Math.abs(fc) < Math.abs(fb)) {
    a = b;
    b = c;
    c = a;
    fa = fb;
    fb = fc;
    fc = fa;
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    // Check for convergence based on function value
    if (Math.abs(fb) <= precision) {
      return {
        found: true,
        solutionValue: b,
        achievedValue: evaluate(b),
        iterations: iter + 1,
      };
    }

    // Make sure the root is bracketed between b and c
    if (fa * fb > 0) {
      c = a;
      fc = fa;
      d = e = b - a;
    }

    // If c is closer to root than b, swap
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }

    // Convergence test parameters
    const tol1 = 2 * EPSILON * Math.abs(b) + precision / 2;
    const midpoint = (c - b) / 2;

    // Check for convergence based on interval size
    if (Math.abs(midpoint) <= tol1 || fb === 0) {
      return {
        found: true,
        solutionValue: b,
        achievedValue: evaluate(b),
        iterations: iter + 1,
      };
    }

    // Try interpolation
    let newStep: number;

    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      // Attempt inverse quadratic interpolation
      const s = fb / fa;

      let p: number;
      let q: number;

      if (a === c) {
        // Linear interpolation (secant method)
        p = 2 * midpoint * s;
        q = 1 - s;
      } else {
        // Inverse quadratic interpolation
        const r = fb / fc;
        const t = fa / fc;
        p = s * (2 * midpoint * t * (t - r) - (b - a) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }

      // Ensure p is positive
      if (p > 0) {
        q = -q;
      } else {
        p = -p;
      }

      // Check if interpolation is acceptable
      const bound1 = 3 * midpoint * q - Math.abs(tol1 * q);
      const bound2 = Math.abs(e * q);

      if (2 * p < Math.min(bound1, bound2)) {
        // Accept interpolation
        e = d;
        d = p / q;
        newStep = d;
      } else {
        // Reject interpolation, use bisection
        d = midpoint;
        e = d;
        newStep = midpoint;
      }
    } else {
      // Use bisection
      d = midpoint;
      e = d;
      newStep = midpoint;
    }

    // Save the previous approximation
    a = b;
    fa = fb;

    // Compute new approximation
    if (Math.abs(newStep) > tol1) {
      b = b + newStep;
    } else {
      // Ensure minimum step size
      b = b + (midpoint > 0 ? tol1 : -tol1);
    }

    fb = f(b);
    if (!isFinite(fb)) {
      return {
        found: false,
        solutionValue: a,
        achievedValue: evaluate(a),
        iterations: iter + 1,
        error: 'non_numeric',
        errorMessage: 'Formula returns non-numeric value during iteration',
      };
    }
  }

  // Max iterations reached
  const finalValue = evaluate(b);
  const isCloseEnough = Math.abs(finalValue - target) < precision * 100;

  return {
    found: isCloseEnough,
    solutionValue: b,
    achievedValue: finalValue,
    iterations: maxIterations,
    error: isCloseEnough ? undefined : 'max_iterations',
    errorMessage: isCloseEnough
      ? undefined
      : `Maximum iterations (${maxIterations}) reached. Best solution found with error ${Math.abs(finalValue - target).toExponential(2)}`,
  };
}

// =============================================================================
// Secant Method (Fallback)
// =============================================================================

/**
 * Secant method - fallback when bracketing fails.
 * Uses two points to approximate the derivative and find the next iterate.
 *
 * @param evaluate - Function to evaluate
 * @param target - Target value
 * @param guess - Initial guess
 * @param maxIterations - Maximum number of iterations
 * @param precision - Convergence precision
 * @param maxChange - Maximum relative change for convergence check
 * @returns Goal Seek result
 */
function secantMethod(
  evaluate: (x: number) => number,
  target: number,
  guess: number,
  maxIterations: number,
  precision: number,
  maxChange: number,
): GoalSeekResult {
  // Shifted function: we want f(x) = evaluate(x) - target = 0
  const f = (x: number): number => evaluate(x) - target;

  // Initial two points
  let x0 = guess;
  let x1 = guess === 0 ? 0.1 : guess * 1.1;

  let f0 = f(x0);
  let f1 = f(x1);

  // Check if either initial point is already a solution
  if (Math.abs(f0) < precision) {
    return {
      found: true,
      solutionValue: x0,
      achievedValue: evaluate(x0),
      iterations: 1,
    };
  }
  if (Math.abs(f1) < precision) {
    return {
      found: true,
      solutionValue: x1,
      achievedValue: evaluate(x1),
      iterations: 1,
    };
  }

  // Track best solution found
  let bestX = Math.abs(f0) < Math.abs(f1) ? x0 : x1;
  let bestF = Math.min(Math.abs(f0), Math.abs(f1));
  let prevBestF = Infinity;
  let stagnationCount = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Check for non-numeric values
    if (!isFinite(f0) || !isFinite(f1)) {
      return {
        found: false,
        solutionValue: bestX,
        achievedValue: evaluate(bestX),
        iterations: iter + 1,
        error: 'non_numeric',
        errorMessage: 'Formula returns non-numeric value during iteration',
      };
    }

    // Check for convergence
    if (Math.abs(f1) < precision) {
      return {
        found: true,
        solutionValue: x1,
        achievedValue: evaluate(x1),
        iterations: iter + 1,
      };
    }

    // Check for relative change convergence
    if (x1 !== 0 && Math.abs((x1 - x0) / x1) < maxChange && Math.abs(f1) < precision * 100) {
      return {
        found: true,
        solutionValue: x1,
        achievedValue: evaluate(x1),
        iterations: iter + 1,
      };
    }

    // Calculate secant step
    const denominator = f1 - f0;
    if (Math.abs(denominator) < EPSILON) {
      // Function is nearly flat - try a perturbation
      x0 = x1;
      f0 = f1;
      x1 = x1 + (Math.abs(x1) * 0.1 || 0.1);
      f1 = f(x1);
      continue;
    }

    // Secant formula: x2 = x1 - f1 * (x1 - x0) / (f1 - f0)
    const x2 = x1 - (f1 * (x1 - x0)) / denominator;

    // Limit step size to prevent divergence
    const maxStep = Math.abs(x1) * 10 || 100;
    let clampedX2 = x2;
    if (Math.abs(x2 - x1) > maxStep) {
      clampedX2 = x1 + Math.sign(x2 - x1) * maxStep;
    }

    // Update for next iteration
    x0 = x1;
    f0 = f1;
    x1 = clampedX2;
    f1 = f(x1);

    // Track best solution
    if (Math.abs(f1) < bestF) {
      bestX = x1;
      bestF = Math.abs(f1);
    }

    // Check for divergence (stagnation detection)
    if (Math.abs(bestF - prevBestF) < precision * 0.01) {
      stagnationCount++;
      if (stagnationCount > 10) {
        // Not making progress - return best found
        const finalValue = evaluate(bestX);
        const isCloseEnough = Math.abs(finalValue - target) < precision * 1000;
        return {
          found: isCloseEnough,
          solutionValue: bestX,
          achievedValue: finalValue,
          iterations: iter + 1,
          error: isCloseEnough ? undefined : 'diverged',
          errorMessage: isCloseEnough
            ? undefined
            : 'Algorithm stagnated - function may have no solution or multiple solutions',
        };
      }
    } else {
      stagnationCount = 0;
    }
    prevBestF = bestF;
  }

  // Max iterations reached
  const finalValue = evaluate(bestX);
  const isCloseEnough = Math.abs(finalValue - target) < precision * 100;

  return {
    found: isCloseEnough,
    solutionValue: bestX,
    achievedValue: finalValue,
    iterations: maxIterations,
    error: isCloseEnough ? undefined : 'max_iterations',
    errorMessage: isCloseEnough
      ? undefined
      : `Maximum iterations (${maxIterations}) reached. Best solution found with error ${Math.abs(finalValue - target).toExponential(2)}`,
  };
}
