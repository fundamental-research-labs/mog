use super::assembly::WorksheetThreadedCommentsGraphEntry;
use super::{package_authority, worksheet_relative_target};
use crate::write::REL_THREADED_COMMENT;
use crate::write::relationships::RelationshipManager;

pub(super) fn add_relationship_for_export(
    sheet_idx: usize,
    global_idx: usize,
    original_sheet_rels: &[domain_types::OpcRelationship],
    comments: &[domain_types::Comment],
    rels: &mut RelationshipManager,
) -> WorksheetThreadedCommentsGraphEntry {
    let path = current_comments_have_imported_threaded_identity(comments)
        .then(|| original_threaded_comments_path(sheet_idx, original_sheet_rels))
        .flatten()
        .unwrap_or_else(|| format!("xl/threadedComments/threadedComment{global_idx}.xml"));
    let target = worksheet_relative_target(&path);
    let relationship_id_hint = if let Some(r_id) = package_authority::relationship_id_hint(
        original_sheet_rels,
        REL_THREADED_COMMENT,
        &target,
        None,
    )
    .filter(|r_id| rels.get_by_id(r_id).is_none())
    {
        rels.add_with_id(&r_id, REL_THREADED_COMMENT, &target);
        Some(r_id)
    } else {
        Some(rels.add(REL_THREADED_COMMENT, &target))
    };

    WorksheetThreadedCommentsGraphEntry {
        sheet_idx,
        path,
        target,
        relationship_id_hint,
    }
}

fn current_comments_have_imported_threaded_identity(comments: &[domain_types::Comment]) -> bool {
    comments.iter().any(|comment| {
        comment.comment_type == domain_types::CommentType::ThreadedComment
            && (comment.thread_id.is_some()
                || comment.person_id.is_some()
                || comment.timestamp.is_some()
                || comment.xr_uid.is_some()
                || comment.ext_lst_xml.is_some())
    })
}

fn original_threaded_comments_path(
    sheet_idx: usize,
    original_sheet_rels: &[domain_types::OpcRelationship],
) -> Option<String> {
    let owner_path = format!("xl/worksheets/sheet{}.xml", sheet_idx + 1);
    original_sheet_rels
        .iter()
        .find(|rel| {
            rel.rel_type == REL_THREADED_COMMENT && rel.target_mode.as_deref() != Some("External")
        })
        .and_then(|rel| {
            crate::infra::opc::resolve_relationship_target(Some(&owner_path), &rel.target).ok()
        })
        .filter(|path| is_threaded_comments_part_path(path))
}

fn is_threaded_comments_part_path(path: &str) -> bool {
    let Some(number) = path
        .strip_prefix("xl/threadedComments/threadedComment")
        .and_then(|rest| rest.strip_suffix(".xml"))
    else {
        return false;
    };

    !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
}
