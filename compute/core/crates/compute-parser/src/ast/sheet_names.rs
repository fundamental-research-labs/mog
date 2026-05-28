/// Whether a sheet name needs single-quote quoting in formulas.
///
/// Returns `true` if a sheet name requires single-quote delimiters in A1 notation.
/// A name needs quoting if it:
/// - Is empty
/// - Starts with a digit
/// - Starts with a non-alphabetic, non-underscore character
/// - Contains any character that is not alphanumeric or underscore
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
    rest.bytes()
        .any(|b| !b.is_ascii_alphanumeric() && b != b'_')
}
