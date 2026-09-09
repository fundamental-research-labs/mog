//! Workbook-owned external-link identities and imported OOXML cache payloads.

use std::collections::BTreeMap;

use domain_types::domain::external_link::ExternalLink;
use workbook_types::{LinkId, WorkbookId};

const WORKBOOK_LINK_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x8d58d5b08e445f579b0d70f6d1f9a321);
const WORKBOOK_IMPORT_NAMESPACE: uuid::Uuid =
    uuid::Uuid::from_u128(0x149c13a0b0a75c55a690c3ab8d3a3210);

/// One typed payload per link owns its target, package relationships and caches.
/// These imported values do not grant permission to read an external workbook.
#[derive(Debug, Clone, Default)]
pub(crate) struct ExternalLinks {
    pub workbook_id: Option<WorkbookId>,
    pub links: BTreeMap<LinkId, ExternalLink>,
    /// Unreferenced parts are preserved separately from active dependencies.
    pub orphan_parts: BTreeMap<uuid::Uuid, ExternalLink>,
}

impl ExternalLinks {
    pub(crate) fn import(&mut self, links: &[ExternalLink]) {
        if links.is_empty() {
            return;
        }
        let workbook_id = *self.workbook_id.get_or_insert_with(|| {
            let seed = links
                .iter()
                .map(|link| {
                    link.imported_identity
                        .as_ref()
                        .map(|identity| {
                            format!(
                                "{}:{}:{}",
                                identity.excel_ordinal,
                                identity.workbook_rel_id,
                                identity.part_name
                            )
                        })
                        .unwrap_or_else(|| format!("orphan:{}", link.id))
                })
                .collect::<Vec<_>>()
                .join("\n");
            WorkbookId::from_raw(
                uuid::Uuid::new_v5(&WORKBOOK_IMPORT_NAMESPACE, seed.as_bytes()).as_u128(),
            )
        });
        for link in links {
            if let Some(identity) = &link.imported_identity {
                let seed = format!(
                    "{}:excel:{}:{}:{}",
                    workbook_id.to_uuid_string(),
                    identity.excel_ordinal,
                    identity.workbook_rel_id,
                    identity.part_name
                );
                let id = LinkId::from_raw(
                    uuid::Uuid::new_v5(&WORKBOOK_LINK_NAMESPACE, seed.as_bytes()).as_u128(),
                );
                self.links.insert(id, link.clone());
            } else {
                let part_name = format!("xl/externalLinks/externalLink{}.xml", link.id);
                let seed = format!(
                    "{}:orphan-external-link:{}",
                    workbook_id.to_uuid_string(),
                    part_name
                );
                let id = uuid::Uuid::new_v5(&WORKBOOK_LINK_NAMESPACE, seed.as_bytes());
                self.orphan_parts.insert(id, link.clone());
            }
        }
    }

    pub(crate) fn export(&self) -> Vec<ExternalLink> {
        let mut links: Vec<_> = self.links.values().cloned().collect();
        links.sort_by_key(|link| {
            link.imported_identity
                .as_ref()
                .map(|identity| identity.excel_ordinal)
                .unwrap_or(u32::MAX)
        });
        links
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain_types::domain::external_link::ImportedExternalLinkIdentity;

    fn link(ordinal: u32, part: u32) -> ExternalLink {
        ExternalLink {
            id: part.to_string(),
            file_path: Some(format!("Source{ordinal}.xlsx")),
            imported_identity: Some(ImportedExternalLinkIdentity {
                excel_ordinal: ordinal,
                workbook_rel_id: format!("rId{ordinal}"),
                part_name: format!("externalLinks/externalLink{part}.xml"),
                external_book_rid: Some("rId1".into()),
                target: None,
                target_mode: None,
            }),
            ..Default::default()
        }
    }

    #[test]
    fn imported_external_link_ids_are_stable_and_export_uses_formula_ordinals() {
        let input = vec![link(2, 1), link(1, 9)];
        let mut state = ExternalLinks::default();
        state.import(&input);
        let ids: Vec<_> = state.links.keys().copied().collect();
        let workbook = state.workbook_id;
        state.import(&input);
        assert_eq!(state.links.keys().copied().collect::<Vec<_>>(), ids);
        assert_eq!(state.workbook_id, workbook);
        assert_eq!(state.export(), vec![input[1].clone(), input[0].clone()]);
        let mut independent_reload = ExternalLinks::default();
        independent_reload.import(&input);
        assert_eq!(independent_reload.links, state.links);
    }

    #[test]
    fn orphan_external_parts_retain_typed_payload_without_creating_dependencies() {
        let payload = ExternalLink::dde("7".into(), "service".into(), "topic".into());
        let mut state = ExternalLinks::default();
        state.import(std::slice::from_ref(&payload));
        state.import(std::slice::from_ref(&payload));
        assert_eq!(
            state.orphan_parts.values().collect::<Vec<_>>(),
            vec![&payload]
        );
        assert!(state.links.is_empty());
        assert!(state.export().is_empty());
    }
}
