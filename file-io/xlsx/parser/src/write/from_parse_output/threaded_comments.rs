use super::assembly::WorksheetThreadedCommentsGraphEntry;
use super::worksheet_relative_target;
use crate::write::REL_THREADED_COMMENT;
use crate::write::relationships::RelationshipManager;

pub(super) fn add_relationship_for_export(
    sheet_idx: usize,
    global_idx: usize,
    preserved_path: Option<&str>,
    relationship_id_hint: Option<&str>,
    rels: &mut RelationshipManager,
) -> WorksheetThreadedCommentsGraphEntry {
    let path = preserved_path
        .map(str::to_string)
        .unwrap_or_else(|| format!("xl/threadedComments/threadedComment{global_idx}.xml"));
    let target = worksheet_relative_target(&path);
    let generated_relationship_id = rels.add(REL_THREADED_COMMENT, &target);
    let relationship_id_hint = Some(
        relationship_id_hint
            .unwrap_or(&generated_relationship_id)
            .to_string(),
    );

    WorksheetThreadedCommentsGraphEntry {
        sheet_idx,
        path,
        target,
        relationship_id_hint,
    }
}
