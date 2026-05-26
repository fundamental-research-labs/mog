//! Delimiter / quote-character sniffing.
//!
//! The CSV crate consumes one delimiter byte; we choose it from the first
//! ~8 KB of decoded text by counting how often each candidate (`,`, `\t`,
//! `;`, `|`) appears outside of quoted regions. Comma wins ties because
//! "`.csv`" implies comma in the absence of evidence otherwise.
//!
//! Line terminator is *not* sniffed — `csv::Terminator::Any` (1.2+) handles
//! all of `\n` / `\r\n` / `\r` and even mixed-in-one-file inputs.

const SNIFF_BYTES: usize = 8 * 1024;
const CANDIDATES: [u8; 4] = [b',', b'\t', b';', b'|'];

/// Choose a delimiter byte from the prefix of `text`.
pub(crate) fn detect_delimiter(text: &str) -> u8 {
    let prefix = text.as_bytes();
    let prefix = &prefix[..prefix.len().min(SNIFF_BYTES)];

    let mut counts = [0usize; CANDIDATES.len()];
    let mut in_quote = false;
    for &b in prefix {
        if b == b'"' {
            in_quote = !in_quote;
            continue;
        }
        if in_quote {
            continue;
        }
        for (i, &c) in CANDIDATES.iter().enumerate() {
            if b == c {
                counts[i] += 1;
            }
        }
    }

    // Highest count wins; ties resolved by `CANDIDATES` order (comma first).
    let (best_idx, &best_count) = counts
        .iter()
        .enumerate()
        .max_by_key(|(_, c)| *c)
        .expect("CANDIDATES is non-empty");
    if best_count == 0 {
        // No delimiter visible at all — fall back to comma. The csv crate
        // will then read each line as a single field.
        return b',';
    }
    CANDIDATES[best_idx]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comma_wins_default() {
        assert_eq!(detect_delimiter("a,b,c\n1,2,3\n"), b',');
    }

    #[test]
    fn tab_wins_when_dominant() {
        assert_eq!(detect_delimiter("a\tb\tc\n1\t2\t3\n"), b'\t');
    }

    #[test]
    fn semicolon_wins_when_dominant() {
        assert_eq!(detect_delimiter("a;b;c\n1;2;3\n"), b';');
    }

    #[test]
    fn pipe_wins_when_dominant() {
        assert_eq!(detect_delimiter("a|b|c\n1|2|3\n"), b'|');
    }

    #[test]
    fn quoted_commas_are_ignored() {
        // Single semicolon outside quotes; many commas inside. Sniff should
        // pick semicolon.
        let text = r#""a,b,c";"d,e,f""#;
        assert_eq!(detect_delimiter(text), b';');
    }

    #[test]
    fn empty_input_falls_back_to_comma() {
        assert_eq!(detect_delimiter(""), b',');
    }

    #[test]
    fn no_delimiter_falls_back_to_comma() {
        assert_eq!(detect_delimiter("just one column\nanother row\n"), b',');
    }
}
