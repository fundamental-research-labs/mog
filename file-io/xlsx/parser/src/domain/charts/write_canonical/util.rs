use crate::write::xml_writer::XmlWriter;

/// Format an f64 value for OOXML, removing unnecessary trailing zeros.
/// Uses 17 decimal digits — enough to round-trip any IEEE 754 f64 value.
pub(super) fn format_f64(v: f64) -> String {
    if v.fract().abs() < f64::EPSILON && v.abs() < i64::MAX as f64 {
        format!("{}", v as i64)
    } else {
        let s = format!("{:.17}", v);
        let trimmed = s.trim_end_matches('0').trim_end_matches('.');
        trimmed.to_string()
    }
}

pub(super) fn write_raw_xml_if_relationship_safe(w: &mut XmlWriter, raw_xml: &str) -> bool {
    if crate::infra::xml::raw_xml_contains_relationship_attr(raw_xml) {
        return false;
    }
    w.raw_str(raw_xml);
    true
}
