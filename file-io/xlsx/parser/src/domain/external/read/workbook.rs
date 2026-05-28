use crate::infra::scanner::{find_closing_tag, find_tag_simd};
use crate::infra::xml::{parse_string_attr_quoted, parse_u32_attr};

use domain_types::domain::external_link::{ExternalDefinedName, ExternalLink, ExternalLinkType};

use super::cache::parse_sheet_data_set;
use super::support::start_tag_element;

/// Parse an external workbook reference.
pub(super) fn parse_external_book(xml: &[u8], start: usize, link_id: &str) -> ExternalLink {
    let mut link = ExternalLink::new(link_id.to_string());
    link.link_type = ExternalLinkType::Workbook;

    let book_end = find_closing_tag(xml, b"externalBook", start).unwrap_or(xml.len());

    if let Some(names_start) = find_tag_simd(xml, b"sheetNames", start) {
        if names_start < book_end {
            let names_end = find_closing_tag(xml, b"sheetNames", names_start).unwrap_or(book_end);
            parse_sheet_names(xml, names_start, names_end, &mut link.sheet_names);
        }
    }

    if let Some(def_start) = find_tag_simd(xml, b"definedNames", start) {
        if def_start < book_end {
            let def_end = find_closing_tag(xml, b"definedNames", def_start).unwrap_or(book_end);
            parse_defined_names(xml, def_start, def_end, &mut link.defined_names);
        }
    }

    if let Some(data_start) = find_tag_simd(xml, b"sheetDataSet", start) {
        if data_start < book_end {
            let data_end = find_closing_tag(xml, b"sheetDataSet", data_start).unwrap_or(book_end);
            parse_sheet_data_set(
                xml,
                data_start,
                data_end,
                &mut link.cache_values,
                &mut link.sheet_data_ids,
                &mut link.refresh_error_sheet_ids,
            );
        }
    }

    link
}

fn parse_sheet_names(xml: &[u8], start: usize, end: usize, names: &mut Vec<String>) {
    let mut pos = start;

    while pos < end {
        let name_pos = match find_tag_simd(xml, b"sheetName", pos) {
            Some(p) if p < end => p,
            _ => break,
        };

        let (element, element_end) = start_tag_element(xml, name_pos, end);
        if let Some(val) = parse_string_attr_quoted(element, b"val") {
            names.push(val);
        }

        pos = element_end;
    }
}

fn parse_defined_names(xml: &[u8], start: usize, end: usize, names: &mut Vec<ExternalDefinedName>) {
    let mut pos = start;

    while pos < end {
        let def_pos = match find_tag_simd(xml, b"definedName", pos) {
            Some(p) if p < end => p,
            _ => break,
        };

        let (element, element_end) = start_tag_element(xml, def_pos, end);
        if let Some(name) = parse_string_attr_quoted(element, b"name") {
            let refers_to = parse_string_attr_quoted(element, b"refersTo");
            let sheet_id = parse_u32_attr(element, b"sheetId=\"");
            names.push(ExternalDefinedName::with_details(name, refers_to, sheet_id));
        }

        pos = element_end;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sheet_names_and_defined_names() {
        let xml = br#"<externalBook r:id="rId1">
            <sheetNames>
                <sheetName val="Q1 &amp; Q2"/>
                <sheetName val='Raw>Gt'/>
            </sheetNames>
            <definedNames>
                <definedName name="MyRange" refersTo="Q1 &amp; Q2!$A$1:$B$10"/>
                <definedName name='Total>One' sheetId="0" refersTo='Raw>Gt!$C$1'/>
            </definedNames>
        </externalBook>"#;

        let link = parse_external_book(xml, 0, "1");
        assert_eq!(link.sheet_names, vec!["Q1 & Q2", "Raw>Gt"]);
        assert_eq!(link.defined_names.len(), 2);
        assert_eq!(link.defined_names[0].name, "MyRange");
        assert_eq!(
            link.defined_names[0].refers_to.as_deref(),
            Some("Q1 & Q2!$A$1:$B$10")
        );
        assert_eq!(link.defined_names[1].name, "Total>One");
        assert_eq!(link.defined_names[1].sheet_id, Some(0));
    }
}
