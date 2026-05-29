use crate::infra::scanner::find_tag_simd;
use crate::infra::xml::parse_string_attr_quoted;

use domain_types::domain::external_link::{
    ExternalLink, ExternalLinkExtraRel, ExternalLinkRelationship,
    ExternalLinkRelationshipCurrentness, ExternalLinkRelationshipRole,
};

use super::support::{start_tag_element, start_tag_end_for_attrs};

/// Resolve the file path and alternate URL for an external link.
pub(super) fn resolve_rels(link: &mut ExternalLink, rels_xml: &[u8], book_xml: &[u8]) {
    let primary_r_id = external_book_rid(book_xml);

    if let Some(alt_urls_start) = find_tag_simd(book_xml, b"alternateUrls", 0) {
        let (el, _) = start_tag_element(book_xml, alt_urls_start, book_xml.len());
        link.alternate_urls_drive_id = parse_string_attr_quoted(el, b"driveId");
        link.alternate_urls_item_id = parse_string_attr_quoted(el, b"itemId");
    }

    let alt_r_id = if let Some(alt_start) = find_tag_simd(book_xml, b"absoluteUrl", 0) {
        let (el, _) = start_tag_element(book_xml, alt_start, book_xml.len());
        parse_string_attr_quoted(el, b"r:id")
    } else {
        None
    };

    let rel_r_id = if let Some(rel_start) = find_tag_simd(book_xml, b"relativeUrl", 0) {
        let (el, _) = start_tag_element(book_xml, rel_start, book_xml.len());
        parse_string_attr_quoted(el, b"r:id")
    } else {
        None
    };

    let mut parsed_rels = Vec::new();
    let mut pos = 0;
    let mut rels_order = Vec::new();
    while pos < rels_xml.len() {
        let rel_start = match find_tag_simd(rels_xml, b"Relationship", pos) {
            Some(p) => p,
            None => break,
        };
        let rel_end = start_tag_end_for_attrs(rels_xml, rel_start, rels_xml.len());
        let el = &rels_xml[rel_start..rel_end];

        let id = parse_string_attr_quoted(el, b"Id");
        let target = parse_string_attr_quoted(el, b"Target");
        let rel_type = parse_string_attr_quoted(el, b"Type");
        let target_mode = parse_string_attr_quoted(el, b"TargetMode");

        if let (Some(id), Some(target)) = (id, target) {
            rels_order.push(id.clone());
            let mut roles = Vec::new();
            if primary_r_id.as_deref() == Some(&id) {
                roles.push(ExternalLinkRelationshipRole::ExternalBook);
                link.file_path = Some(target.clone());
                link.file_path_rid = Some(id.clone());
                if let Some(ref rt) = rel_type {
                    if rt != crate::infra::opc::REL_EXTERNAL_LINK_PATH {
                        link.file_path_rel_type = Some(rt.clone());
                    }
                }
            }
            if alt_r_id.as_deref() == Some(&id) {
                roles.push(ExternalLinkRelationshipRole::AlternateAbsoluteUrl);
                link.alternate_url = Some(target.clone());
                link.alternate_url_rid = Some(id.clone());
            }
            if rel_r_id.as_deref() == Some(&id) {
                roles.push(ExternalLinkRelationshipRole::AlternateRelativeUrl);
                link.relative_url = Some(target.clone());
                link.relative_url_rid = Some(id.clone());
            }
            if roles.is_empty() {
                roles.push(ExternalLinkRelationshipRole::ExtraPath);
                link.extra_rels.push(ExternalLinkExtraRel {
                    id: id.clone(),
                    target: target.clone(),
                    rel_type: rel_type.clone().unwrap_or_default(),
                });
            }
            parsed_rels.push(ExternalLinkRelationship {
                source_key: format!("rel:{id}"),
                imported_id_hint: Some(id),
                relationship_type: rel_type.unwrap_or_default(),
                target,
                target_mode,
                order: Some(parsed_rels.len() as u32),
                roles,
                currentness: ExternalLinkRelationshipCurrentness::Current,
            });
        }

        pos = rel_end;
    }

    if rels_order.len() >= 2 && rels_order[0] != "rId1" {
        link.rels_id_order = Some(rels_order);
    }
    link.relationships = parsed_rels;
}

/// Return the r:id from `<externalBook>`, if this external link is a workbook link.
pub fn external_book_rid(book_xml: &[u8]) -> Option<String> {
    let book_start = find_tag_simd(book_xml, b"externalBook", 0)?;
    let book_el_end = start_tag_end_for_attrs(book_xml, book_start, book_xml.len());
    let el = &book_xml[book_start..book_el_end];
    parse_string_attr_quoted(el, b"r:id")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_book_rid_variants() {
        assert_eq!(external_book_rid(b"<externalLink/>"), None);
        assert_eq!(
            external_book_rid(br#"<externalBook r:id="rId1"/>"#).as_deref(),
            Some("rId1")
        );
        assert_eq!(
            external_book_rid(br#"<externalBook r:id='rId2' foo='a>b'/>"#).as_deref(),
            Some("rId2")
        );
        assert_eq!(
            external_book_rid(br#"<externalBook r:id="rId3" foo="unterminated>"#).as_deref(),
            Some("rId3")
        );
    }

    #[test]
    fn resolve_rels_primary_alt_relative_extra_and_order() {
        let book_xml = br#"<externalLink>
            <externalBook r:id='rId2'/>
            <xxl21:alternateUrls driveId="drive" itemId="item">
                <xxl21:absoluteUrl r:id="rId3"/>
                <xxl21:relativeUrl r:id="rId4"/>
            </xxl21:alternateUrls>
        </externalLink>"#;
        let rels_xml = br#"<Relationships>
            <Relationship Id='rId2' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath' Target='file>name.xlsx' TargetMode='External'/>
            <Relationship Id='rId3' Type='alt' Target='https://example.test/book.xlsx'/>
            <Relationship Id='rId4' Type='rel' Target='../book.xlsx'/>
            <Relationship Id='rId5' Type='externalLinkLongPath' Target='long.xlsx'/>
        </Relationships>"#;

        let mut link = ExternalLink::new("1".to_string());
        resolve_rels(&mut link, rels_xml, book_xml);

        assert_eq!(link.file_path.as_deref(), Some("file>name.xlsx"));
        assert_eq!(link.file_path_rid.as_deref(), Some("rId2"));
        assert_eq!(link.alternate_urls_drive_id.as_deref(), Some("drive"));
        assert_eq!(link.alternate_urls_item_id.as_deref(), Some("item"));
        assert_eq!(
            link.alternate_url.as_deref(),
            Some("https://example.test/book.xlsx")
        );
        assert_eq!(link.alternate_url_rid.as_deref(), Some("rId3"));
        assert_eq!(link.relative_url.as_deref(), Some("../book.xlsx"));
        assert_eq!(link.relative_url_rid.as_deref(), Some("rId4"));
        assert_eq!(link.extra_rels.len(), 1);
        assert_eq!(link.extra_rels[0].id, "rId5");
        assert_eq!(link.relationships.len(), 4);
        assert_eq!(
            link.relationships[0].roles,
            vec![ExternalLinkRelationshipRole::ExternalBook]
        );
        assert_eq!(
            link.relationships[0].target_mode.as_deref(),
            Some("External")
        );
        assert_eq!(
            link.relationships[1].roles,
            vec![ExternalLinkRelationshipRole::AlternateAbsoluteUrl]
        );
        assert_eq!(
            link.relationships[2].roles,
            vec![ExternalLinkRelationshipRole::AlternateRelativeUrl]
        );
        assert_eq!(
            link.rels_id_order.as_ref().unwrap(),
            &vec![
                "rId2".to_string(),
                "rId3".to_string(),
                "rId4".to_string(),
                "rId5".to_string()
            ]
        );
    }
}
