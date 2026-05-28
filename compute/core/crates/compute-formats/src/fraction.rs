//! Fraction formatting for Excel fraction format codes.

use crate::types::{FormatSection, Token, is_digit_placeholder};

/// Format a number as a fraction, e.g. `# ?/?` or `# ??/??`.
#[allow(clippy::too_many_lines)] // fraction layout logic is inherently verbose
pub(crate) fn format_fraction(value: f64, section: &FormatSection, section_count: usize) -> String {
    let is_negative = value < 0.0;
    let val = value.abs();

    let integer_part = val.trunc() as u64;
    let frac_part = val - val.trunc();

    // Count integer placeholders before FractionSlash (before the digit placeholders that precede '/')
    // and denominator placeholders after FractionSlash.
    //
    // Token structure: [int_placeholders] FractionSlash [denom_placeholders]
    // But there may also be numerator placeholders between the integer part and the slash.
    // Typical patterns:
    //   # ?/?     -> int=# , num=?, denom=?
    //   # ??/??   -> int=#, num=??, denom=??
    //   ?/?       -> no int, num=?, denom=?
    //   0 0/0     -> int=0, num=0, denom=0

    // Find the FractionSlash position.
    // Safety: callers in lib.rs gate on FractionSlash presence before calling this function,
    // so the token is guaranteed to exist. We still handle the missing case defensively.
    let Some(slash_pos) = section
        .tokens
        .iter()
        .position(|t| matches!(t, Token::FractionSlash))
    else {
        return String::new();
    };

    // Count numerator placeholders: digit placeholders immediately before FractionSlash
    let mut num_placeholders = 0usize;
    for tok in section.tokens[..slash_pos].iter().rev() {
        if is_digit_placeholder(tok) {
            num_placeholders += 1;
        } else {
            break;
        }
    }

    let fixed_denominator = section.tokens[slash_pos + 1..].first().and_then(|token| {
        if let Token::FractionDenominatorLiteral(value) = token {
            value
                .parse::<u64>()
                .ok()
                .filter(|denominator| *denominator > 0)
        } else {
            None
        }
    });
    let fixed_denominator_text = section.tokens[slash_pos + 1..].first().and_then(|token| {
        if let Token::FractionDenominatorLiteral(value) = token {
            Some(value.as_str())
        } else {
            None
        }
    });

    // Count denominator placeholders: digit placeholders immediately after FractionSlash,
    // or the literal width for fixed-denominator fraction formats.
    let mut denom_placeholders = 0usize;
    if let Some(denominator_text) = fixed_denominator_text {
        denom_placeholders = denominator_text.len();
    } else {
        for tok in &section.tokens[slash_pos + 1..] {
            if is_digit_placeholder(tok) {
                denom_placeholders += 1;
            } else {
                break;
            }
        }
    }

    // Count integer placeholders: placeholders before the numerator group
    let int_placeholder_end = slash_pos - num_placeholders;
    let has_int_part = section.tokens[..int_placeholder_end]
        .iter()
        .any(is_digit_placeholder);

    let (best_num, best_denom, carry_fraction) = if let Some(fixed_denominator) = fixed_denominator
    {
        if frac_part < 1e-12 {
            (0u64, fixed_denominator, false)
        } else {
            let rounded_num = (frac_part * fixed_denominator as f64).round() as u64;
            if rounded_num >= fixed_denominator {
                (0, fixed_denominator, true)
            } else {
                (rounded_num, fixed_denominator, false)
            }
        }
    } else {
        // Max denominator based on placeholder count.
        // Cap at 9 digits — the continued-fractions algorithm is O(log max_denom),
        // so even 999_999_999 terminates in ~30 iterations.
        let capped_denom_digits = denom_placeholders.min(9) as u32;
        let max_denom = 10u64.pow(capped_denom_digits) - 1;
        let max_denom = max_denom.max(1);

        // Find best rational approximation via continued fractions (Stern-Brocot tree)
        if frac_part < 1e-12 {
            (0u64, 1u64, false)
        } else {
            let (n, d) = best_rational_approximation(frac_part, max_denom);
            // If numerator equals denominator, add to integer and set fraction to 0
            if n >= d { (0, 1, true) } else { (n, d, false) }
        }
    };

    // Adjust integer if numerator rounded up to denominator
    let display_int = integer_part + u64::from(carry_fraction);

    let needs_minus = is_negative && (display_int > 0 || best_num > 0) && section_count <= 1;

    let mut result = String::new();
    if needs_minus {
        result.push('-');
    }

    // Walk the tokens and emit
    let num_str = format!("{best_num}");
    let denom_str = format!("{best_denom}");

    // Build integer display
    let int_str = format!("{display_int}");

    let mut in_denom_zone = false;
    let mut int_emitted = false;
    let mut num_emitted = false;
    let mut denom_emitted = false;

    // We need to identify zones: before numerator = integer, numerator, slash, denominator
    let num_start = int_placeholder_end;

    for (idx, tok) in section.tokens.iter().enumerate() {
        if idx == slash_pos {
            // Emit numerator if not yet
            if !num_emitted {
                // Excel parity (per the test fixture
                // dev/app-eval/scenarios/formatting-deep/number-format-fraction.spec.ts):
                // when the numerator has actual digits we emit just those digits,
                // letting the literal separator before the fraction zone (the
                // space in `# ??/??`) and the slash itself provide visual
                // alignment. Padding the numerator to `num_placeholders` chars
                // here would compose with that literal space and produce
                // doubled inter-column spaces (e.g. `1  5/8` instead of
                // `1 5/8`). When the numerator is zero AND there is an integer
                // part, we still emit blanks of the placeholder width so the
                // fraction zone collapses to whitespace as Excel does for
                // whole-number values.
                let block = if best_num == 0 {
                    if has_int_part {
                        " ".repeat(num_placeholders)
                    } else {
                        "0".to_string()
                    }
                } else {
                    num_str.clone()
                };
                result.push_str(&block);
                num_emitted = true;
            }
            result.push('/');
            in_denom_zone = true;
            continue;
        }

        if idx >= num_start && idx < slash_pos && is_digit_placeholder(tok) {
            // Skip — we'll emit the numerator as a block at the slash
            continue;
        }

        if in_denom_zone
            && (is_digit_placeholder(tok) || matches!(tok, Token::FractionDenominatorLiteral(_)))
        {
            if !denom_emitted {
                if best_num == 0 {
                    if let Some(denominator_text) = fixed_denominator_text {
                        result.push_str(denominator_text);
                    } else {
                        // No fraction — blank the denominator zone so a whole
                        // number renders the trailing fraction columns as space.
                        result.push_str(&" ".repeat(denom_placeholders));
                    }
                } else {
                    // Emit denominator digits without right-padding for the
                    // same Excel-parity reason as the numerator block above.
                    result.push_str(&denom_str);
                }
                denom_emitted = true;
            }
            continue;
        }

        if !in_denom_zone && idx < num_start && is_digit_placeholder(tok) {
            // Integer zone
            if !int_emitted {
                if has_int_part {
                    if display_int == 0 && matches!(tok, Token::Hash) {
                        // # suppresses zero integer
                        let int_ph_count = section.tokens[..num_start]
                            .iter()
                            .filter(|t| is_digit_placeholder(t))
                            .count();
                        result.push_str(&" ".repeat(int_ph_count));
                    } else {
                        result.push_str(&int_str);
                    }
                }
                int_emitted = true;
            }
            continue;
        }

        match tok {
            Token::Literal(s) => result.push_str(s),
            Token::SkipWidth(_) => result.push(' '),
            Token::Percent => result.push('%'),
            _ => {}
        }
    }

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
