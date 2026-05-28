use quick_xml::events::Event;
use quick_xml::events::attributes::Attribute;
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::reader::NsReader;

use super::api::ExpandedName;
use super::tree::{Document, Element, Node};

pub(super) fn parse(input: &[u8]) -> Result<Document, String> {
    let mut reader = NsReader::from_reader(input);
    reader.config_mut().trim_text(false);
    reader.config_mut().expand_empty_elements = false;

    let mut buf = Vec::new();
    let mut stack: Vec<Element> = Vec::new();
    let mut root: Option<Element> = None;

    loop {
        let (ns_result, event) = match reader.read_resolved_event_into(&mut buf) {
            Ok(v) => v,
            Err(e) => {
                return Err(format!(
                    "quick-xml error at byte {}: {}",
                    reader.buffer_position(),
                    e
                ));
            }
        };

        match event {
            Event::Start(ref start) => {
                let name = expand(&ns_result, start.local_name().as_ref())?;
                let parent_preserve = stack.last().map(|e| e.preserve_space).unwrap_or(false);
                let attrs = collect_attributes(&reader, start)?;
                let preserve = attr_space_preserve(&attrs).unwrap_or(parent_preserve);
                stack.push(Element {
                    name,
                    attrs,
                    children: Vec::new(),
                    preserve_space: preserve,
                });
            }
            Event::End(_) => {
                let done = stack
                    .pop()
                    .ok_or_else(|| "unbalanced end tag".to_string())?;
                match stack.last_mut() {
                    Some(parent) => parent.children.push(Node::Element(done)),
                    None => {
                        if root.is_some() {
                            return Err("multiple root elements".to_string());
                        }
                        root = Some(done);
                    }
                }
            }
            Event::Empty(ref start) => {
                let name = expand(&ns_result, start.local_name().as_ref())?;
                let parent_preserve = stack.last().map(|e| e.preserve_space).unwrap_or(false);
                let attrs = collect_attributes(&reader, start)?;
                let preserve = attr_space_preserve(&attrs).unwrap_or(parent_preserve);
                let empty = Element {
                    name,
                    attrs,
                    children: Vec::new(),
                    preserve_space: preserve,
                };
                match stack.last_mut() {
                    Some(parent) => parent.children.push(Node::Element(empty)),
                    None => {
                        if root.is_some() {
                            return Err("multiple root elements".to_string());
                        }
                        root = Some(empty);
                    }
                }
            }
            Event::Text(ref t) => {
                let s = t
                    .unescape()
                    .map_err(|e| format!("text unescape error: {e}"))?
                    .into_owned();
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(Node::Text(s));
                }
            }
            Event::CData(ref c) => {
                let bytes: &[u8] = c.as_ref();
                let s = String::from_utf8(bytes.to_vec())
                    .map_err(|e| format!("cdata utf8 error: {e}"))?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(Node::Text(s));
                }
            }
            Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {}
            Event::Eof => break,
        }
        buf.clear();
    }

    if !stack.is_empty() {
        return Err(format!("{} unclosed element(s) at EOF", stack.len()));
    }

    Ok(Document { root })
}

fn expand(ns: &ResolveResult<'_>, local: &[u8]) -> Result<ExpandedName, String> {
    let local = std::str::from_utf8(local)
        .map_err(|e| format!("non-utf8 local name: {e}"))?
        .to_string();
    let namespace = match ns {
        ResolveResult::Bound(Namespace(uri)) => std::str::from_utf8(uri)
            .map_err(|e| format!("non-utf8 namespace uri: {e}"))?
            .to_string(),
        ResolveResult::Unbound => String::new(),
        ResolveResult::Unknown(prefix) => {
            let prefix = std::str::from_utf8(prefix).unwrap_or("(non-utf8)");
            return Err(format!("unknown namespace prefix: {prefix}"));
        }
    };
    Ok(ExpandedName { namespace, local })
}

fn collect_attributes(
    reader: &NsReader<&[u8]>,
    start: &quick_xml::events::BytesStart<'_>,
) -> Result<Vec<(ExpandedName, String)>, String> {
    let mut out = Vec::new();
    for attr in start.attributes() {
        let attr: Attribute<'_> = attr.map_err(|e| format!("attribute parse error: {e}"))?;
        let key_bytes: &[u8] = attr.key.as_ref();
        if key_bytes == b"xmlns" || key_bytes.starts_with(b"xmlns:") {
            continue;
        }

        let (ns_result, local) = reader.resolve_attribute(attr.key);
        let name = expand(&ns_result, local.as_ref())?;
        let value = attr
            .unescape_value()
            .map_err(|e| format!("attribute unescape error: {e}"))?
            .into_owned();
        out.push((name, value));
    }
    Ok(out)
}

fn attr_space_preserve(attrs: &[(ExpandedName, String)]) -> Option<bool> {
    const XML_NS: &str = "http://www.w3.org/XML/1998/namespace";
    for (name, value) in attrs {
        if name.local == "space" && name.namespace == XML_NS {
            return Some(value == "preserve");
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::{XmlDiff, XmlDiffOptions, structural_diff};

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
    fn namespace_prefix_canonicalized() {
        let left = r#"<c:chart xmlns:c="http://example.com/c"/>"#;
        let right = r#"<chart xmlns="http://example.com/c"/>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn different_namespace_prefixes_same_uri_equal() {
        let left = r#"<a:root xmlns:a="http://example.com/ns"><a:child/></a:root>"#;
        let right = r#"<b:root xmlns:b="http://example.com/ns"><b:child/></b:root>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn different_namespace_uris_not_equal() {
        let left = r#"<a:root xmlns:a="http://example.com/ns1"/>"#;
        let right = r#"<a:root xmlns:a="http://example.com/ns2"/>"#;
        let (path, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(reason.contains("element name differs"), "reason={reason}");
        assert!(path.starts_with('/'), "path={path}");
    }

    #[test]
    fn cdata_compared_as_text() {
        let left = r#"<root><t><![CDATA[hello]]></t></root>"#;
        let right = r#"<root><t>hello</t></root>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn comments_ignored() {
        let left = r#"<root><!-- a comment --><a/></root>"#;
        let right = r#"<root><a/></root>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn xml_declaration_ignored() {
        let left = r#"<?xml version="1.0" encoding="UTF-8"?><root/>"#;
        let right = r#"<root/>"#;
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn unparseable_left_reports_error() {
        let (path, reason) = differ("<root><unclosed>", "<root/>", &XmlDiffOptions::default());
        assert_eq!(path, "/");
        assert!(
            reason.contains("left document failed to parse"),
            "reason={reason}"
        );
    }

    #[test]
    fn empty_documents_compare_equal() {
        eq("", "", &XmlDiffOptions::default());
        eq(
            r#"<?xml version="1.0"?><!-- metadata only -->"#,
            "",
            &XmlDiffOptions::default(),
        );
    }

    #[test]
    fn metadata_only_document_differs_from_rooted_document() {
        let (path, reason) = differ(
            r#"<?xml version="1.0"?><!-- metadata only -->"#,
            "<root/>",
            &XmlDiffOptions::default(),
        );
        assert_eq!(path, "/");
        assert!(
            reason.contains("left document has no root element"),
            "reason={reason}"
        );
    }

    #[test]
    fn unknown_namespace_prefix_reports_parse_side_diff() {
        match structural_diff(b"<p:root/>", b"<root/>", &XmlDiffOptions::default()) {
            XmlDiff::Differ {
                path,
                left: Some(left),
                right: None,
                reason,
            } => {
                assert_eq!(path, "/");
                assert!(left.contains("parse error:"), "left={left}");
                assert!(left.contains("unknown namespace prefix"), "left={left}");
                assert!(
                    reason.contains("left document failed to parse"),
                    "reason={reason}"
                );
            }
            other => panic!("expected left parse-side diff; got {other:?}"),
        }
    }

    #[test]
    fn processing_instruction_and_doctype_ignored() {
        let left = r#"<?pi test?><!DOCTYPE root><root/>"#;
        let right = r#"<root/>"#;
        eq(left, right, &XmlDiffOptions::default());
    }
}
