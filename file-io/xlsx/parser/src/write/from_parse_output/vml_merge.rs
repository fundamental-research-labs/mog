use domain_types::Comment;

pub(super) fn form_control_base_shape_id(comments: &[Comment]) -> u32 {
    1025 + comments
        .iter()
        .filter(|comment| comment.parent_id.is_none())
        .count() as u32
}

pub(super) fn merge_form_controls_into_comment_vml(
    comment_vml: &[u8],
    form_control_vml: &[u8],
) -> Option<Vec<u8>> {
    let comment_vml = std::str::from_utf8(comment_vml).ok()?;
    let form_control_vml = std::str::from_utf8(form_control_vml).ok()?;
    let insert_at = comment_vml.rfind("</xml>")?;
    let control_inner = form_control_vml.find("<v:shapetype").and_then(|start| {
        form_control_vml
            .rfind("</xml>")
            .map(|end| &form_control_vml[start..end])
    })?;

    let mut merged = Vec::with_capacity(comment_vml.len() + control_inner.len());
    merged.extend_from_slice(&comment_vml.as_bytes()[..insert_at]);
    merged.extend_from_slice(control_inner.as_bytes());
    merged.extend_from_slice(&comment_vml.as_bytes()[insert_at..]);
    Some(merged)
}
