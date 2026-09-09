//! Fraction formatting for Excel fraction format codes.

use crate::types::{FormatSection, Token, is_digit_placeholder};

fn literals(tokens: &[Token]) -> String {
    tokens
        .iter()
        .map(|t| match t {
            Token::Literal(s) | Token::FractionDenominatorLiteral(s) => s.clone(),
            Token::SkipWidth(_) => " ".into(),
            Token::Percent => "%".into(),
            Token::FractionSlash => "/".into(),
            _ => String::new(),
        })
        .collect()
}

/// Right-align a digit field while retaining literals between placeholders.
/// Unlike padding one combined string, this preserves formats such as #-#-#.
fn digit_field(tokens: &[Token], value: u64, suppress_zero: bool) -> String {
    let digits = if value == 0 && suppress_zero {
        String::new()
    } else {
        value.to_string()
    };
    let mut remaining = digits.len();
    let first = tokens.iter().position(is_digit_placeholder);
    let mut output = vec![String::new(); tokens.len()];
    for (i, token) in tokens.iter().enumerate().rev() {
        if is_digit_placeholder(token) {
            if remaining > 0 {
                remaining -= 1;
                output[i].push(digits.as_bytes()[remaining] as char);
            } else {
                match token {
                    Token::Zero => output[i].push('0'),
                    Token::Question => output[i].push(' '),
                    _ => {}
                }
            }
            if Some(i) == first && remaining > 0 {
                output[i].insert_str(0, &digits[..remaining]);
            }
        } else {
            output[i] = literals(std::slice::from_ref(token));
        }
    }
    output.concat()
}

/// Separate integer, numerator, separator and denominator fields before
/// rendering. Literal characters may occur on either side of the slash.
#[allow(clippy::too_many_lines)]
pub(crate) fn format_fraction(value: f64, section: &FormatSection, section_count: usize) -> String {
    let tokens = &section.tokens;
    let Some(slash) = tokens
        .iter()
        .position(|t| matches!(t, Token::FractionSlash))
    else {
        return String::new();
    };
    let Some(num_last) = tokens[..slash].iter().rposition(is_digit_placeholder) else {
        return String::new();
    };
    let mut num_start = num_last;
    while num_start > 0 && is_digit_placeholder(&tokens[num_start - 1]) {
        num_start -= 1;
    }
    let Some(denom_start) = (slash + 1..tokens.len()).find(|&i| {
        is_digit_placeholder(&tokens[i])
            || matches!(tokens[i], Token::FractionDenominatorLiteral(_))
    }) else {
        return String::new();
    };
    let mut denom_end = denom_start + 1;
    while denom_end < tokens.len() && is_digit_placeholder(&tokens[denom_end]) {
        denom_end += 1;
    }
    let int_last = tokens[..num_start].iter().rposition(is_digit_placeholder);
    let int_end = int_last.map_or(num_start, |i| i + 1);
    let numerator_tokens = &tokens[num_start..=num_last];
    let denominator_tokens = &tokens[denom_start..denom_end];
    let fixed_denominator = match &tokens[denom_start] {
        Token::FractionDenominatorLiteral(s) => s.parse::<u64>().ok(),
        _ => None,
    };
    let val = value.abs() * 100f64.powi(section.percent_count as i32)
        / 1000f64.powi(section.scale_divisors as i32);
    let mut whole = val.trunc() as u64;
    let fractional = val.fract();
    let (mut numerator, denominator) = if let Some(denominator) = fixed_denominator {
        (
            (fractional * denominator as f64).round() as u64,
            denominator,
        )
    } else {
        best_rational_approximation(
            fractional,
            (10u64.pow(denominator_tokens.len().min(9) as u32) - 1).max(1),
        )
    };
    if numerator >= denominator {
        whole += 1;
        numerator = 0;
    }
    if int_last.is_none() {
        numerator += whole * denominator;
    }

    let force_fraction =
        int_last.is_none() || numerator_tokens.iter().any(|t| matches!(t, Token::Zero));
    let show_fraction = numerator != 0 || force_fraction;
    let has_question = tokens[..denom_end]
        .iter()
        .any(|t| matches!(t, Token::Question));
    let mut result = if value < 0.0 && (whole != 0 || numerator != 0) && section_count <= 1 {
        "-".to_string()
    } else {
        String::new()
    };
    if int_last.is_some() {
        if show_fraction {
            let force_integer_zero = numerator == 0
                && tokens[..int_end]
                    .iter()
                    .any(|t| matches!(t, Token::Zero | Token::Question));
            let integer = digit_field(&tokens[..int_end], whole, whole == 0 && !force_integer_zero);
            result.push_str(&integer);
            if whole > 0
                || force_integer_zero
                || tokens[..int_end].iter().any(|t| matches!(t, Token::Zero))
            {
                result.push_str(&literals(&tokens[int_end..num_start]));
            } else if tokens[..num_start]
                .iter()
                .any(|t| matches!(t, Token::Question))
                || numerator_tokens
                    .iter()
                    .any(|t| matches!(t, Token::Question))
            {
                result.push_str(&" ".repeat(literals(&tokens[int_end..num_start]).chars().count()));
            }
        } else {
            // A missing fractional part collapses the integer field to its
            // significant digits, but ? retains the width of the whole fraction.
            let mut int_tokens = tokens[..int_end].to_vec();
            for t in &mut int_tokens {
                if matches!(t, Token::Zero | Token::Question) {
                    *t = Token::Hash;
                }
            }
            result.push_str(&digit_field(&int_tokens, whole, false));
        }
    } else {
        result.push_str(&literals(&tokens[..num_start]));
    }

    if show_fraction {
        result.push_str(&digit_field(numerator_tokens, numerator, false));
        result.push_str(&literals(&tokens[num_last + 1..denom_start]));
        if let Some(denominator) = fixed_denominator {
            result.push_str(&denominator.to_string());
        } else {
            let field = digit_field(denominator_tokens, denominator, false);
            // Fraction denominators align to the left of their ? padding;
            // numerators align to the right so the slash remains aligned.
            let padding = field.len() - field.trim_start_matches(' ').len();
            result.push_str(field.trim_start_matches(' '));
            result.push_str(&" ".repeat(padding));
        }
    } else if has_question {
        let width = tokens[int_end..denom_end]
            .iter()
            .map(|t| {
                if is_digit_placeholder(t) {
                    1
                } else {
                    literals(std::slice::from_ref(t)).chars().count()
                }
            })
            .sum();
        result.push_str(&" ".repeat(width));
    }
    result.push_str(&literals(&tokens[denom_end..]));
    result
}

/// Find the best rational approximation p/q to `x` (where 0 < x < 1) with q <= `max_denom`.
/// Uses the Stern-Brocot tree with semi-convergent acceleration: `O(log(max_denom))`.
///
/// Reference: Stern-Brocot tree / mediants with skip-counting (Knuth TAOCP 4A §7.2.1.3).
fn best_rational_approximation(x: f64, max_denom: u64) -> (u64, u64) {
    if x < 1e-12 {
        return (0, 1);
    }
    if (x - 1.0).abs() < 1e-12 {
        return (1, 1);
    }

    // lo < x < hi as Stern-Brocot bounds
    let mut lo_n: u64 = 0;
    let mut lo_d: u64 = 1;
    let mut hi_n: u64 = 1;
    let mut hi_d: u64 = 1;

    loop {
        let med_n = lo_n + hi_n;
        let med_d = lo_d + hi_d;

        if med_d > max_denom {
            break;
        }

        // Compare mediant with x using cross-multiplication to avoid division:
        // med_n/med_d vs x  <=>  med_n vs x * med_d
        let cmp_val = med_n as f64 - x * med_d as f64;

        if cmp_val.abs() < 1e-12 * med_d as f64 {
            // Exact match
            return (med_n, med_d);
        } else if cmp_val < 0.0 {
            // mediant < x, move lo bound up
            // Semi-convergent acceleration: compute how many steps k we can take
            // We want the largest k such that (lo_n + k*hi_n)/(lo_d + k*hi_d) < x
            // and (lo_d + k*hi_d) <= max_denom.
            // From (lo_n + k*hi_n) < x*(lo_d + k*hi_d):
            //   k < (x*lo_d - lo_n) / (hi_n - x*hi_d)
            // (hi_n - x*hi_d > 0 since hi > x)
            let numer = x * lo_d as f64 - lo_n as f64;
            let denom = hi_n as f64 - x * hi_d as f64;
            let k_from_value = if denom > 1e-15 {
                (numer / denom).floor() as u64
            } else {
                u64::MAX
            };
            let k_from_denom = (max_denom - lo_d) / hi_d;
            let k = k_from_value.min(k_from_denom).max(1);
            lo_n += k * hi_n;
            lo_d += k * hi_d;
        } else {
            // mediant > x, move hi bound down
            let numer = hi_n as f64 - x * hi_d as f64;
            let denom = x * lo_d as f64 - lo_n as f64;
            let k_from_value = if denom > 1e-15 {
                (numer / denom).floor() as u64
            } else {
                u64::MAX
            };
            let k_from_denom = (max_denom - hi_d) / lo_d;
            let k = k_from_value.min(k_from_denom).max(1);
            hi_n += k * lo_n;
            hi_d += k * lo_d;
        }
    }

    // Can't form mediant within max_denom — pick the closer of lo or hi.
    let lo_err = (x - lo_n as f64 / lo_d as f64).abs();
    let hi_err = (x - hi_n as f64 / hi_d as f64).abs();
    if hi_d <= max_denom && hi_err <= lo_err {
        (hi_n, hi_d)
    } else {
        (lo_n, lo_d)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_best_rational_pi() {
        // π - 3 ≈ 0.14159... best approx with d<=113 is 16/113
        let (n, d) = best_rational_approximation(std::f64::consts::PI - 3.0, 113);
        assert_eq!((n, d), (16, 113));
    }

    #[test]
    fn test_best_rational_third() {
        let (n, d) = best_rational_approximation(1.0 / 3.0, 99);
        assert_eq!((n, d), (1, 3));
    }

    #[test]
    fn test_best_rational_quarter() {
        let (n, d) = best_rational_approximation(0.25, 9);
        assert_eq!((n, d), (1, 4));
    }

    #[test]
    fn test_best_rational_seventh() {
        let (n, d) = best_rational_approximation(1.0 / 7.0, 99);
        assert_eq!((n, d), (1, 7));
    }

    #[test]
    fn test_best_rational_large_denom() {
        let (n, d) = best_rational_approximation(1.0 / 7.0, 999_999);
        assert_eq!((n, d), (1, 7)); // exact representation exists within bound
    }

    #[test]
    fn test_best_rational_golden_ratio() {
        // φ - 1 = 0.6180339... — hardest case for continued fractions (slowest convergence)
        let phi_frac = (5.0_f64.sqrt() - 1.0) / 2.0;
        let (n, d) = best_rational_approximation(phi_frac, 1000);
        // Best with d<=1000: 610/987 (Fibonacci ratio)
        assert_eq!(d, 987);
        assert_eq!(n, 610);
    }
}
