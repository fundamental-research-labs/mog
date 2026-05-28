use std::collections::HashMap;

use super::api::{ExpandedName, XmlDiff, XmlDiffOptions};
use super::text::{filter_children, has_nonwhitespace_text, normalize_text, push_path};
use super::tree::{Document, Element, Node};

pub(super) fn compare_documents(
    left: &Document,
    right: &Document,
    options: &XmlDiffOptions,
) -> XmlDiff {
    match (&left.root, &right.root) {
        (Some(a), Some(b)) => compare_elements(a, b, "", "", options),
        (None, None) => XmlDiff::Equal,
        (Some(a), None) => XmlDiff::Differ {
            path: "/".to_string(),
            left: Some(a.name.to_string()),
            right: None,
            reason: "right document has no root element".to_string(),
        },
        (None, Some(b)) => XmlDiff::Differ {
            path: "/".to_string(),
            left: None,
            right: Some(b.name.to_string()),
            reason: "left document has no root element".to_string(),
        },
    }
}

fn compare_elements(
    left: &Element,
    right: &Element,
    parent_expanded_path: &str,
    parent_local_path: &str,
    options: &XmlDiffOptions,
) -> XmlDiff {
    if left.name != right.name {
        return XmlDiff::Differ {
            path: push_path(parent_expanded_path, &left.name.to_string()),
            left: Some(left.name.to_string()),
            right: Some(right.name.to_string()),
            reason: "element name differs".to_string(),
        };
    }

    let expanded_path = push_path(parent_expanded_path, &left.name.to_string());
    let local_path = push_path(parent_local_path, &left.name.local);

    if let Some(diff) = compare_attributes(
        &left.name,
        &left.attrs,
        &right.attrs,
        &expanded_path,
        options,
    ) {
        return diff;
    }

    compare_children(left, right, &expanded_path, &local_path, options)
}

fn compare_attributes(
    element: &ExpandedName,
    left: &[(ExpandedName, String)],
    right: &[(ExpandedName, String)],
    path: &str,
    options: &XmlDiffOptions,
) -> Option<XmlDiff> {
    let mut left_map: HashMap<ExpandedName, String> =
        left.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    let mut right_map: HashMap<ExpandedName, String> =
        right.iter().map(|(k, v)| (k.clone(), v.clone())).collect();

    let mut keys: Vec<ExpandedName> = left_map.keys().chain(right_map.keys()).cloned().collect();
    keys.sort();
    keys.dedup();

    for key in &keys {
        let default_value = options
            .attribute_defaults
            .get(&(element.clone(), key.clone()));
        if let Some(default_value) = default_value {
            let in_left = left_map.get(key).cloned();
            let in_right = right_map.get(key).cloned();
            match (in_left, in_right) {
                (Some(lv), None) if &lv == default_value => {
                    left_map.remove(key);
                }
                (None, Some(rv)) if &rv == default_value => {
                    right_map.remove(key);
                }
                _ => {}
            }
        }
    }

    let mut left_sorted: Vec<(ExpandedName, String)> = left_map.into_iter().collect();
    let mut right_sorted: Vec<(ExpandedName, String)> = right_map.into_iter().collect();
    left_sorted.sort_by(|a, b| a.0.cmp(&b.0));
    right_sorted.sort_by(|a, b| a.0.cmp(&b.0));

    if left_sorted.len() != right_sorted.len() {
        let extra_left: Vec<_> = left_sorted
            .iter()
            .filter(|(k, _)| !right_sorted.iter().any(|(rk, _)| rk == k))
            .map(|(k, _)| k.to_string())
            .collect();
        let extra_right: Vec<_> = right_sorted
            .iter()
            .filter(|(k, _)| !left_sorted.iter().any(|(lk, _)| lk == k))
            .map(|(k, _)| k.to_string())
            .collect();
        return Some(XmlDiff::Differ {
            path: format!("{path}/@*"),
            left: Some(format!("extra on left: [{}]", extra_left.join(", "))),
            right: Some(format!("extra on right: [{}]", extra_right.join(", "))),
            reason: format!(
                "attribute-set size differs ({} vs {})",
                left_sorted.len(),
                right_sorted.len()
            ),
        });
    }

    for ((lk, lv), (rk, rv)) in left_sorted.iter().zip(right_sorted.iter()) {
        if lk != rk {
            return Some(XmlDiff::Differ {
                path: format!("{path}/@{lk}"),
                left: Some(lk.to_string()),
                right: Some(rk.to_string()),
                reason: "attribute names differ after sort".to_string(),
            });
        }
        if lv != rv {
            return Some(XmlDiff::Differ {
                path: format!("{path}/@{lk}"),
                left: Some(lv.clone()),
                right: Some(rv.clone()),
                reason: "attribute value differs".to_string(),
            });
        }
    }

    None
}

fn compare_children(
    left: &Element,
    right: &Element,
    expanded_path: &str,
    local_path: &str,
    options: &XmlDiffOptions,
) -> XmlDiff {
    let significant_text = left.preserve_space
        || right.preserve_space
        || has_nonwhitespace_text(&left.children)
        || has_nonwhitespace_text(&right.children);

    let left_seq = filter_children(&left.children, significant_text);
    let right_seq = filter_children(&right.children, significant_text);

    let unordered = options.contains_path(expanded_path, local_path);

    if unordered {
        return compare_children_unordered(
            &left_seq,
            &right_seq,
            expanded_path,
            local_path,
            options,
        );
    }

    compare_children_ordered(
        &left_seq,
        &right_seq,
        expanded_path,
        local_path,
        options,
        left.preserve_space || right.preserve_space,
    )
}

fn compare_children_ordered(
    left: &[&Node],
    right: &[&Node],
    expanded_path: &str,
    local_path: &str,
    options: &XmlDiffOptions,
    preserve_space: bool,
) -> XmlDiff {
    if left.len() != right.len() {
        return XmlDiff::Differ {
            path: expanded_path.to_string(),
            left: Some(format!("{} children", left.len())),
            right: Some(format!("{} children", right.len())),
            reason: "child count differs".to_string(),
        };
    }
    for (i, (l, r)) in left.iter().zip(right.iter()).enumerate() {
        match (l, r) {
            (Node::Element(le), Node::Element(re)) => {
                let diff = compare_elements(le, re, expanded_path, local_path, options);
                if let XmlDiff::Differ { .. } = diff {
                    return diff;
                }
            }
            (Node::Text(lt), Node::Text(rt)) => {
                let lnorm = normalize_text(lt, preserve_space);
                let rnorm = normalize_text(rt, preserve_space);
                if lnorm != rnorm {
                    return XmlDiff::Differ {
                        path: format!("{expanded_path}/text()[{i}]"),
                        left: Some(lnorm),
                        right: Some(rnorm),
                        reason: "text content differs".to_string(),
                    };
                }
            }
            (Node::Element(e), Node::Text(t)) | (Node::Text(t), Node::Element(e)) => {
                let (left_s, right_s, reason) = if matches!(l, Node::Element(_)) {
                    (
                        format!("<{}>", e.name),
                        format!("text {t:?}"),
                        "element on left, text on right",
                    )
                } else {
                    (
                        format!("text {t:?}"),
                        format!("<{}>", e.name),
                        "text on left, element on right",
                    )
                };
                return XmlDiff::Differ {
                    path: format!("{expanded_path}/*[{i}]"),
                    left: Some(left_s),
                    right: Some(right_s),
                    reason: reason.to_string(),
                };
            }
        }
    }
    XmlDiff::Equal
}

fn compare_children_unordered(
    left: &[&Node],
    right: &[&Node],
    expanded_path: &str,
    local_path: &str,
    options: &XmlDiffOptions,
) -> XmlDiff {
    let left_elems: Vec<&Element> = left
        .iter()
        .filter_map(|n| match n {
            Node::Element(e) => Some(e),
            Node::Text(_) => None,
        })
        .collect();
    let right_elems: Vec<&Element> = right
        .iter()
        .filter_map(|n| match n {
            Node::Element(e) => Some(e),
            Node::Text(_) => None,
        })
        .collect();

    if left_elems.len() != right_elems.len() {
        return XmlDiff::Differ {
            path: expanded_path.to_string(),
            left: Some(format!("{} elements", left_elems.len())),
            right: Some(format!("{} elements", right_elems.len())),
            reason: "unordered-child element count differs".to_string(),
        };
    }

    let mut matched = vec![false; right_elems.len()];
    'outer: for le in &left_elems {
        for (i, re) in right_elems.iter().enumerate() {
            if matched[i] {
                continue;
            }
            let diff = compare_elements(le, re, expanded_path, local_path, options);
            if let XmlDiff::Equal = diff {
                matched[i] = true;
                continue 'outer;
            }
        }
        return XmlDiff::Differ {
            path: push_path(expanded_path, &le.name.to_string()),
            left: Some(format!("<{}>", le.name)),
            right: Some("(no match)".to_string()),
            reason: "unordered-child on left has no structurally-equal match on right".to_string(),
        };
    }
    XmlDiff::Equal
}

#[cfg(test)]
mod tests {
    use super::super::{ExpandedName, XmlDiff, XmlDiffOptions, structural_diff};

    fn eq(left: &str, right: &str, opts: &XmlDiffOptions) {
        match structural_diff(left.as_bytes(), right.as_bytes(), opts) {
            XmlDiff::Equal => {}
            XmlDiff::Differ {
                path,
                left,
                right,
                reason,
            } => panic!(
                "expected Equal; got Differ at {path}: {reason}\n  left:  {left:?}\n  right: {right:?}",
            ),
        }
    }

    fn differ(left: &str, right: &str, opts: &XmlDiffOptions) -> (String, String) {
        match structural_diff(left.as_bytes(), right.as_bytes(), opts) {
            XmlDiff::Equal => panic!("expected Differ; got Equal"),
            XmlDiff::Differ { path, reason, .. } => (path, reason),
        }
    }

    #[test]
    fn attribute_order_insignificant() {
        let left = r#"<e a="1" b="2"/>"#;
        let right = r#"<e b="2" a="1"/>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn attribute_value_differs_reports_path() {
        let left = r#"<root><e a="1"/></root>"#;
        let right = r#"<root><e a="2"/></root>"#;
        let (path, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(path.contains("/root/e/@a"), "path={path}");
        assert!(
            reason.contains("attribute value differs"),
            "reason={reason}"
        );
    }

    #[test]
    fn missing_attribute_reports_extras() {
        let left = r#"<e a="1" b="2"/>"#;
        let right = r#"<e a="1"/>"#;
        let (_, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(reason.contains("size differs"), "reason={reason}");
    }

    #[test]
    fn default_attribute_elision_equal() {
        let mut opts = XmlDiffOptions::default();
        opts.attribute_defaults.insert(
            (ExpandedName::unbound("e"), ExpandedName::unbound("a")),
            "1".to_string(),
        );
        eq(r#"<e a="1"/>"#, r#"<e/>"#, &opts);
        eq(r#"<e/>"#, r#"<e a="1"/>"#, &opts);
    }

    #[test]
    fn non_default_attribute_not_elided() {
        let mut opts = XmlDiffOptions::default();
        opts.attribute_defaults.insert(
            (ExpandedName::unbound("e"), ExpandedName::unbound("a")),
            "1".to_string(),
        );
        let (_, reason) = differ(r#"<e a="2"/>"#, r#"<e/>"#, &opts);
        assert!(reason.contains("size differs"), "reason={reason}");
    }

    #[test]
    fn seeded_ct_color_indexed_default() {
        let opts = XmlDiffOptions::with_common_defaults();
        let left = r#"<color xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" indexed="0"/>"#;
        let right = r#"<color xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>"#;
        eq(left, right, &opts);
    }

    #[test]
    fn seeded_default_attribute_elision_equal_when_present_on_right() {
        let opts = XmlDiffOptions::with_common_defaults();
        let left = r#"<color xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>"#;
        let right = r#"<color xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" auto="false"/>"#;
        eq(left, right, &opts);
    }

    #[test]
    fn whitespace_between_elements_insignificant() {
        let left = r#"<root><a/><b/></root>"#;
        let right = "<root>\n  <a/>\n  <b/>\n</root>";
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn mixed_content_whitespace_collapsed() {
        let (_, reason) = differ(
            r#"<p>hello</p>"#,
            r#"<p> hello </p>"#,
            &XmlDiffOptions::default(),
        );
        assert!(reason.contains("text content differs"), "reason={reason}");
    }

    #[test]
    fn mixed_content_inner_whitespace_run_collapses() {
        eq(
            r#"<p>a  b</p>"#,
            r#"<p>a b</p>"#,
            &XmlDiffOptions::default(),
        );
    }

    #[test]
    fn xml_space_preserve_keeps_whitespace() {
        let left = r#"<p xml:space="preserve">a  b</p>"#;
        let right = r#"<p xml:space="preserve">a b</p>"#;
        let (_, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(reason.contains("text content differs"), "reason={reason}");
    }

    #[test]
    fn xml_space_default_overrides_inherited_preserve() {
        let left = r#"<root xml:space="preserve"><t xml:space="default">a  b</t></root>"#;
        let right = r#"<root xml:space="preserve"><t xml:space="default">a b</t></root>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn text_run_content_differs() {
        let left = r#"<root><t>hello</t></root>"#;
        let right = r#"<root><t>world</t></root>"#;
        let (path, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(reason.contains("text content differs"), "reason={reason}");
        assert!(path.contains("/root/t"), "path={path}");
    }

    #[test]
    fn element_order_significant_by_default() {
        let left = r#"<root><a/><b/></root>"#;
        let right = r#"<root><b/><a/></root>"#;
        let (_, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(reason.contains("element name differs"), "reason={reason}");
    }

    #[test]
    fn element_order_insignificant_when_path_allowlisted() {
        let mut opts = XmlDiffOptions::default();
        opts.unordered_element_paths.insert("/root".to_string());
        let left = r#"<root><a/><b/></root>"#;
        let right = r#"<root><b/><a/></root>"#;
        eq(left, right, &opts);
    }

    #[test]
    fn unordered_mismatch_reports_unmatched() {
        let mut opts = XmlDiffOptions::default();
        opts.unordered_element_paths.insert("/root".to_string());
        let left = r#"<root><a/><b/></root>"#;
        let right = r#"<root><a/><c/></root>"#;
        let (_, reason) = differ(left, right, &opts);
        assert!(
            reason.contains("no structurally-equal match"),
            "reason={reason}"
        );
    }

    #[test]
    fn unordered_with_expanded_path() {
        let mut opts = XmlDiffOptions::default();
        opts.unordered_element_paths
            .insert("/{http://example.com/ns}root".to_string());
        let left = r#"<r:root xmlns:r="http://example.com/ns"><r:a/><r:b/></r:root>"#;
        let right = r#"<r:root xmlns:r="http://example.com/ns"><r:b/><r:a/></r:root>"#;
        eq(left, right, &opts);
    }

    #[test]
    fn unordered_container_ignores_whitespace_text_children() {
        let mut opts = XmlDiffOptions::default();
        opts.unordered_element_paths.insert("/root".to_string());
        let left = "<root>\n  <a/>\n  <b/>\n</root>";
        let right = "<root>\n  <b/>\n  <a/>\n</root>";
        eq(left, right, &opts);
    }

    #[test]
    fn element_name_mismatch_reports_names() {
        let left = r#"<root><a/></root>"#;
        let right = r#"<root><b/></root>"#;
        match structural_diff(
            left.as_bytes(),
            right.as_bytes(),
            &XmlDiffOptions::default(),
        ) {
            XmlDiff::Differ {
                left: Some(ls),
                right: Some(rs),
                reason,
                ..
            } => {
                assert!(ls.contains('a'), "ls={ls}");
                assert!(rs.contains('b'), "rs={rs}");
                assert!(reason.contains("element name differs"), "reason={reason}");
            }
            other => panic!("expected Differ with left/right populated; got {other:?}"),
        }
    }

    #[test]
    fn nested_structure_equal() {
        let left = r#"<root><a><b x="1"/><c/></a></root>"#;
        let right = r#"<root><a><b x="1"/><c/></a></root>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn nested_inner_attribute_diff_reports_deep_path() {
        let left = r#"<root><a><b x="1"/></a></root>"#;
        let right = r#"<root><a><b x="2"/></a></root>"#;
        let (path, _) = differ(left, right, &XmlDiffOptions::default());
        assert!(path.contains("/root/a/b/@x"), "path={path}");
    }

    #[test]
    fn ooxml_chart_axis_structural_equality() {
        let left = r#"<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
  <c:plotArea>
    <c:catAx>
      <c:axId val="1" id="a"/>
      <c:delete val="0"/>
    </c:catAx>
  </c:plotArea>
</c:chart>"#;
        let right = r#"<chart xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart">
<plotArea><catAx>
<axId id="a" val="1"/><delete val="0"/>
</catAx></plotArea>
</chart>"#;
        let opts = XmlDiffOptions::with_common_defaults();
        eq(left, right, &opts);
    }
}
