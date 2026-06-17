//! PDF 1.7 binary serializer.
//!
//! Produces a valid PDF file from a `BuiltDocument`. Implements:
//! - PDF 1.7 header with binary indicator
//! - Indirect object serialization
//! - Cross-reference table with free list
//! - Trailer dictionary
//! - PDF string escaping and Name encoding
//! - PDF date formatting

use crate::document::BuiltDocument;
use crate::types::*;
use std::io::{self, Write};

/// Serialize a built document to a PDF byte stream, writing to any `Write` implementor.
pub fn serialize_document<W: Write>(doc: &BuiltDocument, writer: &mut W) -> io::Result<()> {
    let mut counter = CountingWriter::new(writer);

    // 1. PDF header
    write_header(&mut counter)?;

    // 2. Body: indirect objects. Track byte offsets for xref.
    let mut xref_entries: Vec<XrefEntry> = Vec::new();

    // Entry 0: free list head (always present, generation 65535).
    xref_entries.push(XrefEntry::Free {
        next_free: 0,
        gen_num: 65535,
    });

    // Sort objects by obj_num to write in order.
    let mut sorted_objects: Vec<_> = doc.objects.iter().collect();
    sorted_objects.sort_by_key(|o| o.obj_ref.obj_num);

    // Fill xref entries with placeholders for any gaps.
    let max_obj_num = sorted_objects
        .last()
        .map(|o| o.obj_ref.obj_num)
        .unwrap_or(0);

    // Pre-fill xref entries (index 0 is already done).
    for _ in 1..=max_obj_num {
        xref_entries.push(XrefEntry::Free {
            next_free: 0,
            gen_num: 0,
        });
    }

    // Write each object and record offsets.
    for obj in &sorted_objects {
        let offset = counter.bytes_written();
        write_indirect_object(&mut counter, obj.obj_ref, &obj.value)?;
        xref_entries[obj.obj_ref.obj_num as usize] = XrefEntry::InUse {
            offset,
            gen_num: obj.obj_ref.gen_num,
        };
    }

    // 3. Cross-reference table.
    let xref_offset = counter.bytes_written();
    write_xref_table(&mut counter, &xref_entries)?;

    // 4. Trailer.
    write_trailer(
        &mut counter,
        xref_entries.len() as u32,
        doc.catalog_ref,
        doc.info_ref,
        xref_offset,
    )?;

    counter.flush()?;
    Ok(())
}

/// Convenience: serialize to a `Vec<u8>`.
pub fn serialize_document_to_bytes(doc: &BuiltDocument) -> Vec<u8> {
    let mut buf = Vec::new();
    serialize_document(doc, &mut buf).expect("Writing to Vec<u8> should not fail");
    buf
}

/// Write the PDF 1.7 header.
fn write_header<W: Write>(w: &mut W) -> io::Result<()> {
    // PDF version header.
    w.write_all(b"%PDF-1.7\n")?;
    // Binary indicator: 4 bytes with high bits set (per spec 7.5.2).
    w.write_all(b"%\xe2\xe3\xcf\xd3\n")?;
    Ok(())
}

/// Write an indirect object: `N G obj\n...value...\nendobj\n`
fn write_indirect_object<W: Write>(w: &mut W, obj_ref: PdfRef, value: &PdfValue) -> io::Result<()> {
    writeln!(w, "{} {} obj", obj_ref.obj_num, obj_ref.gen_num)?;

    match value {
        PdfValue::Stream(stream) => {
            write_stream(w, stream)?;
        }
        _ => {
            write_value(w, value)?;
            w.write_all(b"\n")?;
        }
    }

    w.write_all(b"endobj\n")?;
    Ok(())
}

/// Write a PDF value (non-stream).
fn write_value<W: Write>(w: &mut W, value: &PdfValue) -> io::Result<()> {
    match value {
        PdfValue::Boolean(b) => {
            if *b {
                w.write_all(b"true")?;
            } else {
                w.write_all(b"false")?;
            }
        }
        PdfValue::Integer(i) => write!(w, "{}", i)?,
        PdfValue::Real(r) => {
            let s = format_real(*r);
            w.write_all(s.as_bytes())?;
        }
        PdfValue::Str(s) => write_pdf_string(w, s)?,
        PdfValue::Name(name) => write_pdf_name(w, name)?,
        PdfValue::Array(arr) => {
            w.write_all(b"[")?;
            for (i, item) in arr.iter().enumerate() {
                if i > 0 {
                    w.write_all(b" ")?;
                }
                write_value(w, item)?;
            }
            w.write_all(b"]")?;
        }
        PdfValue::Dict(dict) => write_dict(w, dict)?,
        PdfValue::Ref(r) => write!(w, "{} {} R", r.obj_num, r.gen_num)?,
        PdfValue::Null => w.write_all(b"null")?,
        PdfValue::Stream(_) => {
            // Streams should be written via write_stream, not via write_value.
            // If we get here, treat as null (shouldn't happen with proper API usage).
            w.write_all(b"null")?;
        }
    }
    Ok(())
}

/// Write a PDF dictionary.
fn write_dict<W: Write>(w: &mut W, dict: &PdfDict) -> io::Result<()> {
    w.write_all(b"<<")?;
    for (key, value) in dict.iter() {
        w.write_all(b" ")?;
        write_pdf_name(w, key)?;
        w.write_all(b" ")?;
        write_value(w, value)?;
    }
    w.write_all(b" >>")?;
    Ok(())
}

/// Write a PDF stream object (dict + stream keyword + data + endstream).
fn write_stream<W: Write>(w: &mut W, stream: &PdfStream) -> io::Result<()> {
    // Build a copy of the dictionary with /Length set.
    let mut dict = stream.dict.clone();
    dict.set("Length", PdfValue::Integer(stream.data.len() as i64));

    write_dict(w, &dict)?;
    w.write_all(b"\nstream\n")?;
    w.write_all(&stream.data)?;
    w.write_all(b"\nendstream\n")?;
    Ok(())
}

/// Write a PDF literal string with proper escaping.
/// Escapes: `\`, `(`, `)`, and control characters.
fn write_pdf_string<W: Write>(w: &mut W, data: &[u8]) -> io::Result<()> {
    w.write_all(b"(")?;
    for &byte in data {
        match byte {
            b'\\' => w.write_all(b"\\\\")?,
            b'(' => w.write_all(b"\\(")?,
            b')' => w.write_all(b"\\)")?,
            b'\n' => w.write_all(b"\\n")?,
            b'\r' => w.write_all(b"\\r")?,
            b'\t' => w.write_all(b"\\t")?,
            b'\x08' => w.write_all(b"\\b")?,
            b'\x0c' => w.write_all(b"\\f")?,
            0x00..=0x1f => {
                // Other control chars: octal escape.
                write!(w, "\\{:03o}", byte)?;
            }
            _ => w.write_all(&[byte])?,
        }
    }
    w.write_all(b")")?;
    Ok(())
}

/// Write a PDF name with proper encoding.
/// Per PDF spec 7.3.5: hex-escape characters outside `!`-`~` range and `#`.
fn write_pdf_name<W: Write>(w: &mut W, name: &PdfName) -> io::Result<()> {
    w.write_all(b"/")?;
    for &byte in name.as_str().as_bytes() {
        if byte == b'#' || !(b'!'..=b'~').contains(&byte) {
            // Hex-encode using #XX.
            write!(w, "#{:02X}", byte)?;
        } else {
            // Certain delimiter characters should also be hex-encoded per spec.
            match byte {
                b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%' => {
                    write!(w, "#{:02X}", byte)?;
                }
                _ => w.write_all(&[byte])?,
            }
        }
    }
    Ok(())
}

/// Cross-reference table entry.
enum XrefEntry {
    Free { next_free: u32, gen_num: u16 },
    InUse { offset: u64, gen_num: u16 },
}

/// Write the cross-reference table.
fn write_xref_table<W: Write>(w: &mut W, entries: &[XrefEntry]) -> io::Result<()> {
    writeln!(w, "xref")?;
    writeln!(w, "0 {}", entries.len())?;

    for entry in entries {
        match entry {
            XrefEntry::Free { next_free, gen_num } => {
                writeln!(w, "{:010} {:05} f ", next_free, gen_num)?;
            }
            XrefEntry::InUse { offset, gen_num } => {
                writeln!(w, "{:010} {:05} n ", offset, gen_num)?;
            }
        }
    }
    Ok(())
}

/// Write the trailer and %%EOF.
fn write_trailer<W: Write>(
    w: &mut W,
    size: u32,
    catalog_ref: PdfRef,
    info_ref: Option<PdfRef>,
    xref_offset: u64,
) -> io::Result<()> {
    w.write_all(b"trailer\n")?;

    let mut trailer = PdfDict::new();
    trailer.set("Size", PdfValue::Integer(size as i64));
    trailer.set("Root", PdfValue::Ref(catalog_ref));
    if let Some(info) = info_ref {
        trailer.set("Info", PdfValue::Ref(info));
    }

    write_dict(w, &trailer)?;
    w.write_all(b"\n")?;

    write!(w, "startxref\n{}\n%%EOF\n", xref_offset)?;
    Ok(())
}

/// Format a f64 for PDF output. Removes unnecessary trailing zeros.
fn format_real(v: f64) -> String {
    if v == v.floor() && v.abs() < i64::MAX as f64 {
        format!("{}", v as i64)
    } else {
        let s = format!("{:.6}", v);
        let s = s.trim_end_matches('0');
        let s = s.trim_end_matches('.');
        s.to_string()
    }
}

/// Format a date for PDF date strings: `D:YYYYMMDDHHmmSSOHH'mm'`
/// where O is `+`, `-`, or `Z`.
pub fn format_pdf_date(
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
    tz_offset_minutes: i32,
) -> String {
    if tz_offset_minutes == 0 {
        format!(
            "D:{:04}{:02}{:02}{:02}{:02}{:02}Z",
            year, month, day, hour, minute, second
        )
    } else {
        let sign = if tz_offset_minutes > 0 { '+' } else { '-' };
        let abs_offset = tz_offset_minutes.unsigned_abs();
        let tz_hours = abs_offset / 60;
        let tz_mins = abs_offset % 60;
        format!(
            "D:{:04}{:02}{:02}{:02}{:02}{:02}{}{:02}'{:02}'",
            year, month, day, hour, minute, second, sign, tz_hours, tz_mins
        )
    }
}

/// A writer wrapper that counts bytes written.
struct CountingWriter<W> {
    inner: W,
    count: u64,
}

impl<W: Write> CountingWriter<W> {
    fn new(inner: W) -> Self {
        Self { inner, count: 0 }
    }

    fn bytes_written(&self) -> u64 {
        self.count
    }
}

impl<W: Write> Write for CountingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.count += n as u64;
        Ok(n)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::content::ContentOp;
    use crate::document::{DocumentInfo, PdfDocument};

    #[test]
    fn test_format_pdf_date_utc() {
        let date = format_pdf_date(2024, 1, 15, 10, 30, 0, 0);
        assert_eq!(date, "D:20240115103000Z");
    }

    #[test]
    fn test_format_pdf_date_positive_offset() {
        let date = format_pdf_date(2024, 6, 20, 14, 0, 0, 330); // UTC+5:30
        assert_eq!(date, "D:20240620140000+05'30'");
    }

    #[test]
    fn test_format_pdf_date_negative_offset() {
        let date = format_pdf_date(2024, 12, 25, 8, 0, 0, -480); // UTC-8
        assert_eq!(date, "D:20241225080000-08'00'");
    }

    #[test]
    fn test_write_pdf_string_basic() {
        let mut buf = Vec::new();
        write_pdf_string(&mut buf, b"Hello").unwrap();
        assert_eq!(buf, b"(Hello)");
    }

    #[test]
    fn test_write_pdf_string_escaped() {
        let mut buf = Vec::new();
        write_pdf_string(&mut buf, b"Hello (World) \\test").unwrap();
        assert_eq!(buf, b"(Hello \\(World\\) \\\\test)");
    }

    #[test]
    fn test_write_pdf_string_control_chars() {
        let mut buf = Vec::new();
        write_pdf_string(&mut buf, b"line1\nline2\ttab").unwrap();
        assert_eq!(buf, b"(line1\\nline2\\ttab)");
    }

    #[test]
    fn test_write_pdf_string_null_byte() {
        let mut buf = Vec::new();
        write_pdf_string(&mut buf, &[0x00, 0x01]).unwrap();
        assert_eq!(buf, b"(\\000\\001)");
    }

    #[test]
    fn test_write_pdf_name_simple() {
        let mut buf = Vec::new();
        write_pdf_name(&mut buf, &PdfName::new("Type")).unwrap();
        assert_eq!(buf, b"/Type");
    }

    #[test]
    fn test_write_pdf_name_with_hash() {
        let mut buf = Vec::new();
        write_pdf_name(&mut buf, &PdfName::new("A#B")).unwrap();
        assert_eq!(buf, b"/A#23B");
    }

    #[test]
    fn test_write_pdf_name_with_space() {
        let mut buf = Vec::new();
        write_pdf_name(&mut buf, &PdfName::new("A B")).unwrap();
        // Space (0x20) is < '!' (0x21), so gets hex-encoded.
        assert_eq!(buf, b"/A#20B");
    }

    #[test]
    fn test_write_pdf_name_with_delimiters() {
        let mut buf = Vec::new();
        write_pdf_name(&mut buf, &PdfName::new("A(B)")).unwrap();
        assert_eq!(buf, b"/A#28B#29");
    }

    #[test]
    fn test_format_real() {
        assert_eq!(format_real(72.0), "72");
        assert_eq!(format_real(0.0), "0");
        assert_eq!(format_real(1.5), "1.5");
        assert_eq!(format_real(-10.0), "-10");
    }

    #[test]
    fn test_serialize_minimal_pdf() {
        // One page, no content — the most basic valid PDF.
        let mut doc = PdfDocument::new();
        let page = doc.add_page(612.0, 792.0);
        doc.finalize_page(page, false);

        let built = doc.build();
        let bytes = serialize_document_to_bytes(&built);
        let text = String::from_utf8_lossy(&bytes);

        // Verify PDF structure.
        assert!(text.starts_with("%PDF-1.7\n"));
        // Binary comment: check raw bytes (not valid UTF-8 so can't check via lossy string).
        let binary_comment = b"%\xe2\xe3\xcf\xd3\n";
        let header_end = b"%PDF-1.7\n".len();
        assert_eq!(
            &bytes[header_end..header_end + binary_comment.len()],
            binary_comment
        );
        assert!(text.contains("xref"));
        assert!(text.contains("trailer"));
        assert!(text.contains("%%EOF"));

        // Verify catalog.
        assert!(text.contains("/Type /Catalog"));
        assert!(text.contains("/Type /Pages"));
        assert!(text.contains("/Type /Page"));

        // Verify MediaBox.
        assert!(text.contains("/MediaBox [0 0 612 792]"));
    }

    #[test]
    fn test_serialize_pdf_with_text() {
        let mut doc = PdfDocument::new();
        let mut page = doc.add_page(612.0, 792.0);

        // Add text content.
        page.content_ops.push(ContentOp::BeginText);
        page.content_ops
            .push(ContentOp::SetFont(PdfName::new("F1"), 12.0));
        page.content_ops.push(ContentOp::TextPosition(72.0, 720.0));
        page.content_ops
            .push(ContentOp::ShowText(b"Hello, PDF!".to_vec()));
        page.content_ops.push(ContentOp::EndText);

        doc.finalize_page(page, false);

        let built = doc.build();
        let bytes = serialize_document_to_bytes(&built);
        let text = String::from_utf8_lossy(&bytes);

        // Verify content stream is present.
        assert!(text.contains("stream"));
        assert!(text.contains("endstream"));
        assert!(text.contains("BT"));
        assert!(text.contains("/F1 12 Tf"));
        assert!(text.contains("(Hello, PDF!) Tj"));
        assert!(text.contains("ET"));
    }

    #[test]
    fn test_serialize_pdf_with_metadata() {
        let mut doc = PdfDocument::new();
        doc.set_info(DocumentInfo {
            title: Some("Test PDF".to_string()),
            author: Some("pdf-core".to_string()),
            subject: None,
            keywords: None,
            creator: None,
            producer: Some("pdf-core 0.1.0".to_string()),
        });

        let page = doc.add_page(612.0, 792.0);
        doc.finalize_page(page, false);

        let built = doc.build();
        let bytes = serialize_document_to_bytes(&built);
        let text = String::from_utf8_lossy(&bytes);

        assert!(text.contains("/Title (Test PDF)"));
        assert!(text.contains("/Author (pdf-core)"));
        assert!(text.contains("/Producer (pdf-core 0.1.0)"));
        assert!(text.contains("/Info"));
    }

    #[test]
    fn test_serialize_pdf_with_compression() {
        let mut doc = PdfDocument::new();
        let mut page = doc.add_page(612.0, 792.0);

        page.content_ops.push(ContentOp::BeginText);
        page.content_ops
            .push(ContentOp::SetFont(PdfName::new("F1"), 12.0));
        page.content_ops.push(ContentOp::TextPosition(72.0, 720.0));
        page.content_ops
            .push(ContentOp::ShowText(b"Hello, compressed PDF!".to_vec()));
        page.content_ops.push(ContentOp::EndText);

        doc.finalize_page(page, true); // compress=true

        let built = doc.build();
        let bytes = serialize_document_to_bytes(&built);
        let text = String::from_utf8_lossy(&bytes);

        assert!(text.contains("/Filter /FlateDecode"));
    }

    #[test]
    fn test_serialize_xref_table_format() {
        let mut doc = PdfDocument::new();
        let page = doc.add_page(612.0, 792.0);
        doc.finalize_page(page, false);

        let built = doc.build();
        let bytes = serialize_document_to_bytes(&built);
        let text = String::from_utf8_lossy(&bytes);

        // Find xref section and verify entry format.
        let xref_pos = text.find("xref\n").unwrap();
        let after_xref = &text[xref_pos..];

        // Should start with "xref\n0 N\n".
        assert!(after_xref.starts_with("xref\n0 "));

        // Entry 0 should be free: "0000000000 65535 f \n"
        assert!(after_xref.contains("0000000000 65535 f "));
    }

    #[test]
    fn test_serialize_multiple_pages() {
        let mut doc = PdfDocument::new();
        for i in 0..3 {
            let mut page = doc.add_page(612.0, 792.0);
            page.content_ops.push(ContentOp::BeginText);
            page.content_ops
                .push(ContentOp::SetFont(PdfName::new("F1"), 12.0));
            page.content_ops.push(ContentOp::TextPosition(72.0, 720.0));
            page.content_ops
                .push(ContentOp::ShowText(format!("Page {}", i + 1).into_bytes()));
            page.content_ops.push(ContentOp::EndText);
            doc.finalize_page(page, false);
        }

        let built = doc.build();
        assert_eq!(built.page_count, 3);

        let bytes = serialize_document_to_bytes(&built);
        let text = String::from_utf8_lossy(&bytes);

        // Verify the page count in the pages tree.
        assert!(text.contains("/Count 3"));
    }

    #[test]
    fn test_serialize_to_writer() {
        let mut doc = PdfDocument::new();
        let page = doc.add_page(612.0, 792.0);
        doc.finalize_page(page, false);

        let built = doc.build();

        // Serialize to a Vec<u8> via the Write trait.
        let mut output = Vec::new();
        serialize_document(&built, &mut output).unwrap();

        assert!(!output.is_empty());
        assert!(output.starts_with(b"%PDF-1.7"));
    }

    #[test]
    fn test_counting_writer() {
        let mut buf = Vec::new();
        let mut cw = CountingWriter::new(&mut buf);
        cw.write_all(b"Hello").unwrap();
        assert_eq!(cw.bytes_written(), 5);
        cw.write_all(b", World!").unwrap();
        assert_eq!(cw.bytes_written(), 13);
    }

    #[test]
    fn test_write_value_all_types() {
        let test_cases: Vec<(PdfValue, &str)> = vec![
            (PdfValue::Boolean(true), "true"),
            (PdfValue::Boolean(false), "false"),
            (PdfValue::Integer(42), "42"),
            (PdfValue::Integer(-7), "-7"),
            (PdfValue::Real(12.34), "12.34"),
            (PdfValue::Null, "null"),
        ];

        for (value, expected) in test_cases {
            let mut buf = Vec::new();
            write_value(&mut buf, &value).unwrap();
            assert_eq!(
                String::from_utf8(buf).unwrap(),
                expected,
                "Failed for value: {:?}",
                value
            );
        }
    }

    #[test]
    fn test_write_dict() {
        let mut dict = PdfDict::new();
        dict.set("Type", PdfValue::name("Catalog"));
        dict.set("Count", PdfValue::Integer(3));

        let mut buf = Vec::new();
        write_dict(&mut buf, &dict).unwrap();
        let text = String::from_utf8(buf).unwrap();

        assert!(text.starts_with("<<"));
        assert!(text.ends_with(">>"));
        assert!(text.contains("/Type /Catalog"));
        assert!(text.contains("/Count 3"));
    }

    #[test]
    fn test_write_array() {
        let arr = PdfValue::Array(vec![
            PdfValue::Integer(0),
            PdfValue::Integer(0),
            PdfValue::Real(612.0),
            PdfValue::Real(792.0),
        ]);

        let mut buf = Vec::new();
        write_value(&mut buf, &arr).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "[0 0 612 792]");
    }

    #[test]
    fn test_write_ref() {
        let r = PdfValue::Ref(PdfRef::new(5, 0));
        let mut buf = Vec::new();
        write_value(&mut buf, &r).unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "5 0 R");
    }

    #[test]
    fn test_balanced_page_tree_serialization() {
        let mut doc = PdfDocument::new();
        for _ in 0..60 {
            let page = doc.add_page(612.0, 792.0);
            doc.finalize_page(page, false);
        }

        let built = doc.build();
        let bytes = serialize_document_to_bytes(&built);
        let text = String::from_utf8_lossy(&bytes);

        // Should produce a valid PDF.
        assert!(text.starts_with("%PDF-1.7"));
        assert!(text.contains("%%EOF"));
        assert!(text.contains("/Count 60"));
    }
}
