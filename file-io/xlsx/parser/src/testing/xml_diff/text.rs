use super::tree::Node;

pub(super) fn has_nonwhitespace_text(children: &[Node]) -> bool {
    children
        .iter()
        .any(|c| matches!(c, Node::Text(t) if t.chars().any(|ch| !ch.is_whitespace())))
}

pub(super) fn filter_children(children: &[Node], significant_text: bool) -> Vec<&Node> {
    if significant_text {
        children.iter().collect()
    } else {
        children
            .iter()
            .filter(|c| !matches!(c, Node::Text(_)))
            .collect()
    }
}

/// Collapse runs of inner whitespace to a single space unless
/// `xml:space="preserve"` is in scope. Non-whitespace characters are
/// preserved verbatim.
///
/// Leading/trailing whitespace is NOT stripped, since an element like
/// `<t xml:space="preserve"> hello </t>` legitimately carries leading and
/// trailing spaces that round-trip.
pub(super) fn normalize_text(s: &str, preserve_space: bool) -> String {
    if preserve_space {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut last_was_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !last_was_ws {
                out.push(' ');
                last_was_ws = true;
            }
        } else {
            out.push(ch);
            last_was_ws = false;
        }
    }
    out
}

pub(super) fn push_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}
