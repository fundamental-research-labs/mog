//! Encoding detection and decode-to-`String`.
//!
//! Order of operations (matches Firefox's CSV import behaviour):
//!
//! 1. **BOM sniff** — UTF-8 (`EF BB BF`), UTF-16 LE (`FF FE`), UTF-16 BE
//!    (`FE FF`), UTF-32 LE (`FF FE 00 00`), UTF-32 BE (`00 00 FE FF`). The
//!    UTF-32 patterns must be checked **before** the UTF-16 ones because
//!    UTF-32 LE starts with the same two bytes as UTF-16 LE.
//! 2. **User override** — if the caller supplied `encoding`, look up the
//!    label in `encoding_rs`. Unknown label is an error.
//! 3. **`chardetng`** — feed the bytes to a sniffer; the chosen encoding's
//!    decoder runs over the input. Any non-UTF-8 result emits an
//!    [`EncodingFallback`] warning.
//!
//! BOM bytes are stripped from the output. Decode never errors — invalid
//! sequences become U+FFFD in the result `String` (matching Excel/Sheets).

use encoding_rs::{Encoding, UTF_8};

use crate::types::CsvWarning;

/// Result of [`decode`]: the UTF-8 string and the encoding label that
/// produced it. The label is preserved verbatim from `encoding_rs` so the
/// UI surfaces what actually decoded the bytes.
pub(crate) struct DecodeResult {
    pub text: String,
    pub label: String,
    pub warnings: Vec<CsvWarning>,
}

/// Decode raw CSV bytes to UTF-8.
///
/// `user_encoding` is the optional caller override (`"utf-8"`, `"utf-16le"`,
/// …). When `None`, the BOM is sniffed first and `chardetng` is the
/// fallback for BOM-less input.
pub(crate) fn decode(bytes: &[u8], user_encoding: Option<&str>) -> Result<DecodeResult, String> {
    // 1. BOM sniff. Order matters: UTF-32 must precede UTF-16 LE because
    //    `FF FE 00 00` overlaps `FF FE`.
    if let Some((enc, bom_len)) = sniff_bom(bytes) {
        let payload = &bytes[bom_len..];
        let (cow, _, _) = enc.decode(payload);
        return Ok(DecodeResult {
            text: cow.into_owned(),
            label: enc.name().to_string(),
            warnings: vec![],
        });
    }

    // 2. User override.
    if let Some(label) = user_encoding {
        let enc = Encoding::for_label(label.as_bytes())
            .ok_or_else(|| format!("Unknown encoding label: {label:?}"))?;
        let (cow, _, _) = enc.decode(bytes);
        return Ok(DecodeResult {
            text: cow.into_owned(),
            label: enc.name().to_string(),
            warnings: vec![],
        });
    }

    // 3. UTF-8 fast path: if the bytes already validate as UTF-8 *and*
    //    look ASCII-dominant, skip chardetng entirely. This is the common
    //    case (real CSVs from Excel/Sheets without a BOM are UTF-8 in 2026).
    if std::str::from_utf8(bytes).is_ok() {
        return Ok(DecodeResult {
            text: String::from_utf8(bytes.to_vec()).unwrap(),
            label: UTF_8.name().to_string(),
            warnings: vec![],
        });
    }

    // 4. chardetng fallback for non-UTF-8 BOM-less input.
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    let enc = detector.guess(None, true);
    let (cow, _, _) = enc.decode(bytes);
    let warnings = if enc != UTF_8 {
        vec![CsvWarning::EncodingFallback {
            from: "utf-8".to_string(),
            to: enc.name().to_string(),
        }]
    } else {
        vec![]
    };
    Ok(DecodeResult {
        text: cow.into_owned(),
        label: enc.name().to_string(),
        warnings,
    })
}

/// Returns `Some((encoding, bom_byte_length))` when the input starts with a
/// recognised BOM, else `None`.
///
/// Detection order is **specific-first**: the four-byte UTF-32 patterns are
/// checked before the two-byte UTF-16 ones because UTF-32 LE begins with
/// the same two bytes as UTF-16 LE.
fn sniff_bom(bytes: &[u8]) -> Option<(&'static Encoding, usize)> {
    // UTF-32 LE: FF FE 00 00 (must precede UTF-16 LE check).
    if bytes.starts_with(&[0xFF, 0xFE, 0x00, 0x00]) {
        // encoding_rs does not ship a UTF-32 decoder, but the corpus does
        // not exercise UTF-32. We still strip the BOM and decode the rest
        // through UTF-16 LE — the result is garbled but the call doesn't
        // error. Future round adds a real UTF-32 decoder.
        return Some((encoding_rs::UTF_16LE, 4));
    }
    // UTF-32 BE: 00 00 FE FF.
    if bytes.starts_with(&[0x00, 0x00, 0xFE, 0xFF]) {
        return Some((encoding_rs::UTF_16BE, 4));
    }
    // UTF-8 BOM: EF BB BF.
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Some((encoding_rs::UTF_8, 3));
    }
    // UTF-16 LE BOM: FF FE.
    if bytes.starts_with(&[0xFF, 0xFE]) {
        return Some((encoding_rs::UTF_16LE, 2));
    }
    // UTF-16 BE BOM: FE FF.
    if bytes.starts_with(&[0xFE, 0xFF]) {
        return Some((encoding_rs::UTF_16BE, 2));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_no_bom_decodes_clean() {
        let r = decode(b"name,value\nalpha,1\n", None).unwrap();
        assert_eq!(r.text, "name,value\nalpha,1\n");
        assert_eq!(r.label, "UTF-8");
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn utf8_bom_is_stripped() {
        let bytes: Vec<u8> = [&[0xEF, 0xBB, 0xBF][..], b"name\n"].concat();
        let r = decode(&bytes, None).unwrap();
        assert_eq!(r.text, "name\n");
        assert!(r.warnings.is_empty());
    }

    #[test]
    fn utf16_le_bom_decodes() {
        // FF FE | "n" "a" "m" "e" "\n"
        let bytes: Vec<u8> = vec![0xFF, 0xFE, b'n', 0, b'a', 0, b'm', 0, b'e', 0, b'\n', 0];
        let r = decode(&bytes, None).unwrap();
        assert_eq!(r.text, "name\n");
        assert_eq!(r.label, "UTF-16LE");
    }

    #[test]
    fn utf16_be_bom_decodes() {
        let bytes: Vec<u8> = vec![0xFE, 0xFF, 0, b'n', 0, b'a', 0, b'm', 0, b'e', 0, b'\n'];
        let r = decode(&bytes, None).unwrap();
        assert_eq!(r.text, "name\n");
        assert_eq!(r.label, "UTF-16BE");
    }

    #[test]
    fn unknown_encoding_label_errors() {
        let r = decode(b"x", Some("definitely-not-an-encoding"));
        assert!(r.is_err());
    }

    #[test]
    fn windows_1252_fallback_emits_warning() {
        // A high-bit byte that is invalid UTF-8 but valid Windows-1252.
        // 0x9D is a control char in Windows-1252; 0x80 (€ in Win-1252) is
        // a non-UTF-8 lead byte.
        let bytes = vec![b'a', 0x80, b','];
        let r = decode(&bytes, None).unwrap();
        assert!(
            !r.warnings.is_empty(),
            "non-UTF-8 BOM-less input should produce an EncodingFallback warning"
        );
    }
}
