//! Yrs schema for [`Comment`] — flat Y.Map with rich text runs as JSON.

use std::sync::Arc;
use yrs::types::map::MapRef;
use yrs::{Any, ReadTxn};

use super::helpers::*;
use crate::domain::comment::{Comment, CommentContentType, CommentType};

pub const KEY_ID: &str = "id";
pub const KEY_CELL_REF: &str = "cellRef";
pub const KEY_AUTHOR: &str = "author";
pub const KEY_AUTHOR_ID: &str = "authorId";
pub const KEY_AUTHOR_EMAIL: &str = "authorEmail";
pub const KEY_CONTENT: &str = "content";
pub const KEY_THREAD_ID: &str = "threadId";
pub const KEY_PARENT_ID: &str = "parentId";
pub const KEY_RESOLVED: &str = "resolved";
pub const KEY_CREATED_AT: &str = "createdAt";
pub const KEY_MODIFIED_AT: &str = "modifiedAt";
/// Rich text runs stored as JSON string (full `RichTextRun` with 16 fields).
pub const KEY_RUNS: &str = "runs";
pub const KEY_PERSON_ID: &str = "personId";
pub const KEY_TIMESTAMP: &str = "timestamp";
pub const KEY_XR_UID: &str = "xrUid";
pub const KEY_SHAPE_ID: &str = "shapeId";
pub const KEY_EXT_LST_XML: &str = "extLstXml";
pub const KEY_CONTENT_TYPE: &str = "contentType";
pub const KEY_MENTIONS: &str = "mentions";
pub const KEY_COMMENT_TYPE: &str = "commentType";
pub const KEY_VISIBLE: &str = "visible";
pub const KEY_NOTE_HEIGHT: &str = "noteHeight";
pub const KEY_NOTE_WIDTH: &str = "noteWidth";
pub const KEY_NOTE_SHAPE_ANCHOR: &str = "noteShapeAnchor";
pub const KEY_COMMENT_PR: &str = "commentPr";

/// Convert a [`Comment`] to Yrs prelim entries.
///
/// Writes ALL fields — no round-trip fidelity data is dropped.
pub fn to_yrs_prelim(comment: &Comment) -> Vec<(&str, Any)> {
    let mut entries: Vec<(&str, Any)> = vec![
        (KEY_ID, Any::String(Arc::from(comment.id.as_str()))),
        (
            KEY_CELL_REF,
            Any::String(Arc::from(comment.cell_ref.as_str())),
        ),
        (KEY_AUTHOR, Any::String(Arc::from(comment.author.as_str()))),
    ];
    if let Some(ref author_id) = comment.author_id {
        entries.push((KEY_AUTHOR_ID, Any::String(Arc::from(author_id.as_str()))));
    }
    if let Some(ref author_email) = comment.author_email {
        entries.push((
            KEY_AUTHOR_EMAIL,
            Any::String(Arc::from(author_email.as_str())),
        ));
    }
    if let Some(ts) = comment.created_at {
        entries.push((KEY_CREATED_AT, Any::Number(ts as f64)));
    }
    if let Some(ts) = comment.modified_at {
        entries.push((KEY_MODIFIED_AT, Any::Number(ts as f64)));
    }
    if !comment.runs.is_empty()
        && let Ok(json) = serde_json::to_string(&comment.runs)
    {
        entries.push((KEY_RUNS, Any::String(Arc::from(json))));
    }
    if let Some(ref content) = comment.content {
        entries.push((KEY_CONTENT, Any::String(Arc::from(content.as_str()))));
    }
    if let Some(ref thread_id) = comment.thread_id {
        entries.push((KEY_THREAD_ID, Any::String(Arc::from(thread_id.as_str()))));
    }
    if let Some(ref parent_id) = comment.parent_id {
        entries.push((KEY_PARENT_ID, Any::String(Arc::from(parent_id.as_str()))));
    }
    match comment.resolved {
        Some(b) => entries.push((KEY_RESOLVED, Any::Bool(b))),
        None => entries.push((KEY_RESOLVED, Any::Null)),
    }
    if let Some(ref person_id) = comment.person_id {
        entries.push((KEY_PERSON_ID, Any::String(Arc::from(person_id.as_str()))));
    }
    if let Some(ref timestamp) = comment.timestamp {
        entries.push((KEY_TIMESTAMP, Any::String(Arc::from(timestamp.as_str()))));
    }
    if let Some(ref xr_uid) = comment.xr_uid {
        entries.push((KEY_XR_UID, Any::String(Arc::from(xr_uid.as_str()))));
    }
    if let Some(shape_id) = comment.shape_id {
        entries.push((KEY_SHAPE_ID, Any::Number(shape_id as f64)));
    }
    if let Some(ref ext_lst) = comment.ext_lst_xml {
        entries.push((KEY_EXT_LST_XML, Any::String(Arc::from(ext_lst.as_str()))));
    }
    if let Some(ref ct) = comment.content_type {
        let s = match ct {
            CommentContentType::Plain => "plain",
            CommentContentType::Mention => "mention",
        };
        entries.push((KEY_CONTENT_TYPE, Any::String(Arc::from(s))));
    }
    if !comment.mentions.is_empty()
        && let Ok(json) = serde_json::to_string(&comment.mentions)
    {
        entries.push((KEY_MENTIONS, Any::String(Arc::from(json))));
    }
    // Always serialize — `comment_type` is the canonical discriminator.
    let comment_type_str = match comment.comment_type {
        CommentType::Note => "note",
        CommentType::ThreadedComment => "threadedComment",
    };
    entries.push((KEY_COMMENT_TYPE, Any::String(Arc::from(comment_type_str))));
    if let Some(v) = comment.visible {
        entries.push((KEY_VISIBLE, Any::Bool(v)));
    }
    if let Some(h) = comment.note_height {
        entries.push((KEY_NOTE_HEIGHT, Any::Number(h)));
    }
    if let Some(w) = comment.note_width {
        entries.push((KEY_NOTE_WIDTH, Any::Number(w)));
    }
    if let Some(ref anchor) = comment.note_shape_anchor
        && let Ok(json) = serde_json::to_string(anchor)
    {
        entries.push((KEY_NOTE_SHAPE_ANCHOR, Any::String(Arc::from(json))));
    }
    if let Some(ref comment_pr) = comment.comment_pr
        && let Ok(json) = serde_json::to_string(comment_pr)
    {
        entries.push((KEY_COMMENT_PR, Any::String(Arc::from(json))));
    }
    entries
}

/// Read a [`Comment`] from a Y.Map. Returns `None` if required fields are missing.
pub fn from_yrs_map<T: ReadTxn>(map: &MapRef, txn: &T) -> Option<Comment> {
    Some(Comment {
        id: read_string(map, txn, KEY_ID).unwrap_or_default(),
        cell_ref: read_string(map, txn, KEY_CELL_REF)?,
        author: read_string(map, txn, KEY_AUTHOR).unwrap_or_default(),
        author_id: read_string(map, txn, KEY_AUTHOR_ID),
        author_email: read_string(map, txn, KEY_AUTHOR_EMAIL),
        created_at: read_u64(map, txn, KEY_CREATED_AT),
        modified_at: read_u64(map, txn, KEY_MODIFIED_AT),
        runs: read_string(map, txn, KEY_RUNS)
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        content: read_string(map, txn, KEY_CONTENT),
        thread_id: read_string(map, txn, KEY_THREAD_ID),
        parent_id: read_string(map, txn, KEY_PARENT_ID),
        resolved: read_bool(map, txn, KEY_RESOLVED),
        person_id: read_string(map, txn, KEY_PERSON_ID),
        timestamp: read_string(map, txn, KEY_TIMESTAMP),
        xr_uid: read_string(map, txn, KEY_XR_UID),
        shape_id: read_number(map, txn, KEY_SHAPE_ID).map(|n| n as u32),
        ext_lst_xml: read_string(map, txn, KEY_EXT_LST_XML),
        content_type: read_string(map, txn, KEY_CONTENT_TYPE).and_then(|s| match s.as_str() {
            "plain" => Some(CommentContentType::Plain),
            "mention" => Some(CommentContentType::Mention),
            _ => None,
        }),
        mentions: read_string(map, txn, KEY_MENTIONS)
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        // Migration site: legacy yrs rows without a `commentType` key default
        // to `ThreadedComment`. Every read flows through here, so legacy data
        // lazily upgrades on first re-write.
        comment_type: read_string(map, txn, KEY_COMMENT_TYPE)
            .and_then(|s| match s.as_str() {
                "note" => Some(CommentType::Note),
                "threadedComment" => Some(CommentType::ThreadedComment),
                _ => None,
            })
            .unwrap_or(CommentType::ThreadedComment),
        visible: read_bool(map, txn, KEY_VISIBLE),
        note_height: read_number(map, txn, KEY_NOTE_HEIGHT),
        note_width: read_number(map, txn, KEY_NOTE_WIDTH),
        note_shape_anchor: read_string(map, txn, KEY_NOTE_SHAPE_ANCHOR)
            .and_then(|s| serde_json::from_str(&s).ok()),
        comment_pr: read_string(map, txn, KEY_COMMENT_PR)
            .and_then(|s| serde_json::from_str(&s).ok()),
    })
}

#[cfg(test)]
mod tests {
    //! Tests local to the comment yrs schema module.
    //!
    //! The shared `domain-types/src/yrs_schema/tests.rs` file is currently
    //! disabled in `mod.rs`; these tests live alongside the schema module
    //! itself so the migration-default and round-trip invariants are
    //! exercised on every `cargo test -p domain-types`.

    use super::*;
    use crate::domain::comment::Comment;
    use yrs::{Doc, Map as _, MapPrelim, Transact};

    #[test]
    fn legacy_yrs_row_without_comment_type_key_defaults_to_threaded() {
        // Migration site: a yrs map missing the `commentType` key (legacy
        // `None` row created before the discriminator was required) reads
        // back as `ThreadedComment`. Every read flows through `from_yrs_map`,
        // so legacy data lazily upgrades on first re-write.
        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            let entries: Vec<(&str, Any)> = vec![
                (KEY_ID, Any::String(Arc::from("legacy-001"))),
                (KEY_CELL_REF, Any::String(Arc::from("A1"))),
                (KEY_AUTHOR, Any::String(Arc::from("Legacy User"))),
            ];
            let prelim: MapPrelim = entries.into_iter().collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        let restored = from_yrs_map(&map_ref, &txn).expect("should read");
        assert_eq!(restored.comment_type, CommentType::ThreadedComment);
        assert_eq!(restored.cell_ref, "A1");
        assert_eq!(restored.author, "Legacy User");
    }

    #[test]
    fn note_round_trips_as_note() {
        let original = Comment {
            id: "note-001".to_string(),
            cell_ref: "C5".to_string(),
            author: "Alice".to_string(),
            comment_type: CommentType::Note,
            visible: Some(true),
            note_height: Some(60.0),
            note_width: Some(120.0),
            note_shape_anchor: Some(crate::domain::comment::NoteShapeAnchor {
                left_column: 1,
                left_offset: 2,
                top_row: 3,
                top_offset: 4,
                right_column: 5,
                right_offset: 6,
                bottom_row: 7,
                bottom_offset: 8,
            }),
            ..Default::default()
        };

        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            let entries = to_yrs_prelim(&original);
            let prelim: MapPrelim = entries.into_iter().collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        let restored = from_yrs_map(&map_ref, &txn).unwrap();
        assert_eq!(restored.comment_type, CommentType::Note);
        assert_eq!(restored.visible, Some(true));
        assert_eq!(restored.note_height, Some(60.0));
        assert_eq!(restored.note_width, Some(120.0));
        assert_eq!(restored.note_shape_anchor, original.note_shape_anchor);
    }

    #[test]
    fn tc_author_note_round_trips_without_thread_metadata() {
        let original = Comment {
            id: "note-001".to_string(),
            cell_ref: "C5".to_string(),
            author: "tc={LITERAL-AUTHOR}".to_string(),
            comment_type: CommentType::Note,
            xr_uid: Some("{LEGACY-XR-UID}".to_string()),
            ..Default::default()
        };

        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            let entries = to_yrs_prelim(&original);
            let prelim: MapPrelim = entries.into_iter().collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();

        assert!(map_ref.get(&txn, KEY_THREAD_ID).is_none());
        let restored = from_yrs_map(&map_ref, &txn).unwrap();
        assert_eq!(restored.comment_type, CommentType::Note);
        assert_eq!(restored.author, "tc={LITERAL-AUTHOR}");
        assert_eq!(restored.thread_id, None);
        assert_eq!(restored.xr_uid.as_deref(), Some("{LEGACY-XR-UID}"));
    }

    #[test]
    fn threaded_round_trips_as_threaded() {
        let original = Comment {
            id: "thread-001".to_string(),
            cell_ref: "B2".to_string(),
            author: "Bob".to_string(),
            comment_type: CommentType::ThreadedComment,
            thread_id: Some("thread-001".to_string()),
            ..Default::default()
        };

        let doc = Doc::new();
        let root = doc.get_or_insert_map("test");
        {
            let mut txn = doc.transact_mut();
            let entries = to_yrs_prelim(&original);
            let prelim: MapPrelim = entries.into_iter().collect();
            root.insert(&mut txn, "item", prelim);
        }
        let txn = doc.transact();
        let map_ref = root
            .get(&txn, "item")
            .unwrap()
            .cast::<yrs::MapRef>()
            .unwrap();
        let restored = from_yrs_map(&map_ref, &txn).unwrap();
        assert_eq!(restored.comment_type, CommentType::ThreadedComment);
        assert_eq!(restored.thread_id, Some("thread-001".to_string()));
    }
}
