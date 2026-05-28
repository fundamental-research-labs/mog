use crate::infra::scanner::find_tag_simd;

use domain_types::domain::external_link::{ExternalLink, ExternalLinkType};

use super::legacy::{parse_dde_link, parse_ole_link};
use super::support::{extract_ext_lst_xml, extract_mc_ignorable};
use super::workbook::parse_external_book;

/// Parse an externalLink*.xml file.
pub(super) fn parse_external_link(xml: &[u8], link_id: &str) -> Option<ExternalLink> {
    let mc_ignorable = extract_mc_ignorable(xml);
    let ext_lst_xml = extract_ext_lst_xml(xml);

    if let Some(book_start) = find_tag_simd(xml, b"externalBook", 0) {
        let mut link = parse_external_book(xml, book_start, link_id);
        link.mc_ignorable = mc_ignorable;
        link.ext_lst_xml = ext_lst_xml;
        return Some(link);
    }

    if let Some(dde_start) = find_tag_simd(xml, b"ddeLink", 0) {
        let mut link = parse_dde_link(xml, dde_start, link_id);
        link.mc_ignorable = mc_ignorable;
        link.ext_lst_xml = ext_lst_xml;
        return Some(link);
    }

    if let Some(ole_start) = find_tag_simd(xml, b"oleLink", 0) {
        let mut link = parse_ole_link(xml, ole_start, link_id);
        link.mc_ignorable = mc_ignorable;
        link.ext_lst_xml = ext_lst_xml;
        return Some(link);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty_and_unsupported_xml_returns_none() {
        assert!(parse_external_link(b"", "1").is_none());
        assert!(parse_external_link(b"<invalid>content</invalid>", "1").is_none());
    }

    #[test]
    fn dispatch_order_prefers_workbook_then_dde_then_ole() {
        let xml = br#"<externalLink>
            <externalBook r:id="rId1"/>
            <ddeLink ddeService="Excel" ddeTopic="Topic"/>
            <oleLink progId="Excel.Sheet.12"/>
        </externalLink>"#;

        let link = parse_external_link(xml, "7").unwrap();
        assert_eq!(link.id, "7");
        assert_eq!(link.link_type, ExternalLinkType::Workbook);
    }

    #[test]
    fn mc_ignorable_and_ext_lst_are_preserved_for_all_supported_types() {
        let workbook = br#"<externalLink mc:Ignorable="x15">
            <externalBook r:id="rId1"/>
            <extLst><ext uri="{workbook}"/></extLst>
        </externalLink>"#;
        let dde = br#"<externalLink mc:Ignorable="x15">
            <ddeLink ddeService="Excel" ddeTopic="Topic"/>
            <extLst><ext uri="{dde}"/></extLst>
        </externalLink>"#;
        let ole = br#"<externalLink mc:Ignorable="x15">
            <oleLink progId="Excel.Sheet.12"/>
            <extLst><ext uri="{ole}"/></extLst>
        </externalLink>"#;

        for xml in [workbook.as_slice(), dde.as_slice(), ole.as_slice()] {
            let link = parse_external_link(xml, "1").unwrap();
            assert_eq!(link.mc_ignorable.as_deref(), Some("x15"));
            assert!(link.ext_lst_xml.as_deref().unwrap().starts_with("<extLst>"));
        }
    }

    #[test]
    fn parse_external_book_basic_smoke() {
        let xml = br#"<externalLink>
            <externalBook r:id="rId1">
                <sheetNames><sheetName val="Sheet1"/></sheetNames>
            </externalBook>
        </externalLink>"#;

        let link = parse_external_link(xml, "1").unwrap();
        assert_eq!(link.sheet_names, vec!["Sheet1"]);
    }
}
