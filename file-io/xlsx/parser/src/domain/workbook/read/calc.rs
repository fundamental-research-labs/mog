use super::xml::{extract_attr_value_in_range, find_element_end_simple};
use crate::domain::workbook::types::{CalcPrSettings, CalcSettings};
use crate::infra::scanner::find_tag_simd;

/// Parse the `<calcPr>` element from workbook.xml to extract calculation settings.
pub fn parse_calc_settings(xml: &[u8]) -> CalcPrSettings {
    let calc_start = match find_tag_simd(xml, b"calcPr", 0) {
        Some(pos) => pos,
        None => return CalcSettings::default(),
    };

    let element_end = find_element_end_simple(xml, calc_start).unwrap_or(xml.len());
    let element = &xml[calc_start..element_end.min(xml.len())];

    let parse_u32_attr = |attr: &[u8]| -> Option<u32> {
        extract_attr_value_in_range(element, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<u32>().ok())
    };
    let parse_f64_attr = |attr: &[u8]| -> Option<f64> {
        extract_attr_value_in_range(element, attr)
            .and_then(|v| std::str::from_utf8(v).ok())
            .and_then(|s| s.parse::<f64>().ok())
    };
    let parse_bool_attr = |attr: &[u8]| -> Option<bool> {
        extract_attr_value_in_range(element, attr)
            .map(|v| !v.is_empty() && (v[0] == b'1' || v[0] == b't' || v[0] == b'T'))
    };

    let calc_id = parse_u32_attr(b"calcId=\"");
    let calc_mode = extract_attr_value_in_range(element, b"calcMode=\"")
        .map(ooxml_types::workbook::CalcMode::from_bytes)
        .unwrap_or_default();
    let full_calc_on_load = parse_bool_attr(b"fullCalcOnLoad=\"").unwrap_or(false);
    let ref_mode = extract_attr_value_in_range(element, b"refMode=\"")
        .map(ooxml_types::workbook::RefMode::from_bytes)
        .unwrap_or_default();
    let iterate = parse_bool_attr(b"iterate=\"").unwrap_or(false);
    let iterate_count = parse_u32_attr(b"iterateCount=\"");
    let iterate_delta = parse_f64_attr(b"iterateDelta=\"");
    let full_precision = parse_bool_attr(b"fullPrecision=\"");
    let calc_completed = parse_bool_attr(b"calcCompleted=\"");
    let calc_on_save = parse_bool_attr(b"calcOnSave=\"");
    let concurrent_calc = parse_bool_attr(b"concurrentCalc=\"");
    let concurrent_manual_count = parse_u32_attr(b"concurrentManualCount=\"");
    let force_full_calc = parse_bool_attr(b"forceFullCalc=\"");

    CalcSettings {
        calc_id,
        calc_mode,
        full_calc_on_load,
        ref_mode,
        iterate,
        iterate_count: iterate_count.unwrap_or(100),
        iterate_delta: iterate_delta.unwrap_or(0.001),
        full_precision: full_precision.unwrap_or(true),
        calc_completed: calc_completed.unwrap_or(true),
        calc_on_save: calc_on_save.unwrap_or(true),
        concurrent_calc: concurrent_calc.unwrap_or(true),
        concurrent_manual_count,
        force_full_calc: force_full_calc.unwrap_or(false),
        has_explicit_iterate_count: iterate_count.is_some(),
        has_explicit_iterate_delta: iterate_delta.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_calc_settings_default() {
        let xml = br#"<workbook><calcPr calcId="191029"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(!settings.iterate);
        assert_eq!(settings.iterate_count, 100);
        assert_eq!(settings.iterate_delta, 0.001);
        assert!(!settings.has_explicit_iterate_count);
        assert!(!settings.has_explicit_iterate_delta);
    }

    #[test]
    fn test_parse_calc_settings_no_calc_pr() {
        let xml = br#"<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(!settings.iterate);
    }

    #[test]
    fn test_parse_calc_settings_iterative() {
        let xml = br#"<workbook><calcPr calcId="191029" iterate="1" iterateCount="100" iterateDelta="0.001"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(settings.iterate);
        assert_eq!(settings.iterate_count, 100);
        assert!((settings.iterate_delta - 0.001).abs() < 1e-10);
        assert!(settings.has_explicit_iterate_count);
        assert!(settings.has_explicit_iterate_delta);
    }

    #[test]
    fn test_parse_calc_settings_custom_values() {
        let xml = br#"<workbook><calcPr calcId="191029" iterate="1" iterateCount="200" iterateDelta="0.01"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(settings.iterate);
        assert_eq!(settings.iterate_count, 200);
        assert!((settings.iterate_delta - 0.01).abs() < 1e-10);
    }

    #[test]
    fn test_parse_calc_settings_iterate_false() {
        let xml = br#"<workbook><calcPr calcId="191029" iterate="0"/></workbook>"#;
        let settings = parse_calc_settings(xml);
        assert!(!settings.iterate);
    }
}
