use crate::write::xml_writer::XmlWriter;
use std::collections::HashSet;

use super::attrs::{RELATIONSHIPS_NS, SPREADSHEET_NS};
use super::writer::WorkbookWriter;
use domain_types::{WorkbookXmlChildKind, WorkbookXmlFallbackAction};

pub(super) fn write_workbook(writer: &WorkbookWriter) -> Vec<u8> {
    let mut w = XmlWriter::new();

    w.write_declaration();

    w.start_element("workbook")
        .attr("xmlns", SPREADSHEET_NS)
        .attr("xmlns:r", RELATIONSHIPS_NS);
    if let Some(conformance) = workbook_conformance_to_emit(writer) {
        w.attr("conformance", conformance);
    }

    if let Some(ref ns) = writer.root_namespaces {
        use crate::write::mc_builder::McIgnorableBuilder;

        let mut mc_builder = McIgnorableBuilder::new();
        mc_builder.add_from_namespace_map(ns);

        if !mc_builder.is_empty() {
            w.attr(
                "xmlns:mc",
                "http://schemas.openxmlformats.org/markup-compatibility/2006",
            );
            if let Some(ignorable) = mc_builder.build() {
                w.attr("mc:Ignorable", &ignorable);
            }
        }

        for decl in ns.all() {
            if let Some(ref prefix) = decl.prefix {
                if prefix != "r" && prefix != "mc" {
                    w.attr(&format!("xmlns:{}", prefix), &decl.uri);
                }
            }
        }
    }

    w.end_attrs();

    write_workbook_children(&mut w, writer);

    w.end_element("workbook");

    w.finish()
}

fn write_workbook_children(w: &mut XmlWriter, writer: &WorkbookWriter) {
    let mut emitted = HashSet::new();

    if let Some(fidelity) = writer.workbook_xml_fidelity.as_ref() {
        for slot in &fidelity.slots {
            if !matches!(
                slot.fallback_action,
                WorkbookXmlFallbackAction::Regenerate | WorkbookXmlFallbackAction::Preserve
            ) {
                continue;
            }
            if emitted.contains(&slot.kind) && is_singleton_child(slot.kind) {
                continue;
            }

            let did_emit = match slot.kind {
                WorkbookXmlChildKind::FunctionGroups
                | WorkbookXmlChildKind::OleSize
                | WorkbookXmlChildKind::SmartTagPr
                | WorkbookXmlChildKind::SmartTagTypes
                | WorkbookXmlChildKind::FileRecoveryPr
                | WorkbookXmlChildKind::WebPublishObjects => slot
                    .payload_id
                    .as_deref()
                    .and_then(|payload_id| raw_child_xml(fidelity, payload_id))
                    .map(|xml| {
                        let xml = String::from_utf8_lossy(xml);
                        w.raw_str(&xml);
                    })
                    .is_some(),
                WorkbookXmlChildKind::ExtLst => {
                    if writer.ext_lst_entries.is_empty() {
                        slot.payload_id
                            .as_deref()
                            .and_then(|payload_id| raw_child_xml(fidelity, payload_id))
                            .map(|xml| {
                                let xml = String::from_utf8_lossy(xml);
                                w.raw_str(&xml);
                            })
                            .is_some()
                    } else {
                        write_generated_ext_lst(w, writer);
                        true
                    }
                }
                kind => write_modeled_child(w, writer, kind),
            };

            if did_emit && is_singleton_child(slot.kind) {
                emitted.insert(slot.kind);
            }
        }
    }

    for kind in CANONICAL_CHILD_ORDER {
        if emitted.contains(kind) && is_singleton_child(*kind) {
            continue;
        }
        if write_modeled_child(w, writer, *kind) && is_singleton_child(*kind) {
            emitted.insert(*kind);
        }
    }
}

const CANONICAL_CHILD_ORDER: &[WorkbookXmlChildKind] = &[
    WorkbookXmlChildKind::FileVersion,
    WorkbookXmlChildKind::FileSharing,
    WorkbookXmlChildKind::WorkbookPr,
    WorkbookXmlChildKind::BookViews,
    WorkbookXmlChildKind::CustomWorkbookViews,
    WorkbookXmlChildKind::Sheets,
    WorkbookXmlChildKind::WorkbookProtection,
    WorkbookXmlChildKind::ExternalReferences,
    WorkbookXmlChildKind::DefinedNames,
    WorkbookXmlChildKind::CalcPr,
    WorkbookXmlChildKind::PivotCaches,
    WorkbookXmlChildKind::WebPublishing,
    WorkbookXmlChildKind::ExtLst,
];

fn write_modeled_child(
    w: &mut XmlWriter,
    writer: &WorkbookWriter,
    kind: WorkbookXmlChildKind,
) -> bool {
    match kind {
        WorkbookXmlChildKind::FileVersion => {
            let present = writer.file_version.is_some();
            super::metadata::write_file_version(w, writer.file_version.as_ref());
            present
        }
        WorkbookXmlChildKind::FileSharing => {
            let present = writer.file_sharing.is_some();
            super::metadata::write_file_sharing(w, writer.file_sharing.as_ref());
            present
        }
        WorkbookXmlChildKind::WorkbookPr => {
            let present = writer.workbook_properties.is_some();
            super::metadata::write_workbook_properties(w, writer.workbook_properties.as_ref());
            present
        }
        WorkbookXmlChildKind::BookViews => {
            let present = !writer.workbook_views.is_empty();
            super::views::write_book_views(w, &writer.workbook_views);
            present
        }
        WorkbookXmlChildKind::CustomWorkbookViews => {
            if let Some(xml) = writer.custom_workbook_views_xml.as_ref() {
                let xml = String::from_utf8_lossy(xml);
                w.raw_str(&xml);
                true
            } else {
                false
            }
        }
        WorkbookXmlChildKind::Sheets => {
            super::sheets::write_sheets(w, &writer.sheets);
            true
        }
        WorkbookXmlChildKind::WorkbookProtection => {
            if let Some(ref prot) = writer.workbook_protection {
                use crate::domain::protection::write::WorkbookProtectionWrite;
                let ooxml_prot: ooxml_types::protection::WorkbookProtection = prot.clone().into();
                ooxml_prot.write_to(w);
                true
            } else {
                false
            }
        }
        WorkbookXmlChildKind::ExternalReferences => {
            let present = !writer.external_reference_r_ids.is_empty();
            super::external::write_external_references(w, &writer.external_reference_r_ids);
            present
        }
        WorkbookXmlChildKind::DefinedNames => {
            let present = !writer.defined_names.is_empty();
            super::defined_names::write_defined_names(w, &writer.defined_names);
            present
        }
        WorkbookXmlChildKind::CalcPr => {
            super::calc::write_calc_settings(w, writer.calc_settings.as_ref());
            true
        }
        WorkbookXmlChildKind::PivotCaches => {
            if let Some(ref pivot_caches) = writer.pivot_caches_xml {
                w.raw_str(pivot_caches);
                true
            } else {
                false
            }
        }
        WorkbookXmlChildKind::WebPublishing => {
            let present = writer.web_publishing.is_some();
            super::metadata::write_web_publishing(w, writer.web_publishing.as_ref());
            present
        }
        WorkbookXmlChildKind::ExtLst => {
            if writer.ext_lst_entries.is_empty() {
                false
            } else {
                write_generated_ext_lst(w, writer);
                true
            }
        }
        _ => false,
    }
}

fn write_generated_ext_lst(w: &mut XmlWriter, writer: &WorkbookWriter) {
    w.start_element("extLst").end_attrs();
    for ext in &writer.ext_lst_entries {
        w.raw_str(ext);
    }
    w.end_element("extLst");
}

fn raw_child_xml<'a>(
    fidelity: &'a domain_types::WorkbookXmlFidelity,
    payload_id: &str,
) -> Option<&'a [u8]> {
    fidelity
        .raw_children
        .iter()
        .find(|raw| raw.payload_id == payload_id)
        .map(|raw| raw.xml.as_slice())
}

fn is_singleton_child(kind: WorkbookXmlChildKind) -> bool {
    !matches!(kind, WorkbookXmlChildKind::Unknown)
}

fn workbook_conformance_to_emit(writer: &WorkbookWriter) -> Option<&str> {
    let conformance = writer.conformance.as_deref()?;
    if conformance.eq_ignore_ascii_case("strict") && has_transitional_only_workbook_markup(writer) {
        return None;
    }
    Some(conformance)
}

fn has_transitional_only_workbook_markup(writer: &WorkbookWriter) -> bool {
    writer
        .file_sharing
        .as_ref()
        .and_then(|sharing| sharing.reservation_password.as_ref())
        .is_some()
        || writer
            .web_publishing
            .as_ref()
            .map(|web| web.code_page.is_some() || web.character_set.is_some())
            .unwrap_or(false)
        || writer
            .workbook_protection
            .as_ref()
            .map(|protection| {
                protection.workbook_password_character_set.is_some()
                    || protection.revisions_password_character_set.is_some()
            })
            .unwrap_or(false)
}
