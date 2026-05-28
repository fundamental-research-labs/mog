use crate::domain::external::read::{ExternalLinks, external_book_rid};
use crate::zip::XlsxArchive;
use domain_types::domain::external_link::{ExternalLink, ImportedExternalLinkIdentity};

use super::helpers::{
    external_link_rels_path, external_link_zip_path, parse_external_reference_rids,
};

pub(super) fn parse_external_links(
    archive: &XlsxArchive<'_>,
    workbook_xml: &[u8],
    workbook_relationships: &[ooxml_types::shared::OpcRelationship],
) -> Vec<ExternalLink> {
    let mut links: Vec<ExternalLink> = Vec::new();
    let external_ref_rids = parse_external_reference_rids(workbook_xml);
    let mut seen_parts = std::collections::HashSet::new();

    for (idx, workbook_rel_id) in external_ref_rids.iter().enumerate() {
        let Some(rel) = workbook_relationships
            .iter()
            .find(|rel| rel.id == *workbook_rel_id)
        else {
            continue;
        };
        if rel.rel_type != crate::write::relationships::REL_EXTERNAL_LINK {
            continue;
        }

        let part_name = rel.target.clone();
        let zip_path = external_link_zip_path(&part_name);
        if let Ok(xml_data) = archive.read_file(&zip_path) {
            let excel_ordinal = idx as u32 + 1;
            if let Some(mut link) =
                ExternalLinks::parse_external_link(&xml_data, &excel_ordinal.to_string())
            {
                let rels_path = external_link_rels_path(&zip_path);
                if let Ok(rels_data) = archive.read_file(&rels_path) {
                    ExternalLinks::resolve_rels(&mut link, &rels_data, &xml_data);
                }
                link.imported_identity = Some(ImportedExternalLinkIdentity {
                    excel_ordinal,
                    workbook_rel_id: workbook_rel_id.clone(),
                    part_name: part_name.clone(),
                    external_book_rid: external_book_rid(&xml_data),
                    target: Some(rel.target.clone()),
                    target_mode: rel.target_mode.clone(),
                });
                seen_parts.insert(zip_path);
                links.push(link);
            }
        }
    }

    let mut orphan_entries: Vec<String> = archive
        .entries()
        .iter()
        .filter(|e| {
            e.name.starts_with("xl/externalLinks/externalLink")
                && e.name.ends_with(".xml")
                && !e.name.contains("_rels/")
                && !seen_parts.contains(&e.name)
        })
        .map(|e| e.name.clone())
        .collect();
    orphan_entries.sort();
    for entry_name in orphan_entries {
        if let Ok(xml_data) = archive.read_file(&entry_name) {
            let link_id = entry_name
                .rsplit('/')
                .next()
                .and_then(|file_name| file_name.strip_prefix("externalLink"))
                .and_then(|file_name| file_name.strip_suffix(".xml"))
                .filter(|suffix| !suffix.is_empty())
                .unwrap_or("orphan")
                .to_string();
            if let Some(mut link) = ExternalLinks::parse_external_link(&xml_data, &link_id) {
                let rels_path = external_link_rels_path(&entry_name);
                if let Ok(rels_data) = archive.read_file(&rels_path) {
                    ExternalLinks::resolve_rels(&mut link, &rels_data, &xml_data);
                }
                links.push(link);
            }
        }
    }

    links
}
