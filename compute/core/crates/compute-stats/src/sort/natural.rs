use std::cmp::Ordering;

/// A chunk in natural sort: either a run of digits or a run of non-digits.
#[derive(Debug)]
enum Chunk<'a> {
    /// A run of digit characters, stored as the substring slice.
    Digits(&'a str),
    /// A run of non-digit characters, stored as the substring slice.
    Text(&'a str),
}

/// Split a string into alternating chunks of digit and non-digit runs.
/// Hand-coded char-by-char loop — no regex.
fn split_chunks(s: &str) -> Vec<Chunk<'_>> {
    let mut chunks = Vec::new();
    if s.is_empty() {
        return chunks;
    }

    let bytes = s.as_bytes();
    let mut start = 0;
    let mut in_digits = bytes[0].is_ascii_digit();

    for i in 1..bytes.len() {
        let is_digit = bytes[i].is_ascii_digit();
        if is_digit != in_digits {
            let slice = &s[start..i];
            if in_digits {
                chunks.push(Chunk::Digits(slice));
            } else {
                chunks.push(Chunk::Text(slice));
            }
            start = i;
            in_digits = is_digit;
        }
    }

    // Push the last chunk
    let slice = &s[start..];
    if in_digits {
        chunks.push(Chunk::Digits(slice));
    } else {
        chunks.push(Chunk::Text(slice));
    }

    chunks
}

/// Compare two non-negative integer strings numerically without parsing.
/// Handles arbitrarily large numbers (no i64 overflow).
/// Strips leading zeros, then compares by length (longer = bigger),
/// and if same length, compares lexicographically.
pub(super) fn compare_numeric_strings(a: &str, b: &str) -> Ordering {
    let a_trimmed = a.trim_start_matches('0');
    let b_trimmed = b.trim_start_matches('0');
    a_trimmed
        .len()
        .cmp(&b_trimmed.len())
        .then_with(|| a_trimmed.cmp(b_trimmed))
}

/// Natural sort comparator for strings containing numbers.
/// E.g., "Item 2" comes before "Item 10".
///
/// Splits strings into chunks of digits and non-digits, then compares:
/// - Digit chunks: compared numerically (no parse, handles arbitrarily large numbers)
/// - Text chunks: compared lexicographically (case-insensitive by default)
#[must_use]
pub fn natural_compare(a: &str, b: &str, case_sensitive: bool) -> Ordering {
    let str_a: std::borrow::Cow<str> = if case_sensitive {
        std::borrow::Cow::Borrowed(a)
    } else {
        std::borrow::Cow::Owned(a.to_lowercase())
    };
    let str_b: std::borrow::Cow<str> = if case_sensitive {
        std::borrow::Cow::Borrowed(b)
    } else {
        std::borrow::Cow::Owned(b.to_lowercase())
    };

    let chunks_a = split_chunks(&str_a);
    let chunks_b = split_chunks(&str_b);

    let max_len = chunks_a.len().max(chunks_b.len());

    for i in 0..max_len {
        let chunk_a = chunks_a.get(i);
        let chunk_b = chunks_b.get(i);

        match (chunk_a, chunk_b) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(ca), Some(cb)) => {
                let is_digits_a = matches!(ca, Chunk::Digits(_));
                let is_digits_b = matches!(cb, Chunk::Digits(_));

                if is_digits_a && is_digits_b {
                    let a_str = match ca {
                        Chunk::Digits(s) => *s,
                        Chunk::Text(_) => unreachable!(),
                    };
                    let b_str = match cb {
                        Chunk::Digits(s) => *s,
                        Chunk::Text(_) => unreachable!(),
                    };
                    let cmp = compare_numeric_strings(a_str, b_str);
                    if cmp != Ordering::Equal {
                        return cmp;
                    }
                } else {
                    let sa = match ca {
                        Chunk::Digits(s) | Chunk::Text(s) => *s,
                    };
                    let sb = match cb {
                        Chunk::Digits(s) | Chunk::Text(s) => *s,
                    };
                    let cmp = sa.cmp(sb);
                    if cmp != Ordering::Equal {
                        return cmp;
                    }
                }
            }
        }
    }

    Ordering::Equal
}
