// Quote scanning is byte-based, but it only branches on ASCII quote bytes.
#![allow(clippy::string_slice)]

/// Advance past a double-quoted string body.  `pos` should point to the byte
/// *after* the opening `"`.  Returns the index of the first byte *after* the
/// closing quote (or `bytes.len()` if the string is unterminated).
pub(super) fn skip_double_quoted(bytes: &[u8], mut pos: usize) -> usize {
    let len = bytes.len();
    while pos < len {
        if bytes[pos] == b'"' {
            pos += 1;
            if pos < len && bytes[pos] == b'"' {
                pos += 1; // escaped ""
            } else {
                return pos; // past closing quote
            }
        } else {
            pos += 1;
        }
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
