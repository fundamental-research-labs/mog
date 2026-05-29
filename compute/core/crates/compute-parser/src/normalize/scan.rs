// Quote scanning is byte-based, but it only branches on ASCII quote bytes.
#![allow(clippy::string_slice)]

fn quote_run_len(bytes: &[u8], mut pos: usize) -> usize {
    let start = pos;
    while pos < bytes.len() && bytes[pos] == b'"' {
        pos += 1;
    }
    pos - start
}

fn follows_empty_string_boundary(bytes: &[u8], pos: usize) -> bool {
    pos >= bytes.len()
        || matches!(
            bytes[pos],
            b')' | b',' | b';' | b'&' | b'+' | b'-' | b'*' | b'/' | b'^' | b'=' | b'<' | b'>'
        )
}

/// Advance past a double-quoted formula literal. `pos` should point to the byte
/// *after* the opening `"`. Returns the index of the first byte *after* the
/// closing quote (or `bytes.len()` if the string is unterminated).
///
/// Normal Excel formula strings use `"` as the delimiter and `""` as an
/// escaped quote once inside the string. Imported and normalized formula text
/// can also contain quote runs at token boundaries, such as `""text""` or
/// `""""text""""`; for normalization purposes those runs protect the text
/// between them from formula rewrites.
pub(super) fn skip_double_quoted(bytes: &[u8], mut pos: usize) -> usize {
    let len = bytes.len();
    if pos == 0 {
        return pos;
    }

    let opening_start = pos - 1;
    let opening_run = quote_run_len(bytes, opening_start);
    if opening_run > 1 {
        pos = opening_start + opening_run;
        if opening_run == 2 && follows_empty_string_boundary(bytes, pos) {
            return pos;
        }

        while pos < len {
            if bytes[pos] == b'"' {
                return pos + quote_run_len(bytes, pos);
            }
            pos += 1;
        }
        return len;
    }

    while pos < len {
        if bytes[pos] == b'"' {
            let run = quote_run_len(bytes, pos);
            pos += run;
            if run.is_multiple_of(2) {
                // Escaped quote pairs inside a normal quoted string.
                continue;
            }
            return pos; // past closing quote
        }
        pos += 1;
    }
    pos
}

/// Advance past a single-quoted sheet name body.  `pos` should point to the
/// byte *after* the opening `'`.  Returns the index of the first byte *after*
/// the closing quote (or `bytes.len()` if unterminated).
pub(super) fn skip_single_quoted(bytes: &[u8], mut pos: usize) -> usize {
    let len = bytes.len();
    while pos < len {
        if bytes[pos] == b'\'' {
            pos += 1;
            if pos < len && bytes[pos] == b'\'' {
                pos += 1; // escaped ''
            } else {
                return pos; // past closing quote
            }
        } else {
            pos += 1;
        }
    }
    pos
}
