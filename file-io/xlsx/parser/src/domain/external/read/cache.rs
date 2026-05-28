use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml::{parse_string_attr_quoted, parse_u32_attr};

use domain_types::domain::external_link::{CachedValue, ExternalCacheValue};

use super::support::start_tag_element;
use super::value::parse_cached_value;

/// Parse cached sheet data from <sheetDataSet> element.
pub(super) fn parse_sheet_data_set(
    xml: &[u8],
    start: usize,
    end: usize,
    values: &mut Vec<ExternalCacheValue>,
    sheet_data_ids: &mut Vec<u32>,
    refresh_error_ids: &mut Vec<u32>,
) {
    let mut pos = start;

    while pos < end {
        let sheet_pos = match find_tag_simd(xml, b"sheetData", pos) {
            Some(p) if p < end => p,
            _ => break,
        };

        let (element, element_end) = start_tag_element(xml, sheet_pos, end);
        let is_self_closing = element.last() == Some(&b'/') || element.ends_with(b"/>");
        let sheet_end = if is_self_closing {
            element_end
        } else {
            find_closing_tag(xml, b"sheetData", sheet_pos).unwrap_or(end)
        };

        let sheet_id = parse_u32_attr(element, b"sheetId=\"").unwrap_or(0);
        sheet_data_ids.push(sheet_id);

        if element.windows(13).any(|w| w == b"refreshError=") {
            refresh_error_ids.push(sheet_id);
        }

        if !is_self_closing {
            parse_sheet_cells(xml, element_end, sheet_end, sheet_id, values);
        }

        pos = if is_self_closing {
            sheet_end
        } else {
            sheet_end + 1
        };
    }
}

/// Parse cells within a <sheetData> element.
fn parse_sheet_cells(
    xml: &[u8],
    start: usize,
    end: usize,
    sheet_id: u32,
    values: &mut Vec<ExternalCacheValue>,
) {
    let mut pos = start;
    let mut current_row: Option<u32> = None;

    while pos < end {
        let row_pos = find_tag_simd(xml, b"row", pos).filter(|&p| p < end);
        let cell_pos = find_tag_simd(xml, b"cell", pos).filter(|&p| p < end);

        match (row_pos, cell_pos) {
            (Some(rp), Some(cp)) if rp < cp => {
                let (row_el, row_el_end) = start_tag_element(xml, rp, end);
                current_row = parse_u32_attr(row_el, b"r=\"");

                if row_el.ends_with(b"/>") {
                    pos = row_el_end;
                    current_row = None;
                } else {
                    pos = row_el_end;
                }
            }
            (_, Some(cp)) => {
                let (element, element_end) = start_tag_element(xml, cp, end);
                let is_self_closing_cell =
                    element_end > 1 && xml.get(element_end - 2) == Some(&b'/');
                let cell_end = if is_self_closing_cell {
                    element_end.saturating_sub(1)
                } else {
                    find_closing_tag(xml, b"cell", cp)
                        .or_else(|| {
                            find_tag_simd(xml, b"cell", cp + 5).map(|p| p.saturating_sub(1))
                        })
                        .unwrap_or(end)
                };

                if let Some(cell_ref) = parse_string_attr_quoted(element, b"r") {
                    let cell_type = parse_string_attr_quoted(element, b"t");
                    let (value, raw_value, has_preserve_space) =
                        parse_cell_value(xml, element_end, cell_end, cell_type.as_deref());

                    let mut cv = ExternalCacheValue::new(sheet_id, cell_ref, value);
                    cv.row = current_row;
                    cv.raw_value = raw_value;
                    cv.preserve_space = has_preserve_space;
                    values.push(cv);
                }

                pos = cell_end + 1;
            }
            (Some(rp), None) => {
                let (_, row_el_end) = start_tag_element(xml, rp, end);
                pos = row_el_end;
            }
            (None, None) => break,
        }

        if let Some(row) = current_row {
            let closing = find_closing_tag(xml, b"row", pos.saturating_sub(10));
            if let Some(close_pos) = closing {
                if close_pos < pos {
                    current_row = None;
                    let _ = row;
                }
            }
        }
    }
}

fn parse_cell_value(
    xml: &[u8],
    element_end: usize,
    cell_end: usize,
    cell_type: Option<&str>,
) -> (CachedValue, Option<String>, bool) {
    let Some(v_start) = find_tag_simd(xml, b"v", element_end) else {
        return (CachedValue::Empty, None, false);
    };
    if v_start >= cell_end {
        return (CachedValue::Empty, None, false);
    }

    let v_gt = find_gt_simd(xml, v_start).unwrap_or(cell_end);
    let is_self_closing = v_gt > 0 && xml.get(v_gt - 1) == Some(&b'/');
    if is_self_closing {
        let val = if cell_type == Some("str") {
            CachedValue::String(String::new())
        } else {
            CachedValue::Empty
        };
        return (val, None, false);
    }

    let v_end = find_closing_tag(xml, b"v", v_start).unwrap_or(cell_end);
    let v_content_start = v_gt + 1;
    let v_tag = &xml[v_start..v_content_start];
    let has_space_preserve = v_tag.windows(9).any(|w| w == b"xml:space");
    let content = &xml[v_content_start..v_end];
    let (val, raw) = parse_cached_value(content, cell_type);
    (val, raw, has_space_preserve)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_cache(xml: &[u8]) -> (Vec<ExternalCacheValue>, Vec<u32>, Vec<u32>) {
        let mut values = Vec::new();
        let mut sheet_ids = Vec::new();
        let mut refresh_ids = Vec::new();
        parse_sheet_data_set(
            xml,
            0,
            xml.len(),
            &mut values,
            &mut sheet_ids,
            &mut refresh_ids,
        );
        (values, sheet_ids, refresh_ids)
    }

    #[test]
    fn parse_multiple_sheets_and_document_order() {
        let xml = br#"<sheetDataSet>
            <sheetData sheetId="0"><cell r="A1"><v>1</v></cell></sheetData>
            <sheetData sheetId="1"><cell r="A1"><v>2</v></cell></sheetData>
        </sheetDataSet>"#;

        let (values, sheet_ids, _) = parse_cache(xml);
        assert_eq!(sheet_ids, vec![0, 1]);
        assert_eq!(values.len(), 2);
        assert_eq!(values[0].sheet_id, 0);
        assert_eq!(values[1].sheet_id, 1);
    }

    #[test]
    fn refresh_error_and_self_closing_sheet_data_are_preserved() {
        let xml = br#"<sheetDataSet>
            <sheetData sheetId="3" refreshError="1"/>
            <sheetData sheetId="4" refreshError="1"><cell r="A1"/></sheetData>
        </sheetDataSet>"#;

        let (values, sheet_ids, refresh_ids) = parse_cache(xml);
        assert_eq!(sheet_ids, vec![3, 4]);
        assert_eq!(refresh_ids, vec![3, 4]);
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].value, CachedValue::Empty);
    }

    #[test]
    fn preserve_space_and_raw_numeric_value_are_preserved() {
        let xml = br#"<sheetDataSet>
            <sheetData sheetId="0"><cell r="A1"><v xml:space="preserve"> 42.50 </v></cell></sheetData>
        </sheetDataSet>"#;

        let (values, _, _) = parse_cache(xml);
        assert_eq!(values[0].value, CachedValue::Number(42.5));
        assert_eq!(values[0].raw_value.as_deref(), Some("42.50"));
        assert!(values[0].preserve_space);
    }

    #[test]
    fn self_closing_string_value_is_empty_string() {
        let xml = br#"<sheetDataSet>
            <sheetData sheetId="0"><cell r="A1" t="str"><v/></cell></sheetData>
        </sheetDataSet>"#;

        let (values, _, _) = parse_cache(xml);
        assert_eq!(values[0].value, CachedValue::String(String::new()));
    }
}
