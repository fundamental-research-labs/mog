pub(super) fn parse_complex(s: &str) -> Option<(f64, f64, char)> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }

    // Determine suffix
    let last = s.chars().last()?;
    let suffix = if last == 'i' || last == 'j' {
        last
    } else {
        // Pure real number
        let real: f64 = s.parse().ok()?;
        return Some((real, 0.0, 'i'));
    };

    let without_suffix = &s[..s.len() - 1];

    // Pure imaginary: "i", "+i", "-i"
    if without_suffix.is_empty() || without_suffix == "+" {
        return Some((0.0, 1.0, suffix));
    }
    if without_suffix == "-" {
        return Some((0.0, -1.0, suffix));
    }

    // Try pure imaginary: "4i", "-4i", "1.5e2i", "2.5e-3i"
    // Check if there's an internal +/- that isn't part of scientific notation.
    // If no such operator exists, this is a pure imaginary number.
    {
        let bytes = without_suffix.as_bytes();
        let mut has_internal_op = false;
        for idx in 1..bytes.len() {
            let c = bytes[idx] as char;
            if c == '+' || c == '-' {
                let prev = bytes[idx - 1] as char;
                if prev != 'e' && prev != 'E' {
                    has_internal_op = true;
                    break;
                }
            }
        }
        if !has_internal_op && let Ok(im) = without_suffix.parse::<f64>() {
            return Some((0.0, im, suffix));
        }
    }

    // Complex: "3+4i" or "3-4i" -- find the last + or - that splits real and imag
    // Skip characters inside scientific notation (e+ or e-)
    let bytes = without_suffix.as_bytes();
    let mut split_pos = None;
    let mut i = without_suffix.len();
    while i > 0 {
        i -= 1;
        let c = bytes[i] as char;
        if (c == '+' || c == '-') && i > 0 {
            // Make sure this isn't part of scientific notation
            let prev = bytes[i - 1] as char;
            if prev == 'e' || prev == 'E' {
                continue;
            }
            split_pos = Some(i);
            break;
        }
    }

    let split = split_pos?;
    if split == 0 {
        return None;
    }

    let real_part = &without_suffix[..split];
    let imag_part = &without_suffix[split..];

    let real: f64 = real_part.parse().ok()?;
    let imag: f64 = if imag_part == "+" {
        1.0
    } else if imag_part == "-" {
        -1.0
    } else {
        imag_part.parse().ok()?
    };

    Some((real, imag, suffix))
}

/// Format a complex number as a string, matching Excel conventions.
pub(super) fn format_complex(re: f64, im: f64, suffix: char) -> String {
    const EPSILON: f64 = 1e-14;
    let re = if re.abs() < EPSILON { 0.0 } else { re };
    let im = if im.abs() < EPSILON { 0.0 } else { im };

    if im == 0.0 {
        return format_num(re);
    }
    if re == 0.0 {
        if im == 1.0 {
            return format!("{}", suffix);
        }
        if im == -1.0 {
            return format!("-{}", suffix);
        }
        return format!("{}{}", format_num(im), suffix);
    }
    // Both parts nonzero
    let sign = if im >= 0.0 { "+" } else { "" };
    if im == 1.0 {
        return format!("{}+{}", format_num(re), suffix);
    }
    if im == -1.0 {
        return format!("{}-{}", format_num(re), suffix);
    }
    format!("{}{}{}{}", format_num(re), sign, format_num(im), suffix)
}

/// Format a number for complex output: integers without decimals, floats as-is.
fn format_num(n: f64) -> String {
    if n == n.trunc() && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{}", n)
    }
}
