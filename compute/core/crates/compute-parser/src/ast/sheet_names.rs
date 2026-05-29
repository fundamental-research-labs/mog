/// Whether a sheet name needs single-quote quoting in formulas.
///
/// Returns `true` if a sheet name requires single-quote delimiters in A1 notation.
/// A name needs quoting if it:
/// - Is empty
/// - Starts with a digit
/// - Starts with a non-alphabetic, non-underscore character
/// - Contains any character that is not alphanumeric or underscore
/// - Looks like an A1 or R1C1 reference token
///
/// This matches Excel's quoting rules for sheet name references.
///
/// # Examples
///
/// ```
/// use compute_parser::needs_quoting;
///
/// assert!(!needs_quoting("Sheet1"));       // simple name — no quoting
/// assert!(needs_quoting("My Sheet"));      // contains space
/// assert!(needs_quoting("D&A_BUILD"));     // contains &
/// assert!(needs_quoting("RC"));            // R1C1-style token
/// assert!(needs_quoting(""));              // empty name
/// ```
#[must_use]
pub fn needs_quoting(name: &str) -> bool {
    if name.is_empty() {
        return true;
    }
    let first = name.as_bytes()[0];
    // First char must be ASCII letter or underscore.
    if first.is_ascii_digit() || (!first.is_ascii_alphabetic() && first != b'_') {
        return true;
    }
    // Remaining chars must be alphanumeric or underscore.
    // `name[1..]` — byte 0 is the verified ASCII letter/underscore above,
    // so `[1..]` is at a char boundary. `.bytes()` scans the full UTF-8
    // sequence (non-ASCII bytes will fail the ascii predicates and return
    // true, which is the correct "needs quoting" answer).
    #[allow(clippy::string_slice)]
    let rest = &name[1..];
    if rest
        .bytes()
        .any(|b| !b.is_ascii_alphanumeric() && b != b'_')
    {
        return true;
    }

    looks_like_a1_cell_ref(name) || looks_like_r1c1_ref(name)
}

fn looks_like_a1_cell_ref(name: &str) -> bool {
    let bytes = name.as_bytes();
    let mut split = 0;
    while split < bytes.len() && bytes[split].is_ascii_alphabetic() {
        split += 1;
    }
    if split == 0 || split == bytes.len() {
        return false;
    }
    if !bytes[split..].iter().all(u8::is_ascii_digit) {
        return false;
    }

    let Ok(col_letters) = std::str::from_utf8(&bytes[..split]) else {
        return false;
    };
    let Some(col) = cell_types::letter_to_col(col_letters) else {
        return false;
    };
    if col >= cell_types::MAX_COLS {
        return false;
    }

    let Ok(row_digits) = std::str::from_utf8(&bytes[split..]) else {
        return false;
    };
    let Ok(row) = row_digits.parse::<u32>() else {
        return false;
    };
    row > 0 && row <= cell_types::MAX_ROWS
}

fn looks_like_r1c1_ref(name: &str) -> bool {
    let bytes = name.as_bytes();
    match bytes {
        [b'R' | b'r' | b'C' | b'c'] | [b'R' | b'r', b'C' | b'c'] => true,
        [b'R' | b'r', rest @ ..] => {
            let Some(consumed) = consume_positive_u32_bounded(rest, cell_types::MAX_ROWS) else {
                return false;
            };
            let rest = &rest[consumed..];
            rest.is_empty()
                || matches!(rest, [b'C' | b'c'])
                || matches!(rest, [b'C' | b'c', tail @ ..] if consume_positive_u32_bounded(tail, cell_types::MAX_COLS).is_some_and(|n| n == tail.len()))
        }
        [b'C' | b'c', rest @ ..] => consume_positive_u32_bounded(rest, cell_types::MAX_COLS)
            .is_some_and(|n| n == rest.len()),
        _ => false,
    }
}

fn consume_positive_u32_bounded(bytes: &[u8], max: u32) -> Option<usize> {
    let mut value = 0u32;
    let mut consumed = 0usize;
    for &b in bytes {
        if !b.is_ascii_digit() {
            break;
        }
        value = value.checked_mul(10)?.checked_add(u32::from(b - b'0'))?;
        consumed += 1;
        if value > max {
            return None;
        }
    }
    (consumed > 0 && value > 0).then_some(consumed)
}
