use yrs::{Map, MapRef, Out};

use compute_document::schema::KEY_COMMENTS;
use domain_types::domain::comment::Comment;
use domain_types::yrs_schema::comment as comment_schema;

/// Get the `comments` MapRef for a given sheet (read-only).
pub(super) fn get_comments_map<T: yrs::ReadTxn>(
    txn: &T,
    sheets_root: &MapRef,
    sheet_hex: &str,
) -> Option<MapRef> {
    let sheet_map = match sheets_root.get(txn, sheet_hex) {
        Some(Out::YMap(m)) => m,
        _ => return None,
    };
    match sheet_map.get(txn, KEY_COMMENTS) {
        Some(Out::YMap(m)) => Some(m),
        _ => None,
    }
}

/// Read all comments from a comments map.
///
/// Sorts entries by key numeric suffix (`comment-0`, `comment-1`, …) to preserve
/// the original hydration order, which matches the XLSX file's comment ordering.
/// Keys without a numeric suffix (runtime-created comments) sort after the
/// numeric-keyed entries in lexicographic order.
pub(super) fn read_all_comments<T: yrs::ReadTxn>(txn: &T, comments_map: &MapRef) -> Vec<Comment> {
    // Collect and sort by key suffix for deterministic order
    let mut entries: Vec<(String, Out)> = comments_map
        .iter(txn)
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    entries.sort_by(|(a, _), (b, _)| {
        let parse_suffix = |k: &str| -> Option<usize> {
            k.rsplit_once('-')
                .and_then(|(_, s)| s.parse::<usize>().ok())
        };
        let ai = parse_suffix(a);
        let bi = parse_suffix(b);
        match (ai, bi) {
            (Some(ai), Some(bi)) => ai.cmp(&bi),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.cmp(b),
        }
    });

    let mut result = Vec::new();
    for (_key, value) in entries {
        if let Out::YMap(map) = value
            && let Some(comment) = comment_schema::from_yrs_map(&map, txn)
        {
            result.push(comment);
        }
    }
    result
}

/// Sort comments chronologically.
pub(super) fn sort_comments(comments: &mut [Comment]) {
    comments.sort_by(|a, b| {
        a.created_at
            .unwrap_or(0)
            .cmp(&b.created_at.unwrap_or(0))
            .then_with(|| a.parent_id.is_some().cmp(&b.parent_id.is_some()))
            .then_with(|| a.id.cmp(&b.id))
    });
}
