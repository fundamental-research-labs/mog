//! Numeric formatting: the core algorithm for Excel number format codes.

use value_types::precision::excel_round_to_decimal_places;

use crate::general::format_general;
use crate::locale::CultureInfo;
use crate::types::{FormatCode, FormatSection, Token, is_digit_placeholder};

pub(crate) fn select_section(code: &FormatCode, value: f64) -> (&FormatSection, usize) {
    let n = code.sections.len();

    // Check if any section has a Condition token — if so, use conditional logic
    let has_conditions = code
        .sections
        .iter()
        .any(|sec| sec.tokens.iter().any(|t| matches!(t, Token::Condition(_))));

    if has_conditions {
        // Evaluate conditions in order; the first matching section wins.
        // A section without a condition acts as the fallback (else).
        let mut fallback: Option<&FormatSection> = None;
        for sec in &code.sections {
            if let Some(Token::Condition(cond)) =
                sec.tokens.iter().find(|t| matches!(t, Token::Condition(_)))
            {
                if evaluate_condition(cond, value) {
                    return (sec, n);
                }
            } else if fallback.is_none() {
                fallback = Some(sec);
            }
        }
        if let Some(fb) = fallback {
            return (fb, n);
        }
        // If no condition matched and no fallback, use the last section
        return (&code.sections[n - 1], n);
    }

    let s = match n {
        0 => unreachable!(),
        1 => &code.sections[0],
        2 => {
            if value < 0.0 {
                &code.sections[1]
            } else {
                &code.sections[0]
            }
        }
        // 3+ sections: positive ; negative ; zero (4th section is text, handled elsewhere)
        _ => {
            if value > 0.0 {
                &code.sections[0]
            } else if value < 0.0 {
                &code.sections[1]
            } else {
                &code.sections[2]
            }
        }
    };
    (s, n)
}

/// Parse and evaluate a condition string like `>100`, `<0`, `>=50`, `<=10`, `=0`.
pub(crate) fn evaluate_condition(cond: &str, value: f64) -> bool {
    let cond = cond.trim();
    if cond.len() < 2 {
        return false;
    }

    let (op, num_str) = if let Some(rest) = cond.strip_prefix(">=") {
        (">=", rest)
    } else if let Some(rest) = cond.strip_prefix("<=") {
        ("<=", rest)
    } else if let Some(rest) = cond.strip_prefix("<>") {
        ("<>", rest)
    } else if let Some(rest) = cond.strip_prefix('>') {
        (">", rest)
    } else if let Some(rest) = cond.strip_prefix('<') {
        ("<", rest)
    } else if let Some(rest) = cond.strip_prefix('=') {
        ("=", rest)
    } else {
        return false;
    };

    let threshold: f64 = match num_str.trim().parse() {
        Ok(v) => v,
        Err(_) => return false,
    };

    match op {
        ">" => value > threshold,
        "<" => value < threshold,
        ">=" => value >= threshold,
        "<=" => value <= threshold,
        "=" => (value - threshold).abs() < f64::EPSILON,
        "<>" => (value - threshold).abs() >= f64::EPSILON,
        _ => false,
    }
}

pub(crate) fn apply_text_section(section: &FormatSection, text: &str) -> String {
    let mut result = String::new();
    for tok in &section.tokens {
        match tok {
            Token::TextPlaceholder => result.push_str(text),
            Token::Literal(s) => result.push_str(s),
            Token::SkipWidth(_) => result.push(' '),
            _ => {}
        }
    }
    result
}

pub(crate) fn emit_literals(section: &FormatSection) -> String {
    let mut result = String::new();
    for tok in &section.tokens {
        match tok {
            Token::Literal(s) => result.push_str(s),
            Token::SkipWidth(_) => result.push(' '),
            Token::Percent => result.push('%'),
            _ => {}
        }
    }
    result
}

/// The main numeric formatter. Uses a clean two-phase approach:
/// Pass 1: Compute the raw digit string (integer + decimal parts).
/// Pass 2: Walk tokens, consuming digits from the prepared strings.
#[allow(clippy::too_many_lines)] // core algorithm, splitting would hurt readability
pub(crate) fn format_numeric(
    value: f64,
    section: &FormatSection,
    section_count: usize,
    locale: &CultureInfo,
) -> String {
    let is_negative = value < 0.0;
    let mut val = value.abs();

    // Scale divisors
    for _ in 0..section.scale_divisors {
        val /= 1000.0;
    }

    // Percent
    if section.has_percent {
        val *= 100.0;
    }

    // Scientific notation -- handled separately
    if section.has_exponent {
        return format_scientific(val, is_negative, section, locale);
    }

    // Round to the required number of decimal places using Excel semantics
    // (snap to 15 significant digits + round half away from zero)
    let dec_places = section.dec_placeholders;
    val = excel_round_to_decimal_places(val, dec_places as i32);

    // Guard against u64 overflow for extremely large values
    if !val.is_finite() || val.trunc() > u64::MAX as f64 {
        // Fall back to scientific notation for values that overflow u64
        return format_scientific(val, is_negative, section, locale);
    }

    // Split into integer and fractional digit strings
    let factor = 10f64.powi(dec_places as i32);
    let int_val = val.trunc() as u64;
    let frac_val = ((val - val.trunc()) * factor).round() as u64;

    let int_str = format!("{int_val}");
    let dec_str = if dec_places > 0 {
        format!("{frac_val:0>dec_places$}")
    } else {
        String::new()
    };

    // Determine the minimum number of integer digits to show (count of 0 before decimal).
    // 0 placeholders force a digit to display; # and ? do not force but may pad with space.
    let min_int_zeros = count_zeros_before_decimal(&section.tokens);

    // Build the integer string: pad with leading zeros only to meet 0 placeholder minimum.
    // # and ? placeholders handle their own suppression/spacing logic.
    let padded_int = if int_str.len() < min_int_zeros {
        format!("{int_str:0>min_int_zeros$}")
    } else {
        int_str.clone()
    };

    // Determine negative sign handling
    let needs_minus = is_negative && val != 0.0 && section_count <= 1;

    // Walk tokens and produce output
    let mut result = String::new();
    if needs_minus {
        result.push('-');
    }

    // ---- Pass 1: Build the formatted integer string with thousands separators ----
    //
    // Strategy: Build the complete integer digit string first, then walk the tokens.
    // The integer string is padded_int (which has min leading zeros for 0 placeholders).
    // Extra digits beyond placeholders are prepended. # placeholders suppress leading zeros.
    // ? placeholders show spaces for leading zeros.
    //
    // For thousands separators, we insert commas based on position from the right of the
    // total emitted digit run.

    let int_digits = padded_int.as_bytes();
    let dec_digits = dec_str.as_bytes();
    let int_ph_count = section.int_placeholders;

    // Separate integer and decimal placeholder token indices
    let mut int_ph_tokens: Vec<(usize, &Token)> = Vec::new(); // (token_index, token)
    {
        let mut before_dec = true;
        for (idx, tok) in section.tokens.iter().enumerate() {
            if matches!(tok, Token::DecimalPoint) {
                before_dec = false;
                continue;
            }
            if matches!(tok, Token::Exponent { .. }) {
                break;
            }
            if is_digit_placeholder(tok) && before_dec {
                int_ph_tokens.push((idx, tok));
            }
        }
    }

    // The integer digits to emit: right-aligned against placeholders.
    // If actual digits > placeholders, extra digits at front.
    // If actual digits < placeholders, leading placeholders get '0' (to be suppressed by # or spaced by ?).
    let total_emit = int_digits.len().max(int_ph_count);
    let mut int_emit: Vec<(char, &Token)> = Vec::with_capacity(total_emit);

    if int_digits.len() >= int_ph_count {
        // More actual digits than placeholders -- extra digits are emitted using the
        // leftmost placeholder's type (in practice, always shown).
        let extra = int_digits.len() - int_ph_count;
        for &digit in int_digits.iter().take(extra) {
            // These are extra leading digits -- always shown (they're significant).
            // Use Token::Zero as placeholder type (forces display).
            int_emit.push((digit as char, &Token::Zero));
        }
        for (i, (_tok_idx, tok)) in int_ph_tokens.iter().enumerate() {
            int_emit.push((int_digits[extra + i] as char, tok));
        }
    } else {
        // Fewer actual digits than placeholders -- pad with '0' on the left.
        let deficit = int_ph_count - int_digits.len();
        for (_tok_idx, tok) in int_ph_tokens.iter().take(deficit) {
            int_emit.push(('0', tok));
        }
        for (i, byte) in int_digits.iter().enumerate() {
            int_emit.push((*byte as char, int_ph_tokens[deficit + i].1));
        }
    }

    // Now resolve which digits to actually display (suppress # leading zeros, space ? leading zeros).
    let total_int_emit = int_emit.len();
    let mut int_output: Vec<Option<char>> = Vec::with_capacity(total_int_emit);
    let mut found_significant = false;

    // Check if there are any 0 placeholders -- if so, the last 0 always shows.
    // If all are # or ?, they can all be suppressed/spaced.
    let has_zero_placeholder = int_emit.iter().any(|(_, t)| matches!(t, Token::Zero));

    for (i, &(digit, tok_type)) in int_emit.iter().enumerate() {
        let is_last = i + 1 == total_int_emit;
        if found_significant || digit != '0' {
            found_significant = true;
            int_output.push(Some(digit));
        } else if is_last && has_zero_placeholder {
            // Last placeholder with a zero placeholder somewhere -- force display
            found_significant = true;
            int_output.push(Some('0'));
        } else {
            // Leading zero
            match tok_type {
                Token::Hash => int_output.push(None),          // suppress
                Token::Question => int_output.push(Some(' ')), // space
                Token::Zero => {
                    found_significant = true;
                    int_output.push(Some('0'));
                }
                _ => int_output.push(Some(digit)),
            }
        }
    }

    // Now build the final integer string with thousands separators.
    // Count total visible digits (for positioning commas).
    let visible_digits: usize = int_output
        .iter()
        .filter(|o| matches!(o, Some(c) if c.is_ascii_digit()))
        .count();

    let mut int_result = String::new();
    let mut visible_digit_idx = 0usize;
    for ch in int_output.iter().flatten() {
        int_result.push(*ch);
        if ch.is_ascii_digit() {
            visible_digit_idx += 1;
            // Insert thousands separator after this digit if appropriate
            if section.has_thousands && visible_digit_idx < visible_digits {
                let pos_from_right = visible_digits - visible_digit_idx;
                if pos_from_right.is_multiple_of(3) {
                    int_result.push_str(&locale.thousands_separator);
                }
            }
        }
    }

    // ---- Pass 2: Walk tokens and emit the final formatted string ----

    let mut in_decimal = false;
    let mut int_emitted = false; // have we already emitted the integer portion?

    // Pre-build the decimal portion, handling # trailing zero suppression.
    let dec_output: String = {
        // Collect decimal placeholders and their digit values
        let mut dec_chars: Vec<(char, &Token)> = Vec::new();
        let mut di = 0usize;
        let mut past_decimal = false;
        for tok in &section.tokens {
            if matches!(tok, Token::DecimalPoint) {
                past_decimal = true;
                continue;
            }
            if matches!(tok, Token::Exponent { .. }) {
                break;
            }
            if past_decimal && is_digit_placeholder(tok) {
                let digit = if di < dec_digits.len() {
                    dec_digits[di] as char
                } else {
                    match tok {
                        Token::Zero => '0',
                        Token::Question => ' ',
                        _ => '\0',
                    }
                };
                dec_chars.push((digit, tok));
                di += 1;
            }
        }

        // Suppress trailing zeros for # placeholders (right to left)
        let mut last_significant = dec_chars.len();
        for i in (0..dec_chars.len()).rev() {
            let (ch, tok) = dec_chars[i];
            match tok {
                Token::Hash => {
                    if ch == '0' || ch == '\0' {
                        last_significant = i;
                        continue;
                    }
                    break;
                }
                _ => break,
            }
        }

        let mut s = String::new();
        for (i, &(ch, _)) in dec_chars.iter().enumerate() {
            if i >= last_significant {
                break;
            }
            if ch != '\0' {
                s.push(ch);
            }
        }
        s
    };

    for tok in &section.tokens {
        match tok {
            t if is_digit_placeholder(t) && !in_decimal => {
                if !int_emitted {
                    result.push_str(&int_result);
                    int_emitted = true;
                }
            }
            t if is_digit_placeholder(t) && in_decimal => {
                // Already handled in dec_output -- skip individual emission
            }
            Token::DecimalPoint => {
                if !int_emitted {
                    result.push_str(&int_result);
                    int_emitted = true;
                }
                in_decimal = true;
                result.push_str(&locale.decimal_separator);
                result.push_str(&dec_output);
            }
            Token::Percent => result.push('%'),
            Token::Literal(s) => result.push_str(s),
            Token::SkipWidth(_) => result.push(' '),
            Token::TextPlaceholder => result.push_str(&format_general(value)),
            Token::FractionSlash => result.push('/'),
            Token::FractionDenominatorLiteral(s) => result.push_str(s),
            _ => {}
        }
    }

    result
}

/// Count 0 placeholders before the decimal point (these force minimum digit display).
pub(crate) fn count_zeros_before_decimal(tokens: &[Token]) -> usize {
    let mut count = 0;
    for tok in tokens {
        match tok {
            Token::DecimalPoint | Token::Exponent { .. } => break,
            Token::Zero => count += 1,
            _ => {}
        }
    }
    count
}

pub(crate) fn format_scientific(
    value: f64,
    is_negative: bool,
    section: &FormatSection,
    locale: &CultureInfo,
) -> String {
    let (mantissa, exponent) = if value == 0.0 {
        (0.0, 0i32)
    } else {
        let exp = value.log10().floor() as i32;
        let mant = value / 10f64.powi(exp);
        (mant, exp)
    };

    let dec_places = section.dec_placeholders;

    // Count exponent digit placeholders
    let mut exp_digits = 0usize;
    let mut past_exp = false;
    for tok in &section.tokens {
        if matches!(tok, Token::Exponent { .. }) {
            past_exp = true;
            continue;
        }
        if past_exp && is_digit_placeholder(tok) {
            exp_digits += 1;
        } else if past_exp {
            break;
        }
    }
    if exp_digits == 0 {
        exp_digits = 2;
    }

    let rounded = excel_round_to_decimal_places(mantissa.abs(), dec_places as i32);

    let mant_str = if dec_places > 0 {
        let s = format!("{rounded:.dec_places$}");
        if locale.decimal_separator == "." {
            s
        } else {
            s.replace('.', &locale.decimal_separator)
        }
    } else {
        format!("{}", rounded.round() as i64)
    };

    let plus_sign = section
        .tokens
        .iter()
        .any(|t| matches!(t, Token::Exponent { plus_sign: true }));
    let exp_sign = if exponent >= 0 {
        if plus_sign { "+" } else { "" }
    } else {
        "-"
    };
    let exp_str = format!("{:0>width$}", exponent.unsigned_abs(), width = exp_digits);

    let sign = if is_negative { "-" } else { "" };
    format!("{sign}{mant_str}E{exp_sign}{exp_str}")
}
