/// Format a coefficient with `precision` significant digits.
#[allow(clippy::cast_possible_truncation, clippy::cast_possible_wrap)]
pub(super) fn round_coef(value: f64, precision: usize) -> String {
    if value.abs() < 10_f64.powi(-(precision as i32)) {
        return "0".to_string();
    }
    format_significant(value, precision)
}

/// Emulate JavaScript's `Number.prototype.toPrecision(n)`.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_possible_wrap,
    clippy::cast_sign_loss
)]
pub(super) fn format_significant(value: f64, precision: usize) -> String {
    if precision == 0 || value == 0.0 {
        return "0".to_string();
    }

    let abs = value.abs();
    let exp = abs.log10().floor() as i32;
    let decimal_places = if (precision as i32) > exp + 1 {
        (precision as i32 - exp - 1) as usize
    } else {
        0
    };

    // For very small numbers use exponential notation
    if exp < -(precision as i32) {
        return format!("{:.*e}", precision.saturating_sub(1), value);
    }

    format!("{value:.decimal_places$}")
}

/// Build a polynomial equation string from coefficients.
pub(super) fn build_poly_equation(coefficients: &[f64], precision: usize) -> String {
    let mut terms = Vec::new();

    for i in (0..coefficients.len()).rev() {
        let coef = coefficients[i];
        if coef.abs() < 1e-10 {
            continue;
        }
        let coef_str = round_coef(coef.abs(), precision);
        let sign = if coef >= 0.0 { "+" } else { "-" };

        if i == 0 {
            terms.push(format!("{sign} {coef_str}"));
        } else if i == 1 {
            terms.push(format!("{sign} {coef_str}x"));
        } else {
            terms.push(format!("{sign} {coef_str}x^{i}"));
        }
    }

    if terms.is_empty() {
        return "y = 0".to_string();
    }

    let joined = terms.join(" ");
    let trimmed = joined.trim_start_matches("+ ").trim_start();
    format!("y = {trimmed}")
}
