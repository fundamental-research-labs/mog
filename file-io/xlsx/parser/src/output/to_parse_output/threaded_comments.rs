use super::*;

/// Parse persons from `xl/persons/person.xml` and merge threaded comment data
/// into the per-sheet `Comment` entries. Returns the workbook-level person list.
pub(super) fn merge_threaded_comments(
    result: &FullParseResult,
    sheets: &mut [SheetData],
) -> Vec<PersonInfo> {
    use crate::domain::comments::read::{
        parse_threaded_comments, parse_threaded_comments_root_attrs,
    };

    let persons: Vec<PersonInfo> = result
        .raw_persons_xml
        .as_ref()
        .map(|xml| parse_person_xml(xml))
        .unwrap_or_default();

    let person_names: HashMap<&str, &str> = persons
        .iter()
        .map(|p| (p.id.as_str(), p.display_name.as_str()))
        .collect();

    let tc_bytes_map: HashMap<&str, &[u8]> = result
        .raw_threaded_comments
        .iter()
        .map(|(path, data)| (path.as_str(), data.as_slice()))
        .collect();

    for (sheet_idx, sheet_data) in sheets.iter_mut().enumerate() {
        let parsed_sheet = match result.sheets.get(sheet_idx) {
            Some(s) => s,
            None => continue,
        };

        let tc_path = parsed_sheet.sheet_opc_rels.iter().find_map(|rel| {
            if rel.rel_type == REL_THREADED_COMMENT {
                let owner_path = format!("xl/worksheets/sheet{}.xml", parsed_sheet.index + 1);
                resolve_relationship_target(Some(&owner_path), &rel.target).ok()
            } else {
                None
            }
        });

        let tc_path = match tc_path {
            Some(p) => p,
            None => continue,
        };

        let tc_xml = match tc_bytes_map.get(tc_path.as_str()) {
            Some(xml) => *xml,
            None => continue,
        };
        if let Some(comment_package) = sheet_data.comment_package.as_mut() {
            comment_package.threaded_comments_root_namespace_attrs =
                parse_threaded_comments_root_attrs(tc_xml);
        }

        let threaded = parse_threaded_comments(tc_xml);
        if threaded.comments.is_empty() {
            continue;
        }

        let tc_by_id: HashMap<&str, &crate::domain::comments::read::ThreadedComment> = threaded
            .comments
            .iter()
            .map(|tc| (tc.id.as_str(), tc))
            .collect();

        for comment in &mut sheet_data.comments {
            let matched_thread_id = threaded_candidate_ids(comment)
                .find(|id| tc_by_id.contains_key(*id))
                .map(str::to_string);

            if let Some(tc) = matched_thread_id
                .as_deref()
                .and_then(|id| tc_by_id.get(id).copied())
            {
                comment.id = tc.id.clone();
                comment.thread_id = Some(thread_root_id(tc, &tc_by_id));
                comment.person_id = Some(tc.person_id.clone());
                comment.parent_id = tc.parent_id.clone();
                comment.timestamp = tc.created.clone();
                comment.resolved = Some(tc.done);
                comment.ext_lst_xml = tc.ext_lst_xml.clone();
                comment.comment_type = domain_types::domain::comment::CommentType::ThreadedComment;
                comment.xr_uid = None;
                comment.content = Some(tc.text.clone());

                if let Some(name) = person_names.get(tc.person_id.as_str()) {
                    comment.author = name.to_string();
                }

                use domain_types::domain::comment::{CommentContentType, CommentMention};
                comment.mentions = tc
                    .mentions
                    .iter()
                    .map(|m| {
                        let display_text = person_names
                            .get(m.mention_person_id.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_default();
                        CommentMention {
                            display_text,
                            user_id: m.mention_person_id.clone(),
                            email: None,
                            start_index: m.start_index,
                            length: m.length,
                        }
                    })
                    .collect();
                comment.content_type = if comment.mentions.is_empty() {
                    None
                } else {
                    Some(CommentContentType::Mention)
                }
            }
        }

        let existing_ids: HashSet<String> = sheet_data
            .comments
            .iter()
            .filter(|c| {
                c.comment_type == domain_types::domain::comment::CommentType::ThreadedComment
            })
            .filter_map(|c| {
                if c.id.is_empty() {
                    c.thread_id.clone()
                } else {
                    Some(c.id.clone())
                }
            })
            .collect();

        let tc_order: HashMap<&str, usize> = threaded
            .comments
            .iter()
            .enumerate()
            .map(|(i, tc)| (tc.id.as_str(), i))
            .collect();

        for tc in &threaded.comments {
            if existing_ids.contains(tc.id.as_str()) {
                continue;
            }

            let author = person_names
                .get(tc.person_id.as_str())
                .map(|s| s.to_string())
                .unwrap_or_default();

            let (content_type, mentions) = if tc.mentions.is_empty() {
                (None, Vec::new())
            } else {
                use domain_types::domain::comment::{CommentContentType, CommentMention};
                let m: Vec<CommentMention> = tc
                    .mentions
                    .iter()
                    .map(|m| {
                        let display_text = person_names
                            .get(m.mention_person_id.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_default();
                        CommentMention {
                            display_text,
                            user_id: m.mention_person_id.clone(),
                            email: None,
                            start_index: m.start_index,
                            length: m.length,
                        }
                    })
                    .collect();
                (Some(CommentContentType::Mention), m)
            };

            let comment = Comment {
                id: tc.id.clone(),
                cell_ref: tc.cell_ref.clone(),
                author,
                author_id: None,
                author_email: None,
                content: Some(tc.text.clone()),
                runs: Vec::new(),
                thread_id: Some(thread_root_id(tc, &tc_by_id)),
                parent_id: tc.parent_id.clone(),
                person_id: Some(tc.person_id.clone()),
                resolved: Some(tc.done),
                timestamp: tc.created.clone(),
                created_at: None,
                modified_at: None,
                xr_uid: None,
                shape_id: None,
                ext_lst_xml: tc.ext_lst_xml.clone(),
                content_type,
                mentions,
                comment_type: domain_types::domain::comment::CommentType::ThreadedComment,
                visible: None,
                note_height: None,
                note_width: None,
                note_shape_anchor: None,
                comment_pr: None,
            };
            insert_threaded_comment_in_original_order(&mut sheet_data.comments, comment, &tc_order);
        }
    }

    persons
}

fn insert_threaded_comment_in_original_order(
    comments: &mut Vec<Comment>,
    comment: Comment,
    tc_order: &HashMap<&str, usize>,
) {
    let Some(new_order) =
        threaded_comment_order_key(&comment).and_then(|id| tc_order.get(id).copied())
    else {
        comments.push(comment);
        return;
    };

    let mut insert_after: Option<usize> = None;
    let mut insert_before: Option<usize> = None;

    for (idx, existing) in comments.iter().enumerate() {
        let Some(existing_order) =
            threaded_comment_order_key(existing).and_then(|id| tc_order.get(id).copied())
        else {
            continue;
        };

        if existing_order < new_order {
            insert_after = Some(idx);
        } else if existing_order > new_order {
            insert_before = Some(idx);
            break;
        }
    }

    let insert_idx = insert_after
        .map(|idx| idx + 1)
        .or(insert_before)
        .unwrap_or(comments.len());
    comments.insert(insert_idx, comment);
}

fn threaded_comment_order_key(comment: &Comment) -> Option<&str> {
    if !comment.id.is_empty() {
        Some(comment.id.as_str())
    } else {
        comment.thread_id.as_deref()
    }
}

fn thread_root_id(
    comment: &crate::domain::comments::read::ThreadedComment,
    by_id: &HashMap<&str, &crate::domain::comments::read::ThreadedComment>,
) -> String {
    let mut current = comment;
    let mut seen = HashSet::new();
    while let Some(parent_id) = current.parent_id.as_deref() {
        if !seen.insert(current.id.as_str()) {
            break;
        }
        let Some(parent) = by_id.get(parent_id).copied() else {
            break;
        };
        current = parent;
    }
    current.id.clone()
}

pub(super) fn threaded_candidate_ids(comment: &Comment) -> impl Iterator<Item = &str> {
    let author_marker = comment
        .author
        .strip_prefix("tc=")
        .map(str::trim)
        .filter(|id| !id.is_empty());
    let xr_uid = comment
        .xr_uid
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());

    author_marker
        .into_iter()
        .chain(xr_uid)
        .scan(HashSet::new(), |seen, id| {
            if seen.insert(id) {
                Some(Some(id))
            } else {
                Some(None)
            }
        })
        .flatten()
}

fn parse_person_xml(xml: &[u8]) -> Vec<PersonInfo> {
    use crate::infra::scanner::{find_gt_simd, find_tag_simd};
    use crate::infra::xml::parse_string_attr;

    let mut persons = Vec::new();
    let mut pos = 0;

    while let Some(person_start) = find_tag_simd(xml, b"person", pos) {
        let after = person_start + 6;
        if after < xml.len() && xml[after] == b'L' {
            pos = person_start + 1;
            continue;
        }

        let tag_end = find_gt_simd(xml, person_start).unwrap_or(xml.len());
        let element = &xml[person_start..tag_end + 1];

        persons.push(PersonInfo {
            display_name: parse_string_attr(element, b"displayName=\"").unwrap_or_default(),
            id: parse_string_attr(element, b"id=\"").unwrap_or_default(),
            user_id: parse_string_attr(element, b"userId=\""),
            provider_id: parse_string_attr(element, b"providerId=\""),
        });

        pos = tag_end + 1;
    }

    persons
}
