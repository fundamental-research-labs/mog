use super::assembly::WorksheetThreadedCommentsGraphEntry;
use super::worksheet_relative_target;
use crate::write::REL_THREADED_COMMENT;
use crate::write::relationships::RelationshipManager;

pub(super) fn add_relationship_for_export(
    sheet_idx: usize,
    global_idx: usize,
    comments: &[domain_types::Comment],
    rels: &mut RelationshipManager,
) -> WorksheetThreadedCommentsGraphEntry {
    let path = current_comments_have_imported_threaded_identity(comments)
        .then(|| format!("xl/threadedComments/threadedComment{global_idx}.xml"))
        .unwrap_or_else(|| format!("xl/threadedComments/threadedComment{global_idx}.xml"));
    let target = worksheet_relative_target(&path);
    let relationship_id_hint = Some(rels.add(REL_THREADED_COMMENT, &target));

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
