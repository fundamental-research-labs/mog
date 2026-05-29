use domain_types::{
    WorkbookXmlChildKind, WorkbookXmlChildSlot, WorkbookXmlFallbackAction, WorkbookXmlFidelity,
    WorkbookXmlFidelityDiagnostic, WorkbookXmlOwnerPolicy, WorkbookXmlProvenanceStatus,
    WorkbookXmlRawChild,
};

use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

pub(super) fn capture_workbook_xml_fidelity(workbook_xml: &[u8]) -> WorkbookXmlFidelity {
    let Some((body_start, body_end)) = workbook_body_bounds(workbook_xml) else {
        return WorkbookXmlFidelity::default();
    };
    let body = &workbook_xml[body_start..body_end];
    let mut result = WorkbookXmlFidelity::default();
    let mut pos = 0;
    let mut raw_index = 0usize;

    while pos < body.len() {
        let Some(lt_rel) = memchr::memchr(b'<', &body[pos..]) else {
            break;
        };
        let lt = pos + lt_rel;
        let name_start = lt + 1;
        if name_start >= body.len() {
            break;
        }

        match body[name_start] {
            b'/' => break,
            b'!' | b'?' => {
                pos = find_gt_simd(body, lt).map_or(body.len(), |end| end + 1);
                continue;
            }
            _ => {}
        }

        let name_end = tag_name_end(body, name_start);
        let q_name = String::from_utf8_lossy(&body[name_start..name_end]).into_owned();
        let local_name = local_name(&body[name_start..name_end]);
        let kind = child_kind(local_name);
        let Some(tag_end) = find_gt_simd(body, lt) else {
            push_slot(
                &mut result,
                kind,
                owner_policy(kind),
                WorkbookXmlProvenanceStatus::Malformed,
                WorkbookXmlFallbackAction::Omit,
                None,
                Some("malformed workbook child start tag".to_string()),
            );
            break;
        };
        let Some(end) = element_end(body, lt, tag_end) else {
            push_slot(
                &mut result,
                kind,
                owner_policy(kind),
                WorkbookXmlProvenanceStatus::Malformed,
                WorkbookXmlFallbackAction::Omit,
                None,
                Some("malformed workbook child element".to_string()),
            );
            break;
        };
        let child_xml = &body[lt..end];

        match raw_payload_policy(kind, child_xml) {
            RawPayloadPolicy::Modeled => {
                push_slot(
                    &mut result,
                    kind,
                    owner_policy(kind),
                    WorkbookXmlProvenanceStatus::Current,
                    WorkbookXmlFallbackAction::Regenerate,
                    None,
                    None,
                );
            }
            RawPayloadPolicy::Preserve => {
                raw_index += 1;
                let payload_id = format!("workbook-child-{raw_index}");
                push_slot(
                    &mut result,
                    kind,
                    owner_policy(kind),
                    WorkbookXmlProvenanceStatus::SafeInert,
                    WorkbookXmlFallbackAction::Preserve,
                    Some(payload_id.clone()),
                    None,
                );
                result.raw_children.push(WorkbookXmlRawChild {
                    payload_id,
                    kind,
                    q_name,
                    local_name: String::from_utf8_lossy(local_name).into_owned(),
                    xml: child_xml.to_vec(),
                    relationship_ids: Vec::new(),
                });
            }
            RawPayloadPolicy::Omit { status, reason } => {
                push_slot(
                    &mut result,
                    kind,
                    owner_policy(kind),
                    status,
                    WorkbookXmlFallbackAction::Omit,
                    None,
                    Some(reason.to_string()),
                );
                result.diagnostics.push(WorkbookXmlFidelityDiagnostic {
                    artifact: format!("xl/workbook.xml/{}", String::from_utf8_lossy(local_name)),
                    owner_policy: owner_policy(kind),
                    provenance_status: status,
                    action: WorkbookXmlFallbackAction::Omit,
                    reason: reason.to_string(),
                    relationship_ids: relationship_ids(child_xml),
                    semantics_changed: true,
                });
            }
        }

        pos = end;
    }

    result
}

enum RawPayloadPolicy {
    Modeled,
    Preserve,
    Omit {
        status: WorkbookXmlProvenanceStatus,
        reason: &'static str,
    },
}

fn raw_payload_policy(kind: WorkbookXmlChildKind, child_xml: &[u8]) -> RawPayloadPolicy {
    match kind {
        WorkbookXmlChildKind::FunctionGroups
        | WorkbookXmlChildKind::OleSize
        | WorkbookXmlChildKind::SmartTagPr
        | WorkbookXmlChildKind::SmartTagTypes
        | WorkbookXmlChildKind::FileRecoveryPr
        | WorkbookXmlChildKind::WebPublishObjects
        | WorkbookXmlChildKind::ExtLst => {
            if has_relationship_reference(child_xml) {
                RawPayloadPolicy::Omit {
                    status: WorkbookXmlProvenanceStatus::UnsafeRelationshipReference,
                    reason: "raw workbook child references package relationships without a workbook owner remapper",
                }
            } else {
                RawPayloadPolicy::Preserve
            }
        }
        WorkbookXmlChildKind::AlternateContent => RawPayloadPolicy::Omit {
            status: WorkbookXmlProvenanceStatus::Unsupported,
            reason: "direct workbook mc:AlternateContent requires an explicit branch-selection policy",
        },
        WorkbookXmlChildKind::Unknown => RawPayloadPolicy::Omit {
            status: WorkbookXmlProvenanceStatus::Unsupported,
            reason: "unknown workbook child has no owner policy",
        },
        _ => RawPayloadPolicy::Modeled,
    }
}

fn push_slot(
    result: &mut WorkbookXmlFidelity,
    kind: WorkbookXmlChildKind,
    owner_policy: WorkbookXmlOwnerPolicy,
    provenance_status: WorkbookXmlProvenanceStatus,
    fallback_action: WorkbookXmlFallbackAction,
    payload_id: Option<String>,
    reason: Option<String>,
) {
    let duplicate_modeled = matches!(
        fallback_action,
        WorkbookXmlFallbackAction::Regenerate | WorkbookXmlFallbackAction::Preserve
    ) && is_single_modeled_child(kind)
        && result.slots.iter().any(|slot| slot.kind == kind);

    let (provenance_status, fallback_action, reason) = if duplicate_modeled {
        (
            WorkbookXmlProvenanceStatus::DuplicateModeledChild,
            WorkbookXmlFallbackAction::Omit,
            Some("duplicate modeled workbook child".to_string()),
        )
    } else {
        (provenance_status, fallback_action, reason)
    };

    result.slots.push(WorkbookXmlChildSlot {
        kind,
        owner_policy,
        provenance_status,
        fallback_action,
        payload_id,
        reason,
    });
}

fn workbook_body_bounds(xml: &[u8]) -> Option<(usize, usize)> {
    let workbook_start = find_tag_simd(xml, b"workbook", 0)?;
    let open_end = find_gt_simd(xml, workbook_start)?;
    if open_end > workbook_start && xml[open_end - 1] == b'/' {
        return None;
    }
    let close_start = find_closing_tag(xml, b"workbook", open_end)?;
    Some((open_end + 1, close_start))
}

fn element_end(xml: &[u8], start: usize, tag_end: usize) -> Option<usize> {
    if tag_end > start && xml[tag_end - 1] == b'/' {
        return Some(tag_end + 1);
    }
    let name_start = start + 1;
    let name_end = tag_name_end(xml, name_start);
    let close_start = find_closing_tag(xml, &xml[name_start..name_end], tag_end)?;
    find_gt_simd(xml, close_start).map(|end| end + 1)
}

fn tag_name_end(xml: &[u8], mut pos: usize) -> usize {
    while pos < xml.len() {
        if matches!(xml[pos], b'>' | b'/' | b' ' | b'\t' | b'\n' | b'\r') {
            break;
        }
        pos += 1;
    }
    pos
}

fn local_name(name: &[u8]) -> &[u8] {
    name.iter()
        .rposition(|b| *b == b':')
        .map_or(name, |idx| &name[idx + 1..])
}

fn child_kind(local_name: &[u8]) -> WorkbookXmlChildKind {
    match local_name {
        b"fileVersion" => WorkbookXmlChildKind::FileVersion,
        b"fileSharing" => WorkbookXmlChildKind::FileSharing,
        b"workbookPr" => WorkbookXmlChildKind::WorkbookPr,
        b"workbookProtection" => WorkbookXmlChildKind::WorkbookProtection,
        b"bookViews" => WorkbookXmlChildKind::BookViews,
        b"customWorkbookViews" => WorkbookXmlChildKind::CustomWorkbookViews,
        b"sheets" => WorkbookXmlChildKind::Sheets,
        b"functionGroups" => WorkbookXmlChildKind::FunctionGroups,
        b"externalReferences" => WorkbookXmlChildKind::ExternalReferences,
        b"definedNames" => WorkbookXmlChildKind::DefinedNames,
        b"calcPr" => WorkbookXmlChildKind::CalcPr,
        b"oleSize" => WorkbookXmlChildKind::OleSize,
        b"pivotCaches" => WorkbookXmlChildKind::PivotCaches,
        b"smartTagPr" => WorkbookXmlChildKind::SmartTagPr,
        b"smartTagTypes" => WorkbookXmlChildKind::SmartTagTypes,
        b"webPublishing" => WorkbookXmlChildKind::WebPublishing,
        b"fileRecoveryPr" => WorkbookXmlChildKind::FileRecoveryPr,
        b"webPublishObjects" => WorkbookXmlChildKind::WebPublishObjects,
        b"extLst" => WorkbookXmlChildKind::ExtLst,
        b"AlternateContent" => WorkbookXmlChildKind::AlternateContent,
        _ => WorkbookXmlChildKind::Unknown,
    }
}

fn owner_policy(kind: WorkbookXmlChildKind) -> WorkbookXmlOwnerPolicy {
    match kind {
        WorkbookXmlChildKind::FileVersion
        | WorkbookXmlChildKind::CustomWorkbookViews
        | WorkbookXmlChildKind::OleSize
        | WorkbookXmlChildKind::WebPublishObjects => {
            WorkbookXmlOwnerPolicy::TypedWithValidatedProvenance
        }
        WorkbookXmlChildKind::FileSharing
        | WorkbookXmlChildKind::WorkbookPr
        | WorkbookXmlChildKind::WorkbookProtection
        | WorkbookXmlChildKind::BookViews
        | WorkbookXmlChildKind::Sheets
        | WorkbookXmlChildKind::ExternalReferences
        | WorkbookXmlChildKind::DefinedNames
        | WorkbookXmlChildKind::CalcPr
        | WorkbookXmlChildKind::PivotCaches
        | WorkbookXmlChildKind::WebPublishing => WorkbookXmlOwnerPolicy::TypedRegenerated,
        WorkbookXmlChildKind::FunctionGroups
        | WorkbookXmlChildKind::SmartTagPr
        | WorkbookXmlChildKind::SmartTagTypes
        | WorkbookXmlChildKind::FileRecoveryPr => WorkbookXmlOwnerPolicy::InertDirectChildPayload,
        WorkbookXmlChildKind::ExtLst => WorkbookXmlOwnerPolicy::ExtensionOwnerRegistry,
        WorkbookXmlChildKind::AlternateContent => WorkbookXmlOwnerPolicy::MceFailClosed,
        WorkbookXmlChildKind::Unknown => WorkbookXmlOwnerPolicy::Unsupported,
    }
}

fn is_single_modeled_child(kind: WorkbookXmlChildKind) -> bool {
    matches!(
        kind,
        WorkbookXmlChildKind::FileVersion
            | WorkbookXmlChildKind::FileSharing
            | WorkbookXmlChildKind::WorkbookPr
            | WorkbookXmlChildKind::WorkbookProtection
            | WorkbookXmlChildKind::BookViews
            | WorkbookXmlChildKind::CustomWorkbookViews
            | WorkbookXmlChildKind::Sheets
            | WorkbookXmlChildKind::ExternalReferences
            | WorkbookXmlChildKind::DefinedNames
            | WorkbookXmlChildKind::CalcPr
            | WorkbookXmlChildKind::PivotCaches
            | WorkbookXmlChildKind::WebPublishing
            | WorkbookXmlChildKind::ExtLst
    )
}

fn has_relationship_reference(xml: &[u8]) -> bool {
    !relationship_ids(xml).is_empty()
}

fn relationship_ids(xml: &[u8]) -> Vec<String> {
    let mut ids = Vec::new();
    let mut pos = 0;
    while let Some(found) = memchr::memmem::find(&xml[pos..], b"r:id=\"") {
        let value_start = pos + found + b"r:id=\"".len();
        if let Some(value_end) = xml[value_start..].iter().position(|b| *b == b'"') {
            ids.push(String::from_utf8_lossy(&xml[value_start..value_start + value_end]).into());
            pos = value_start + value_end + 1;
        } else {
            break;
        }
    }
    ids
}
