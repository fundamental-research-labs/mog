//! Assemble a one-sheet `domain_types::ParseOutput` from raw CSV bytes.
//!
//! Pipeline:
//!   bytes
//!     → [`encoding::decode`]    : produces UTF-8 text + BOM-aware label
//!     → [`dialect::detect_delimiter`]
//!     → `csv::Reader`           : RFC 4180 + `Terminator::Any`
//!     → [`infer::infer_cell`]   : per-field type + style_id
//!     → `ParseOutput`           : with the 4-entry style palette
//!
//! Position-keyed: no `cell_id` allocations here. The compute-core
//! hydration layer (`hydrate_from_parse_output`) allocates UUIDs and
//! threads them through to the snapshot conversion.

use domain_types::{CellData, ParseOutput, SheetData};

use crate::dialect::detect_delimiter;
use crate::encoding::decode;
use crate::infer::{StylePalette, infer_cell};
use crate::options::{CsvImportOptions, DEFAULT_MAX_COLS, DEFAULT_MAX_ROWS};
use crate::types::{CsvParseError, CsvParseResult, CsvWarning};

/// Top-level entry: raw bytes → ready-to-hydrate `ParseOutput`.
pub fn parse_csv_to_parse_output(
    bytes: &[u8],
    options: CsvImportOptions,
) -> Result<CsvParseResult, CsvParseError> {
    let max_rows = if options.max_rows == 0 {
        DEFAULT_MAX_ROWS
    } else {
        options.max_rows
    };
    let max_cols = if options.max_cols == 0 {
        DEFAULT_MAX_COLS
    } else {
        options.max_cols
    };
    let evaluate_formulas = options.evaluate_formulas;
    let sheet_name = options
        .sheet_name
        .clone()
        .unwrap_or_else(|| "Sheet1".to_string());

    // ---- Encoding ----
    let decoded =
        decode(bytes, options.encoding.as_deref()).map_err(CsvParseError::UnreadableEncoding)?;
    let mut warnings = decoded.warnings;
    let detected_encoding = decoded.label;
    let text = decoded.text;

    // Empty / BOM-only input → return an empty single-sheet output
    // with an `EmptyInput` warning (per the plan: "never an error").
    if text.is_empty() {
        warnings.push(CsvWarning::EmptyInput);
        return Ok(CsvParseResult {
            output: empty_output(&sheet_name),
            warnings,
            detected_encoding,
            detected_delimiter: ',',
            row_count: 0,
            col_count: 0,
        });
    }

    // ---- Dialect ----
    let delimiter_byte = match options.delimiter {
        Some(ref d) => {
            let bytes = d.as_bytes();
            if bytes.len() != 1 {
                return Err(CsvParseError::InvalidDelimiter(d.clone()));
            }
            bytes[0]
        }
        None => detect_delimiter(&text),
    };

    // ---- CSV recovery / line-ending normalisation ----
    // The `csv` crate's `Terminator::Any(b)` only accepts ONE byte —
    // it can't natively handle a file that mixes `\n`, `\r\n`, and `\r`
    // (the `mixed-line-endings.csv` fixture). Pre-normalise CRLF/CR → LF
    // outside any quoted region so the reader sees a single line
    // terminator. Quoted regions are preserved verbatim (RFC 4180 keeps
    // embedded CR/LF inside `"..."` literally).
    let normalised = normalise_line_endings(&text, delimiter_byte);

    // ---- CSV reader ----
    let mut builder = csv::ReaderBuilder::new();
    builder
        .has_headers(false) // we treat row 0 as data; headers are a UI concern
        .delimiter(delimiter_byte)
        .terminator(csv::Terminator::Any(b'\n'))
        .flexible(true); // tolerate per-row width mismatch
    let mut reader = builder.from_reader(normalised.as_bytes());

    // ---- Inference scaffolding ----
    let (palette_idx, palette_entries) = StylePalette::new();

    let mut cells: Vec<CellData> = Vec::new();
    let mut row_idx: u32 = 0;
    let mut max_col_seen: u32 = 0;
    let mut header_width: Option<u32> = None;
    let mut truncated_rows: u32 = 0;
    let mut truncated_cols: u32 = 0;
    let mut record = csv::ByteRecord::new();
    loop {
        match reader.read_byte_record(&mut record) {
            Ok(true) => {}
            Ok(false) => break,
            Err(err) => {
                let pos = err.position().map(|p| p.byte()).unwrap_or(0);
                if matches!(err.kind(), csv::ErrorKind::UnequalLengths { .. }) {
                    // Already covered by `flexible(true)` so this branch
                    // shouldn't fire; surface as a warning and keep going.
                    warnings.push(CsvWarning::UnbalancedQuote { row: row_idx });
                    continue;
                }
                return Err(CsvParseError::Reader {
                    position: pos,
                    source: err,
                });
            }
        }

        if row_idx >= max_rows {
            truncated_rows = truncated_rows.saturating_add(1);
            continue;
        }

        let raw_width = record.len() as u32;
        if header_width.is_none() && row_idx == 0 {
            header_width = Some(raw_width);
        }
        if let Some(expected) = header_width
            && expected != raw_width
        {
            warnings.push(CsvWarning::MismatchedRowWidth {
                row: row_idx,
                expected,
                actual: raw_width,
            });
        }

        let visible_width = raw_width.min(max_cols);
        if visible_width < raw_width {
            truncated_cols = truncated_cols.max(raw_width - visible_width);
        }
        if visible_width > max_col_seen {
            max_col_seen = visible_width;
        }

        for col_idx in 0..visible_width {
            let field_bytes = record
                .get(col_idx as usize)
                .expect("col_idx < record.len()");
            // Decode is already done at the byte level — these bytes are
            // valid UTF-8 because they came from `text.as_bytes()`. Use
            // `from_utf8` to surface any unsoundness rather than silently
            // assuming.
            let field = match std::str::from_utf8(field_bytes) {
                Ok(s) => s,
                Err(_) => continue,
            };
            let Some(inferred) = infer_cell(field, &palette_idx, evaluate_formulas) else {
                continue; // empty fields are skipped (no entry in `cells`)
            };
            cells.push(CellData {
                row: row_idx,
                col: col_idx,
                value: inferred.value,
                formula: inferred.formula,
                array_ref: None,
                style_id: inferred.style_id,
                ..CellData::default()
            });
        }

        row_idx = row_idx.saturating_add(1);
    }

    if truncated_rows > 0 {
        warnings.push(CsvWarning::TruncatedRows {
            kept: max_rows,
            dropped: truncated_rows,
        });
    }
    if truncated_cols > 0 {
        warnings.push(CsvWarning::TruncatedCols {
            kept: max_cols,
            dropped: truncated_cols,
        });
    }

    // Strip trailing all-empty rows: the row counter advanced for each
    // iterator yield, but any row that produced zero cell entries doesn't
    // contribute data. Excel's behaviour is "trailing blank rows are not
    // synthesized" (csv-empty-trailing-newlines fixture).
    let logical_row_count = trailing_data_row_count(&cells, row_idx);

    let output = ParseOutput {
        sheets: vec![SheetData {
            name: sheet_name,
            rows: logical_row_count,
            cols: max_col_seen,
            cells,
            ..SheetData::default()
        }],
        style_palette: palette_entries,
        workbook_stylesheet: None,
        ..ParseOutput::default()
    };

    Ok(CsvParseResult {
        output,
        warnings,
        detected_encoding,
        detected_delimiter: delimiter_byte as char,
        row_count: logical_row_count,
        col_count: max_col_seen,
    })
}

/// Build a one-empty-sheet output — used for empty / BOM-only input.
fn empty_output(sheet_name: &str) -> ParseOutput {
    let (_, palette_entries) = StylePalette::new();
    ParseOutput {
        sheets: vec![SheetData {
            name: sheet_name.to_string(),
            rows: 0,
            cols: 0,
            cells: vec![],
            ..SheetData::default()
        }],
        style_palette: palette_entries,
        workbook_stylesheet: None,
        ..ParseOutput::default()
    }
}

/// Normalise line terminators outside quoted regions to `\n` and recover
/// literal quotes inside malformed quoted fields.
///
/// Inside a `"..."` quoted region (RFC 4180), CR/LF bytes are payload
/// and must be preserved verbatim. Outside, fold:
/// - `\r\n` → `\n`
/// - bare `\r` → `\n`
///
/// Quote handling mirrors Excel's recovery for malformed quoted fields: while
/// a quoted field is open, a `"` closes the field only when followed by the
/// delimiter, a line terminator, or EOF. If another byte follows, the quote is
/// payload and is doubled before handing the text to the `csv` crate so it
/// survives unquoting.
///
/// Operates at the byte level. UTF-8 continuation bytes (0x80..=0xBF) are
/// never `"` (0x22) or `\r` (0x0D), so multi-byte sequences pass through
/// verbatim.
fn normalise_line_endings(text: &str, delimiter: u8) -> String {
    let bytes = text.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut in_quote = false;
    let mut at_field_start = true;
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'"' {
            if in_quote {
                match bytes.get(i + 1).copied() {
                    Some(b'"') => {
                        out.extend_from_slice(b"\"\"");
                        i += 2;
                        continue;
                    }
                    Some(next) if next == delimiter || next == b'\n' || next == b'\r' => {
                        in_quote = false;
                        at_field_start = false;
                        out.push(b'"');
                        i += 1;
                        continue;
                    }
                    None => {
                        in_quote = false;
                        at_field_start = false;
                        out.push(b'"');
                        i += 1;
                        continue;
                    }
                    Some(_) => {
                        out.extend_from_slice(b"\"\"");
                        i += 1;
                        continue;
                    }
                }
            } else if at_field_start {
                in_quote = true;
            }
            at_field_start = false;
            out.push(b'"');
            i += 1;
            continue;
        }
        if !in_quote && b == b'\r' {
            // CR or CRLF outside a quoted region → single LF.
            out.push(b'\n');
            at_field_start = true;
            if i + 1 < bytes.len() && bytes[i + 1] == b'\n' {
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }
        out.push(b);
        if !in_quote {
            at_field_start = b == delimiter || b == b'\n';
        }
        i += 1;
    }
    // The input was a valid `&str` and we only ever (a) copied bytes
    // through verbatim or (b) replaced an ASCII `\r` (or `\r\n`) with an
    // ASCII `\n`. Both preserve UTF-8 validity.
    String::from_utf8(out).expect("byte-level normalise preserves UTF-8")
}

/// Count of data rows after stripping trailing all-empty rows.
///
/// `parsed_rows` is the count of physical rows consumed from the reader
/// (including all-empty trailing rows from `\n\n\n`).
fn trailing_data_row_count(cells: &[CellData], parsed_rows: u32) -> u32 {
    let max_row_with_data = cells.iter().map(|c| c.row).max();
    match max_row_with_data {
        Some(r) => r.saturating_add(1),
        None => 0,
    }
    .min(parsed_rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_lf_passthrough() {
        assert_eq!(normalise_line_endings("a\nb\n", b','), "a\nb\n");
    }

    #[test]
    fn normalise_crlf_to_lf() {
        assert_eq!(normalise_line_endings("a\r\nb\r\n", b','), "a\nb\n");
    }

    #[test]
    fn normalise_bare_cr_to_lf() {
        assert_eq!(normalise_line_endings("a\rb\rc", b','), "a\nb\nc");
    }

    #[test]
    fn normalise_mixed() {
        assert_eq!(
            normalise_line_endings("a,b,c\n1,2,3\r\n4,5,6\r7,8,9\n", b','),
            "a,b,c\n1,2,3\n4,5,6\n7,8,9\n"
        );
    }

    #[test]
    fn normalise_preserves_quoted_cr_lf() {
        // CR/LF inside a quoted field stay as-is (Excel embeds them this way).
        assert_eq!(
            normalise_line_endings("\"line1\nline2\",x\n", b','),
            "\"line1\nline2\",x\n"
        );
        assert_eq!(
            normalise_line_endings("\"x\r\ny\",z\r\n", b','),
            "\"x\r\ny\",z\n"
        );
    }

    #[test]
    fn normalise_preserves_utf8_multibyte() {
        // 'é' is 0xC3 0xA9 — neither is `"` (0x22) or `\r` (0x0D).
        let s = "café\r\n";
        assert_eq!(normalise_line_endings(s, b','), "café\n");
    }

    #[test]
    fn normalise_escapes_literal_quote_inside_unclosed_field() {
        assert_eq!(
            normalise_line_endings("alice,\"hello\nbob,\"world", b','),
            "alice,\"hello\nbob,\"\"world"
        );
    }
}
