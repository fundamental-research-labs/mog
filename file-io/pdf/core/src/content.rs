//! PDF content stream builder — typed operators and serialization.
//!
//! Models all PDF content stream operators as a typed `ContentOp` enum,
//! then serializes them to PDF content stream bytes. Includes validation
//! for balanced state pairs (q/Q, BT/ET, BMC/EMC).

use crate::types::{PdfDict, PdfName, PdfValue};
use std::fmt::Write as FmtWrite;
use thiserror::Error;

/// An item in a TJ (show text array) operation.
/// TJ arrays interleave strings with numeric kerning adjustments.
#[derive(Debug, Clone, PartialEq)]
pub enum TjItem {
    /// A text string (encoded bytes).
    Text(Vec<u8>),
    /// A numeric kerning adjustment (positive = move left in thousandths of text space unit).
    Adjustment(f64),
}

/// A PDF content stream operator.
#[derive(Debug, Clone, PartialEq)]
pub enum ContentOp {
    // --- Graphics state ---
    /// Save graphics state (q).
    SaveState,
    /// Restore graphics state (Q).
    RestoreState,

    // --- Path construction ---
    /// Move to point (m).
    MoveTo(f64, f64),
    /// Line to point (l).
    LineTo(f64, f64),
    /// Cubic Bezier curve (c): control point 1, control point 2, endpoint.
    CurveTo(f64, f64, f64, f64, f64, f64),
    /// Rectangle (re): x, y, width, height.
    Rectangle(f64, f64, f64, f64),
    /// Close path (h).
    ClosePath,

    // --- Path painting ---
    /// Fill path using nonzero winding rule (f).
    Fill,
    /// Stroke path (S).
    Stroke,
    /// Fill and stroke path (B).
    FillAndStroke,
    /// Set clipping path using nonzero winding rule (W n).
    ClipNonZero,
    /// Set clipping path using even-odd rule (W* n).
    ClipEvenOdd,

    // --- Color ---
    /// Set fill color in RGB (rg).
    SetFillColorRGB(f64, f64, f64),
    /// Set stroke color in RGB (RG).
    SetStrokeColorRGB(f64, f64, f64),
    /// Set fill color space (cs).
    SetFillColorSpace(PdfName),
    /// Set stroke color space (CS).
    SetStrokeColorSpace(PdfName),
    /// Set fill color for pattern or special color space (scn).
    SetFillPattern(PdfName),
    /// Set stroke color for pattern or special color space (SCN).
    SetStrokePattern(PdfName),

    // --- Text ---
    /// Begin text object (BT).
    BeginText,
    /// End text object (ET).
    EndText,
    /// Set font and size (Tf).
    SetFont(PdfName, f64),
    /// Move text position (Td).
    TextPosition(f64, f64),
    /// Set text matrix (Tm): a, b, c, d, e, f.
    TextMatrix(f64, f64, f64, f64, f64, f64),
    /// Show text string (Tj).
    ShowText(Vec<u8>),
    /// Show text with kerning adjustments (TJ).
    ShowTextArray(Vec<TjItem>),
    /// Set character spacing (Tc).
    SetCharSpacing(f64),
    /// Set word spacing (Tw).
    SetWordSpacing(f64),
    /// Set text rendering mode (Tr).
    SetTextRenderMode(i32),

    // --- Graphics state parameters ---
    /// Set line width (w).
    SetLineWidth(f64),
    /// Set line dash pattern (d): dash array + phase.
    SetLineDash(Vec<f64>, f64),
    /// Set line cap style (J): 0=butt, 1=round, 2=square.
    SetLineCap(i32),
    /// Set line join style (j): 0=miter, 1=round, 2=bevel.
    SetLineJoin(i32),
    /// Concatenate matrix (cm): a, b, c, d, e, f.
    ConcatMatrix(f64, f64, f64, f64, f64, f64),
    /// Set external graphics state (gs).
    SetExtGState(PdfName),

    // --- Marked content ---
    /// Begin marked content (BDC with properties, BMC without).
    MarkedContentBegin(PdfName, Option<PdfDict>),
    /// End marked content (EMC).
    MarkedContentEnd,

    // --- XObject ---
    /// Paint XObject (Do).
    PaintXObject(PdfName),

    // --- Shading ---
    /// Paint shading (sh).
    PaintShading(PdfName),
}

/// Errors from content stream validation.
#[derive(Debug, Error, PartialEq)]
pub enum ContentStreamError {
    #[error("Unbalanced q/Q: {0} more q than Q")]
    UnbalancedSaveRestore(i32),
    #[error("Unbalanced BT/ET: {0} more BT than ET")]
    UnbalancedTextObject(i32),
    #[error("Unbalanced BMC/BDC/EMC: {0} more begin than end")]
    UnbalancedMarkedContent(i32),
    #[error("Q without matching q at position {0}")]
    RestoreWithoutSave(usize),
    #[error("ET without matching BT at position {0}")]
    EndTextWithoutBegin(usize),
    #[error("EMC without matching BMC/BDC at position {0}")]
    EndMarkedWithoutBegin(usize),
}

/// Validates content stream operators for balanced pairs.
pub fn validate_content_ops(ops: &[ContentOp]) -> Result<(), ContentStreamError> {
    let mut save_depth: i32 = 0;
    let mut text_depth: i32 = 0;
    let mut marked_depth: i32 = 0;

    for (i, op) in ops.iter().enumerate() {
        match op {
            ContentOp::SaveState => save_depth += 1,
            ContentOp::RestoreState => {
                save_depth -= 1;
                if save_depth < 0 {
                    return Err(ContentStreamError::RestoreWithoutSave(i));
                }
            }
            ContentOp::BeginText => text_depth += 1,
            ContentOp::EndText => {
                text_depth -= 1;
                if text_depth < 0 {
                    return Err(ContentStreamError::EndTextWithoutBegin(i));
                }
            }
            ContentOp::MarkedContentBegin(_, _) => marked_depth += 1,
            ContentOp::MarkedContentEnd => {
                marked_depth -= 1;
                if marked_depth < 0 {
                    return Err(ContentStreamError::EndMarkedWithoutBegin(i));
                }
            }
            _ => {}
        }
    }

    if save_depth != 0 {
        return Err(ContentStreamError::UnbalancedSaveRestore(save_depth));
    }
    if text_depth != 0 {
        return Err(ContentStreamError::UnbalancedTextObject(text_depth));
    }
    if marked_depth != 0 {
        return Err(ContentStreamError::UnbalancedMarkedContent(marked_depth));
    }

    Ok(())
}

/// Builds a PDF content stream from a sequence of typed operators.
pub struct ContentStreamBuilder<'a> {
    ops: &'a [ContentOp],
}

impl<'a> ContentStreamBuilder<'a> {
    pub fn new(ops: &'a [ContentOp]) -> Self {
        Self { ops }
    }

    /// Serialize the content operators to PDF content stream bytes.
    pub fn build(&self) -> Vec<u8> {
        let mut buf = String::new();

        for op in self.ops {
            self.write_op(&mut buf, op);
            buf.push('\n');
        }

        buf.into_bytes()
    }

    /// Validate and build. Returns an error if operators are unbalanced.
    pub fn validate_and_build(&self) -> Result<Vec<u8>, ContentStreamError> {
        validate_content_ops(self.ops)?;
        Ok(self.build())
    }

    fn write_op(&self, buf: &mut String, op: &ContentOp) {
        match op {
            // Graphics state
            ContentOp::SaveState => buf.push('q'),
            ContentOp::RestoreState => buf.push('Q'),

            // Path construction
            ContentOp::MoveTo(x, y) => {
                write!(buf, "{} {} m", format_real(*x), format_real(*y)).unwrap();
            }
            ContentOp::LineTo(x, y) => {
                write!(buf, "{} {} l", format_real(*x), format_real(*y)).unwrap();
            }
            ContentOp::CurveTo(x1, y1, x2, y2, x3, y3) => {
                write!(
                    buf,
                    "{} {} {} {} {} {} c",
                    format_real(*x1),
                    format_real(*y1),
                    format_real(*x2),
                    format_real(*y2),
                    format_real(*x3),
                    format_real(*y3)
                )
                .unwrap();
            }
            ContentOp::Rectangle(x, y, w, h) => {
                write!(
                    buf,
                    "{} {} {} {} re",
                    format_real(*x),
                    format_real(*y),
                    format_real(*w),
                    format_real(*h)
                )
                .unwrap();
            }
            ContentOp::ClosePath => buf.push('h'),

            // Path painting
            ContentOp::Fill => buf.push('f'),
            ContentOp::Stroke => buf.push('S'),
            ContentOp::FillAndStroke => buf.push('B'),
            ContentOp::ClipNonZero => buf.push_str("W n"),
            ContentOp::ClipEvenOdd => buf.push_str("W* n"),

            // Color
            ContentOp::SetFillColorRGB(r, g, b) => {
                write!(
                    buf,
                    "{} {} {} rg",
                    format_real(*r),
                    format_real(*g),
                    format_real(*b)
                )
                .unwrap();
            }
            ContentOp::SetStrokeColorRGB(r, g, b) => {
                write!(
                    buf,
                    "{} {} {} RG",
                    format_real(*r),
                    format_real(*g),
                    format_real(*b)
                )
                .unwrap();
            }
            ContentOp::SetFillColorSpace(name) => {
                write!(buf, "/{} cs", name.as_str()).unwrap();
            }
            ContentOp::SetStrokeColorSpace(name) => {
                write!(buf, "/{} CS", name.as_str()).unwrap();
            }
            ContentOp::SetFillPattern(name) => {
                write!(buf, "/{} scn", name.as_str()).unwrap();
            }
            ContentOp::SetStrokePattern(name) => {
                write!(buf, "/{} SCN", name.as_str()).unwrap();
            }

            // Text
            ContentOp::BeginText => buf.push_str("BT"),
            ContentOp::EndText => buf.push_str("ET"),
            ContentOp::SetFont(name, size) => {
                write!(buf, "/{} {} Tf", name.as_str(), format_real(*size)).unwrap();
            }
            ContentOp::TextPosition(tx, ty) => {
                write!(buf, "{} {} Td", format_real(*tx), format_real(*ty)).unwrap();
            }
            ContentOp::TextMatrix(a, b, c, d, e, f) => {
                write!(
                    buf,
                    "{} {} {} {} {} {} Tm",
                    format_real(*a),
                    format_real(*b),
                    format_real(*c),
                    format_real(*d),
                    format_real(*e),
                    format_real(*f)
                )
                .unwrap();
            }
            ContentOp::ShowText(text) => {
                buf.push('(');
                write_escaped_string(buf, text);
                buf.push_str(") Tj");
            }
            ContentOp::ShowTextArray(items) => {
                buf.push('[');
                for item in items {
                    match item {
                        TjItem::Text(text) => {
                            buf.push('(');
                            write_escaped_string(buf, text);
                            buf.push(')');
                        }
                        TjItem::Adjustment(adj) => {
                            write!(buf, "{}", format_real(*adj)).unwrap();
                        }
                    }
                    buf.push(' ');
                }
                buf.push_str("] TJ");
            }
            ContentOp::SetCharSpacing(spacing) => {
                write!(buf, "{} Tc", format_real(*spacing)).unwrap();
            }
            ContentOp::SetWordSpacing(spacing) => {
                write!(buf, "{} Tw", format_real(*spacing)).unwrap();
            }
            ContentOp::SetTextRenderMode(mode) => {
                write!(buf, "{} Tr", mode).unwrap();
            }

            // Graphics state parameters
            ContentOp::SetLineWidth(w) => {
                write!(buf, "{} w", format_real(*w)).unwrap();
            }
            ContentOp::SetLineDash(array, phase) => {
                buf.push('[');
                for (i, v) in array.iter().enumerate() {
                    if i > 0 {
                        buf.push(' ');
                    }
                    write!(buf, "{}", format_real(*v)).unwrap();
                }
                write!(buf, "] {} d", format_real(*phase)).unwrap();
            }
            ContentOp::SetLineCap(cap) => {
                write!(buf, "{} J", cap).unwrap();
            }
            ContentOp::SetLineJoin(join) => {
                write!(buf, "{} j", join).unwrap();
            }
            ContentOp::ConcatMatrix(a, b, c, d, e, f) => {
                write!(
                    buf,
                    "{} {} {} {} {} {} cm",
                    format_real(*a),
                    format_real(*b),
                    format_real(*c),
                    format_real(*d),
                    format_real(*e),
                    format_real(*f)
                )
                .unwrap();
            }
            ContentOp::SetExtGState(name) => {
                write!(buf, "/{} gs", name.as_str()).unwrap();
            }

            // Marked content
            ContentOp::MarkedContentBegin(tag, props) => {
                if let Some(dict) = props {
                    write!(buf, "/{} ", tag.as_str()).unwrap();
                    write_inline_dict(buf, dict);
                    buf.push_str(" BDC");
                } else {
                    write!(buf, "/{} BMC", tag.as_str()).unwrap();
                }
            }
            ContentOp::MarkedContentEnd => buf.push_str("EMC"),

            // XObject
            ContentOp::PaintXObject(name) => {
                write!(buf, "/{} Do", name.as_str()).unwrap();
            }

            // Shading
            ContentOp::PaintShading(name) => {
                write!(buf, "/{} sh", name.as_str()).unwrap();
            }
        }
    }
}

/// Write a PDF inline dictionary (used in content streams for marked content).
fn write_inline_dict(buf: &mut String, dict: &PdfDict) {
    buf.push_str("<< ");
    for (key, value) in dict.iter() {
        write!(buf, "/{} ", key.as_str()).unwrap();
        write_inline_value(buf, value);
        buf.push(' ');
    }
    buf.push_str(">>");
}

/// Write a PDF value inline (for content stream dictionaries).
fn write_inline_value(buf: &mut String, value: &PdfValue) {
    match value {
        PdfValue::Boolean(b) => write!(buf, "{}", if *b { "true" } else { "false" }).unwrap(),
        PdfValue::Integer(i) => write!(buf, "{}", i).unwrap(),
        PdfValue::Real(r) => write!(buf, "{}", format_real(*r)).unwrap(),
        PdfValue::Name(n) => write!(buf, "/{}", n.as_str()).unwrap(),
        PdfValue::Str(s) => {
            buf.push('(');
            write_escaped_string(buf, s);
            buf.push(')');
        }
        PdfValue::Ref(r) => write!(buf, "{} {} R", r.obj_num, r.gen_num).unwrap(),
        PdfValue::Null => buf.push_str("null"),
        PdfValue::Array(arr) => {
            buf.push('[');
            for (i, v) in arr.iter().enumerate() {
                if i > 0 {
                    buf.push(' ');
                }
                write_inline_value(buf, v);
            }
            buf.push(']');
        }
        PdfValue::Dict(d) => write_inline_dict(buf, d),
        PdfValue::Stream(_) => {
            // Streams cannot appear inline in content streams.
            buf.push_str("null");
        }
    }
}

/// Escape a byte string for PDF literal string syntax.
/// Escapes: `\`, `(`, `)`, and control characters.
fn write_escaped_string(buf: &mut String, data: &[u8]) {
    for &byte in data {
        match byte {
            b'\\' => buf.push_str("\\\\"),
            b'(' => buf.push_str("\\("),
            b')' => buf.push_str("\\)"),
            b'\n' => buf.push_str("\\n"),
            b'\r' => buf.push_str("\\r"),
            b'\t' => buf.push_str("\\t"),
            b'\x08' => buf.push_str("\\b"),
            b'\x0c' => buf.push_str("\\f"),
            0x00..=0x1f => {
                // Other control chars: octal escape.
                write!(buf, "\\{:03o}", byte).unwrap();
            }
            _ => buf.push(byte as char),
        }
    }
}

/// Format a f64 for PDF output. Removes unnecessary trailing zeros.
/// PDF viewers are sensitive to exact number formatting.
fn format_real(v: f64) -> String {
    if v == v.floor() && v.abs() < i64::MAX as f64 {
        // Integer value — write without decimal point.
        format!("{}", v as i64)
    } else {
        // Use enough precision but strip trailing zeros.
        let s = format!("{:.6}", v);
        let s = s.trim_end_matches('0');
        let s = s.trim_end_matches('.');
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_real_integer() {
        assert_eq!(format_real(72.0), "72");
        assert_eq!(format_real(0.0), "0");
        assert_eq!(format_real(-10.0), "-10");
    }

    #[test]
    fn test_format_real_decimal() {
        assert_eq!(format_real(1.5), "1.5");
        assert_eq!(format_real(0.001), "0.001");
        assert_eq!(format_real(3.14159), "3.14159");
    }

    #[test]
    fn test_content_stream_text() {
        let ops = vec![
            ContentOp::BeginText,
            ContentOp::SetFont(PdfName::new("F1"), 12.0),
            ContentOp::TextPosition(72.0, 720.0),
            ContentOp::ShowText(b"Hello, World!".to_vec()),
            ContentOp::EndText,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("BT"));
        assert!(text.contains("/F1 12 Tf"));
        assert!(text.contains("72 720 Td"));
        assert!(text.contains("(Hello, World!) Tj"));
        assert!(text.contains("ET"));
    }

    #[test]
    fn test_content_stream_graphics() {
        let ops = vec![
            ContentOp::SaveState,
            ContentOp::SetFillColorRGB(1.0, 0.0, 0.0),
            ContentOp::Rectangle(10.0, 10.0, 100.0, 50.0),
            ContentOp::Fill,
            ContentOp::RestoreState,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("q"));
        assert!(text.contains("1 0 0 rg"));
        assert!(text.contains("10 10 100 50 re"));
        assert!(text.contains("f"));
        assert!(text.contains("Q"));
    }

    #[test]
    fn test_content_stream_path() {
        let ops = vec![
            ContentOp::MoveTo(0.0, 0.0),
            ContentOp::LineTo(100.0, 0.0),
            ContentOp::LineTo(100.0, 100.0),
            ContentOp::ClosePath,
            ContentOp::Stroke,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("0 0 m"));
        assert!(text.contains("100 0 l"));
        assert!(text.contains("100 100 l"));
        assert!(text.contains("h"));
        assert!(text.contains("S"));
    }

    #[test]
    fn test_content_stream_curve() {
        let ops = vec![ContentOp::CurveTo(10.0, 20.0, 30.0, 40.0, 50.0, 60.0)];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("10 20 30 40 50 60 c"));
    }

    #[test]
    fn test_content_stream_line_dash() {
        let ops = vec![ContentOp::SetLineDash(vec![3.0, 5.0], 0.0)];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("[3 5] 0 d"));
    }

    #[test]
    fn test_content_stream_concat_matrix() {
        let ops = vec![ContentOp::ConcatMatrix(1.0, 0.0, 0.0, 1.0, 100.0, 200.0)];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("1 0 0 1 100 200 cm"));
    }

    #[test]
    fn test_content_stream_text_matrix() {
        let ops = vec![ContentOp::TextMatrix(1.0, 0.0, 0.0, 1.0, 72.0, 700.0)];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("1 0 0 1 72 700 Tm"));
    }

    #[test]
    fn test_content_stream_show_text_array() {
        let ops = vec![ContentOp::ShowTextArray(vec![
            TjItem::Text(b"Hello".to_vec()),
            TjItem::Adjustment(-100.0),
            TjItem::Text(b"World".to_vec()),
        ])];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("[(Hello) -100 (World) ] TJ"));
    }

    #[test]
    fn test_content_stream_marked_content_bmc() {
        let ops = vec![
            ContentOp::MarkedContentBegin(PdfName::new("Artifact"), None),
            ContentOp::MarkedContentEnd,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("/Artifact BMC"));
        assert!(text.contains("EMC"));
    }

    #[test]
    fn test_content_stream_marked_content_bdc() {
        let mut props = PdfDict::new();
        props.set("MCID", PdfValue::Integer(0));

        let ops = vec![
            ContentOp::MarkedContentBegin(PdfName::new("TD"), Some(props)),
            ContentOp::MarkedContentEnd,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("/TD << /MCID 0 >> BDC"));
        assert!(text.contains("EMC"));
    }

    #[test]
    fn test_content_stream_xobject() {
        let ops = vec![ContentOp::PaintXObject(PdfName::new("Im1"))];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("/Im1 Do"));
    }

    #[test]
    fn test_content_stream_shading() {
        let ops = vec![ContentOp::PaintShading(PdfName::new("Sh1"))];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("/Sh1 sh"));
    }

    #[test]
    fn test_content_stream_ext_gstate() {
        let ops = vec![ContentOp::SetExtGState(PdfName::new("GS1"))];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("/GS1 gs"));
    }

    #[test]
    fn test_content_stream_color_spaces() {
        let ops = vec![
            ContentOp::SetFillColorSpace(PdfName::new("CS1")),
            ContentOp::SetStrokeColorSpace(PdfName::new("CS2")),
            ContentOp::SetFillPattern(PdfName::new("P1")),
            ContentOp::SetStrokePattern(PdfName::new("P2")),
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("/CS1 cs"));
        assert!(text.contains("/CS2 CS"));
        assert!(text.contains("/P1 scn"));
        assert!(text.contains("/P2 SCN"));
    }

    #[test]
    fn test_content_stream_text_params() {
        let ops = vec![
            ContentOp::SetCharSpacing(0.5),
            ContentOp::SetWordSpacing(1.0),
            ContentOp::SetTextRenderMode(2),
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("0.5 Tc"));
        assert!(text.contains("1 Tw"));
        assert!(text.contains("2 Tr"));
    }

    #[test]
    fn test_content_stream_line_params() {
        let ops = vec![
            ContentOp::SetLineWidth(2.0),
            ContentOp::SetLineCap(1),
            ContentOp::SetLineJoin(2),
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("2 w"));
        assert!(text.contains("1 J"));
        assert!(text.contains("2 j"));
    }

    #[test]
    fn test_content_stream_clip() {
        let ops = vec![
            ContentOp::Rectangle(0.0, 0.0, 100.0, 100.0),
            ContentOp::ClipNonZero,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("W n"));
    }

    #[test]
    fn test_content_stream_clip_even_odd() {
        let ops = vec![
            ContentOp::Rectangle(0.0, 0.0, 100.0, 100.0),
            ContentOp::ClipEvenOdd,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("W* n"));
    }

    #[test]
    fn test_content_stream_fill_and_stroke() {
        let ops = vec![
            ContentOp::Rectangle(10.0, 10.0, 80.0, 80.0),
            ContentOp::FillAndStroke,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("B"));
    }

    #[test]
    fn test_escaped_string_in_content() {
        let ops = vec![
            ContentOp::BeginText,
            ContentOp::ShowText(b"Hello (World) \\test".to_vec()),
            ContentOp::EndText,
        ];

        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        let text = String::from_utf8(bytes).unwrap();

        assert!(text.contains("(Hello \\(World\\) \\\\test) Tj"));
    }

    // --- Validation tests ---

    #[test]
    fn test_validate_balanced() {
        let ops = vec![
            ContentOp::SaveState,
            ContentOp::BeginText,
            ContentOp::EndText,
            ContentOp::RestoreState,
        ];
        assert!(validate_content_ops(&ops).is_ok());
    }

    #[test]
    fn test_validate_unbalanced_save_restore() {
        let ops = vec![ContentOp::SaveState, ContentOp::SaveState];
        let err = validate_content_ops(&ops).unwrap_err();
        assert!(matches!(err, ContentStreamError::UnbalancedSaveRestore(2)));
    }

    #[test]
    fn test_validate_restore_without_save() {
        let ops = vec![ContentOp::RestoreState];
        let err = validate_content_ops(&ops).unwrap_err();
        assert!(matches!(err, ContentStreamError::RestoreWithoutSave(0)));
    }

    #[test]
    fn test_validate_unbalanced_text() {
        let ops = vec![ContentOp::BeginText];
        let err = validate_content_ops(&ops).unwrap_err();
        assert!(matches!(err, ContentStreamError::UnbalancedTextObject(1)));
    }

    #[test]
    fn test_validate_end_text_without_begin() {
        let ops = vec![ContentOp::EndText];
        let err = validate_content_ops(&ops).unwrap_err();
        assert!(matches!(err, ContentStreamError::EndTextWithoutBegin(0)));
    }

    #[test]
    fn test_validate_unbalanced_marked_content() {
        let ops = vec![ContentOp::MarkedContentBegin(PdfName::new("Tag"), None)];
        let err = validate_content_ops(&ops).unwrap_err();
        assert!(matches!(
            err,
            ContentStreamError::UnbalancedMarkedContent(1)
        ));
    }

    #[test]
    fn test_validate_emc_without_bmc() {
        let ops = vec![ContentOp::MarkedContentEnd];
        let err = validate_content_ops(&ops).unwrap_err();
        assert!(matches!(err, ContentStreamError::EndMarkedWithoutBegin(0)));
    }

    #[test]
    fn test_validate_and_build_ok() {
        let ops = vec![ContentOp::SaveState, ContentOp::RestoreState];
        let result = ContentStreamBuilder::new(&ops).validate_and_build();
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_and_build_err() {
        let ops = vec![ContentOp::SaveState];
        let result = ContentStreamBuilder::new(&ops).validate_and_build();
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_content_stream() {
        let ops: Vec<ContentOp> = vec![];
        let builder = ContentStreamBuilder::new(&ops);
        let bytes = builder.build();
        assert!(bytes.is_empty());
    }
}
