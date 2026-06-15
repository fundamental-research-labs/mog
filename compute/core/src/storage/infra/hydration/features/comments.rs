use std::collections::{HashMap, HashSet};

use yrs::{Map, MapPrelim, MapRef};

use domain_types::yrs_schema;

use crate::storage::infra::hydration::helpers::PositionMap;

/// Hydrate comments using structured Y.Map entries via `yrs_schema::comment`.
///
/// Comments with source IDs, such as XLSX threaded-comment IDs, keep those IDs
/// so parent/thread links remain valid through import, SDK readback, and export.
pub(in crate::storage::infra::hydration) fn hydrate_comments(
    txn: &mut yrs::TransactionMut,
    comments_map: &MapRef,
    pos_map: &PositionMap,
    comments: &[domain_types::domain::comment::Comment],
    persons: &[domain_types::domain::comment::PersonInfo],
) {
    let person_map: HashMap<&str, &domain_types::domain::comment::PersonInfo> =
        persons.iter().map(|p| (p.id.as_str(), p)).collect();
    let mut used_comment_ids = HashSet::new();
    let mut generated_comment_index = 0usize;

    for comment in comments {
        let comment_id = allocate_comment_id(
            comment.id.trim(),
            &mut used_comment_ids,
            &mut generated_comment_index,
        );
        let mut c = comment.clone();
        c.id = comment_id.clone();
        c.cell_ref = resolve_comment_cell_ref(pos_map, comment);
        c.resolved = Some(comment.resolved.unwrap_or(false));

        if c.author_email.is_none()
            && let Some(ref pid) = c.person_id
            && let Some(person) = person_map.get(pid.as_str())
            && let Some(ref user_id) = person.user_id
            && let Some(email) = extract_email_from_user_id(user_id)
        {
            c.author_email = Some(email);
        }

        let entries = yrs_schema::comment::to_yrs_prelim(&c);
        let comment_prelim: MapPrelim = entries.into_iter().collect();
        comments_map.insert(txn, &*comment_id, comment_prelim);
    }
}

fn allocate_comment_id(
    preferred_id: &str,
    used_comment_ids: &mut HashSet<String>,
    generated_comment_index: &mut usize,
) -> String {
    if !preferred_id.is_empty() && used_comment_ids.insert(preferred_id.to_string()) {
        return preferred_id.to_string();
    }

    loop {
        let candidate = format!("comment-{}", generated_comment_index);
        *generated_comment_index += 1;
        if used_comment_ids.insert(candidate.clone()) {
            return candidate;
        }
    }
}

fn resolve_comment_cell_ref(
    pos_map: &PositionMap,
    comment: &domain_types::domain::comment::Comment,
) -> String {
    let Some((row, col)) = crate::import::phantom::parse_cell_ref(&comment.cell_ref) else {
        return comment.cell_ref.clone();
    };

    match pos_map.get(&(row, col)) {
        Some(cell_hex) => cell_hex.clone(),
        None => {
            tracing::warn!(
                row,
                col,
                original_ref = %comment.cell_ref,
                "comment anchor missing preallocated cell identity during hydration"
            );
            comment.cell_ref.clone()
        }
    }
}

fn extract_email_from_user_id(user_id: &str) -> Option<String> {
    for segment in user_id.split("::") {
        let trimmed = segment.trim();
        if trimmed.contains('@') && !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    user_id.contains('@').then(|| user_id.trim().to_string())
}
