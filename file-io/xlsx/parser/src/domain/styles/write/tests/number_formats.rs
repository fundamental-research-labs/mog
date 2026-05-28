use crate::domain::styles::write::StylesWriter;

use super::fixtures::{assert_contains_all, xml_string};

#[test]
fn test_add_num_fmt() {
    let mut writer = StylesWriter::new();

    let id1 = writer.add_num_fmt("#,##0.00");
    assert_eq!(id1, 164);

    let id2 = writer.add_num_fmt("yyyy-mm-dd");
    assert_eq!(id2, 165);

    assert_eq!(writer.num_fmts.len(), 2);
}

#[test]
fn test_num_fmt_deduplication() {
    let mut writer = StylesWriter::new();

    let id1 = writer.add_num_fmt("#,##0.00");
    let id2 = writer.add_num_fmt("#,##0.00");

    assert_eq!(id1, id2);
    assert_eq!(writer.num_fmts.len(), 1);
}

#[test]
fn test_num_fmt_different_codes() {
    let mut writer = StylesWriter::new();

    let id1 = writer.add_num_fmt("#,##0");
    let id2 = writer.add_num_fmt("#,##0.00");

    assert_ne!(id1, id2);
    assert_eq!(writer.num_fmts.len(), 2);
}

#[test]
fn test_to_xml_with_custom_num_fmt() {
    let mut writer = StylesWriter::with_defaults();
    writer.add_num_fmt("#,##0.00");

    let xml = xml_string(&writer);

    assert_contains_all(
        &xml,
        &[
            "<numFmts count=\"1\">",
            "numFmtId=\"164\"",
            "formatCode=\"#,##0.00\"",
        ],
    );
}

#[test]
fn duplicate_format_codes_emit_once_in_xml() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_num_fmt("#,##0.00");
    writer.add_num_fmt("#,##0.00");
    writer.add_num_fmt("yyyy-mm-dd");

    let xml = xml_string(&writer);
    assert!(xml.contains("<numFmts count=\"2\">"));
    assert_eq!(xml.matches("formatCode=\"#,##0.00\"").count(), 1);
    assert_eq!(xml.matches("<numFmt ").count(), 2);
}

#[test]
fn format_code_attributes_are_escaped() {
    let mut writer = StylesWriter::with_defaults();

    writer.add_num_fmt("0 \"A&B\" <test>");

    let xml = xml_string(&writer);
    assert!(xml.contains("formatCode=\"0 &quot;A&amp;B&quot; &lt;test&gt;\""));
}
