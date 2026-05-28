/// Gaussian elimination with partial pivoting.
///
/// Solves the system Ax = b in-place.
/// Returns `None` if the matrix is singular.
#[allow(clippy::many_single_char_names, clippy::needless_range_loop)]
pub(super) fn gaussian_elimination(a: &mut [Vec<f64>], b: &mut [f64]) -> Option<Vec<f64>> {
    let n = a.len();
    if n == 0 {
        return Some(vec![]);
    }

    // Build augmented matrix [A | b]
    let mut aug: Vec<Vec<f64>> = a
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let mut r = row.clone();
            r.push(b[i]);
            r
        })
        .collect();

    // Forward elimination with partial pivoting
    for col in 0..n {
        // Find pivot row
        let mut max_row = col;
        for row in (col + 1)..n {
            if aug[row][col].abs() > aug[max_row][col].abs() {
                max_row = row;
            }
        }
        aug.swap(col, max_row);

        // Singular check
        if aug[col][col].abs() < 1e-10 {
            return None;
        }

        // Eliminate below pivot
        for row in (col + 1)..n {
            let factor = aug[row][col] / aug[col][col];
            for j in col..=n {
                aug[row][j] -= factor * aug[col][j];
            }
        }
    }

    // Back substitution
    let mut x = vec![0.0; n];
    for row in (0..n).rev() {
        let mut s = aug[row][n];
        for col in (row + 1)..n {
            s -= aug[row][col] * x[col];
        }
        if aug[row][row].abs() < 1e-10 {
            return None;
        }
        x[row] = s / aug[row][row];
    }

    Some(x)
}

/// Evaluate a polynomial with coefficients [a0, a1, ..., an] at x.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
pub(super) fn poly_eval(coefficients: &[f64], x: f64) -> f64 {
    let mut y = 0.0;
    for (i, &c) in coefficients.iter().enumerate() {
        y += c * x.powi(i as i32);
    }
    y
}
