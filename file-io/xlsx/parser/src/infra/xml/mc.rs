use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};
use crate::infra::xml_fragment::extract_element_bounds;
use crate::infra::xml_namespaces::{NS_X14, NS_X15, NamespaceMap};

use super::attrs::parse_string_attr;

/// Namespaces we understand and can render.
pub const MC_SUPPORTED_NAMESPACES: &[&str] = &[
    "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
    "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main",
];

/// Namespaces supported while parsing DrawingML `mc:AlternateContent`.
pub const MC_DRAWING_MARKUP_SUPPORTED_NAMESPACES: &[&str] = &[
    "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
    "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main",
    "http://schemas.microsoft.com/office/drawing/2010/main",
];

pub const MC_RELATIONSHIPS_NAMESPACE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Namespaces supported while parsing worksheet-level control and OLE markup.
///
/// `r` is intentionally contextual: it is supported when namespace resolution
/// proves the prefix maps to the package relationships namespace.
pub const MC_WORKSHEET_MARKUP_SUPPORTED_NAMESPACES: &[&str] = &[
    "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
    "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main",
    MC_RELATIONSHIPS_NAMESPACE,
];

/// Result of resolving an `mc:AlternateContent` element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct McBranch {
    pub start: usize,
    pub end: usize,
    pub is_choice: bool,
}

/// Result of resolving an `mc:AlternateContent` element with preservation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McResolution {
    Resolved(McBranch),
    Preserved(String),
    Empty,
}

/// Shared branch-selection outcome for `mc:AlternateContent`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McAlternateContentOutcome {
    ChoiceSelected(McBranch),
    FallbackSelected(McBranch),
    RawPreserved {
        raw_xml: String,
        diagnostics: Vec<String>,
    },
    Empty,
    Invalid {
        diagnostics: Vec<String>,
    },
}

type PrefixResolver = dyn Fn(&str) -> Option<&'static str>;

pub fn resolve_mc_alternate_content_with_namespaces(
    xml: &[u8],
    namespaces: Option<&NamespaceMap>,
) -> McAlternateContentOutcome {
    resolve_mc_alternate_content_with_supported_namespaces(xml, namespaces, MC_SUPPORTED_NAMESPACES)
}

pub fn resolve_mc_alternate_content_with_supported_namespaces(
    xml: &[u8],
    namespaces: Option<&NamespaceMap>,
    supported_namespaces: &[&str],
) -> McAlternateContentOutcome {
    let mut diagnostics = parse_mce_processing_diagnostics(xml, namespaces, supported_namespaces);
    let mut saw_choice = false;

    let mut pos: usize = 0;
    while let Some(choice_start) = find_tag_simd(xml, b"mc:Choice", pos) {
        saw_choice = true;
        let choice_elem_end = find_gt_simd(xml, choice_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let choice_elem = &xml[choice_start..choice_elem_end];

        if let Some(requires) = parse_string_attr(choice_elem, b"Requires=\"") {
            if !requires.is_empty()
                && requires.split_whitespace().all(|pfx| {
                    namespace_for_prefix(pfx, namespaces)
                        .is_some_and(|uri| supported_namespaces.contains(&uri))
                })
            {
                let content_start = choice_elem_end;
                let choice_end = extract_element_bounds(xml, choice_start)
                    .map(|(_, end)| end)
                    .unwrap_or(xml.len());
                let content_end =
                    closing_start_before(xml, content_start, choice_end).unwrap_or(choice_end);

                return McAlternateContentOutcome::ChoiceSelected(McBranch {
                    start: content_start,
                    end: content_end,
                    is_choice: true,
                });
            }

            diagnostics.push(format!("unsupported mc:Choice Requires='{}'", requires));
        } else {
            diagnostics.push("mc:Choice missing Requires".to_string());
        }

        pos = extract_element_bounds(xml, choice_start)
            .map(|(_, end)| end)
            .unwrap_or(choice_elem_end);
    }

    if let Some(fb_start) = find_tag_simd(xml, b"mc:Fallback", 0) {
        let fb_elem_end = find_gt_simd(xml, fb_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        if fb_elem_end >= 2 && xml[fb_elem_end - 2] == b'/' {
            return McAlternateContentOutcome::Empty;
        }

        let content_start = fb_elem_end;
        let fallback_end = extract_element_bounds(xml, fb_start)
            .map(|(_, end)| end)
            .unwrap_or(xml.len());
        let content_end =
            closing_start_before(xml, content_start, fallback_end).unwrap_or(fallback_end);

        return McAlternateContentOutcome::FallbackSelected(McBranch {
            start: content_start,
            end: content_end,
            is_choice: false,
        });
    }

    if saw_choice {
        diagnostics.push("no supported mc:Choice and no mc:Fallback".to_string());
        return McAlternateContentOutcome::RawPreserved {
            raw_xml: String::from_utf8_lossy(xml).into_owned(),
            diagnostics,
        };
    }

    if diagnostics.is_empty() {
        McAlternateContentOutcome::Empty
    } else {
        McAlternateContentOutcome::Invalid { diagnostics }
    }
}

fn closing_start_before(xml: &[u8], content_start: usize, element_end: usize) -> Option<usize> {
    memchr::memrchr(b'<', xml.get(content_start..element_end)?).map(|offset| content_start + offset)
}

pub fn resolve_mc_alternate_content(
    xml: &[u8],
    prefix_resolver: Option<&PrefixResolver>,
) -> Option<McBranch> {
    fn default_resolver(prefix: &str) -> Option<&'static str> {
        match prefix {
            "x14" => Some("http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"),
            "x15" => Some("http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"),
            _ => None,
        }
    }

    let mut pos: usize = 0;
    while let Some(choice_start) = find_tag_simd(xml, b"mc:Choice", pos) {
        let choice_elem_end = find_gt_simd(xml, choice_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let choice_elem = &xml[choice_start..choice_elem_end];

        if let Some(requires) = parse_string_attr(choice_elem, b"Requires=\"") {
            let supported = requires.split_whitespace().all(|pfx| {
                let uri = if let Some(resolver) = prefix_resolver {
                    resolver(pfx)
                } else {
                    default_resolver(pfx)
                };
                match uri {
                    Some(u) => MC_SUPPORTED_NAMESPACES.contains(&u),
                    None => false,
                }
            });

            if supported && !requires.is_empty() {
                let content_start = choice_elem_end;
                let content_end =
                    find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(xml.len());

                return Some(McBranch {
                    start: content_start,
                    end: content_end,
                    is_choice: true,
                });
            }
        }

        let choice_close =
            find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(choice_elem_end);
        pos = find_gt_simd(xml, choice_close)
            .map(|p| p + 1)
            .unwrap_or(choice_close + 1);
    }

    if let Some(fb_start) = find_tag_simd(xml, b"mc:Fallback", 0) {
        let fb_elem_end = find_gt_simd(xml, fb_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        if fb_elem_end >= 2 && xml[fb_elem_end - 2] == b'/' {
            return Some(McBranch {
                start: fb_elem_end,
                end: fb_elem_end,
                is_choice: false,
            });
        }

        let content_start = fb_elem_end;
        let content_end = find_closing_tag(xml, b"mc:Fallback", fb_start).unwrap_or(xml.len());

        return Some(McBranch {
            start: content_start,
            end: content_end,
            is_choice: false,
        });
    }

    None
}

pub fn resolve_mc_alternate_content_with_namespace_context(
    xml: &[u8],
    containing_xml: Option<&[u8]>,
    supported_namespaces: &[&str],
) -> Option<McBranch> {
    resolve_mc_alternate_content_with_policy(xml, containing_xml, supported_namespaces, false)
        .resolved()
}

pub fn resolve_mc_alternate_content_v2(
    xml: &[u8],
    prefix_resolver: Option<&PrefixResolver>,
) -> McResolution {
    fn default_resolver(prefix: &str) -> Option<&'static str> {
        match prefix {
            "x14" => Some("http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"),
            "x15" => Some("http://schemas.microsoft.com/office/spreadsheetml/2010/11/main"),
            _ => None,
        }
    }

    let mut has_unsupported_choice = false;

    let mut pos: usize = 0;
    while let Some(choice_start) = find_tag_simd(xml, b"mc:Choice", pos) {
        let choice_elem_end = find_gt_simd(xml, choice_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let choice_elem = &xml[choice_start..choice_elem_end];

        if let Some(requires) = parse_string_attr(choice_elem, b"Requires=\"") {
            let supported = !requires.is_empty()
                && requires.split_whitespace().all(|pfx| {
                    let uri = if let Some(resolver) = prefix_resolver {
                        resolver(pfx)
                    } else {
                        default_resolver(pfx)
                    };
                    match uri {
                        Some(u) => MC_SUPPORTED_NAMESPACES.contains(&u),
                        None => false,
                    }
                });

            if supported {
                let content_start = choice_elem_end;
                let choice_end = extract_element_bounds(xml, choice_start)
                    .map(|(_, end)| end)
                    .unwrap_or(xml.len());
                let content_end =
                    closing_start_before(xml, content_start, choice_end).unwrap_or(choice_end);

                return McResolution::Resolved(McBranch {
                    start: content_start,
                    end: content_end,
                    is_choice: true,
                });
            } else {
                has_unsupported_choice = true;
            }
        }

        pos = extract_element_bounds(xml, choice_start)
            .map(|(_, end)| end)
            .unwrap_or(choice_elem_end);
    }

    if has_unsupported_choice {
        return McResolution::Preserved(String::from_utf8_lossy(xml).into_owned());
    }

    if let Some(fb_start) = find_tag_simd(xml, b"mc:Fallback", 0) {
        let fb_elem_end = find_gt_simd(xml, fb_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        if fb_elem_end >= 2 && xml[fb_elem_end - 2] == b'/' {
            return McResolution::Empty;
        }

        let content_start = fb_elem_end;
        let fallback_end = extract_element_bounds(xml, fb_start)
            .map(|(_, end)| end)
            .unwrap_or(xml.len());
        let content_end =
            closing_start_before(xml, content_start, fallback_end).unwrap_or(fallback_end);

        return McResolution::Resolved(McBranch {
            start: content_start,
            end: content_end,
            is_choice: false,
        });
    }

    McResolution::Empty
}

fn namespace_for_prefix<'a>(prefix: &str, namespaces: Option<&'a NamespaceMap>) -> Option<&'a str> {
    namespaces
        .and_then(|ns| ns.get_uri(prefix))
        .or_else(|| match prefix {
            "x14" => Some(NS_X14),
            "x15" => Some(NS_X15),
            _ => None,
        })
}

fn parse_mce_processing_diagnostics(
    xml: &[u8],
    namespaces: Option<&NamespaceMap>,
    supported_namespaces: &[&str],
) -> Vec<String> {
    let ac_elem_end = find_gt_simd(xml, 0).map(|p| p + 1).unwrap_or(xml.len());
    let ac_elem = &xml[..ac_elem_end];
    let mut diagnostics = Vec::new();

    for (attr, label) in [
        (b"MustUnderstand=\"" as &[u8], "MustUnderstand"),
        (b"ProcessContent=\"" as &[u8], "ProcessContent"),
    ] {
        if let Some(value) = parse_string_attr(ac_elem, attr) {
            for prefix in value.split_whitespace() {
                let supported = namespace_for_prefix(prefix, namespaces)
                    .is_some_and(|uri| supported_namespaces.contains(&uri));
                if !supported {
                    diagnostics.push(format!("unsupported mc:{} prefix '{}'", label, prefix));
                }
            }
        }
    }

    diagnostics
}

pub fn resolve_mc_alternate_content_v2_with_namespace_context(
    xml: &[u8],
    containing_xml: Option<&[u8]>,
    supported_namespaces: &[&str],
) -> McResolution {
    resolve_mc_alternate_content_with_policy(xml, containing_xml, supported_namespaces, true)
}

impl McResolution {
    fn resolved(self) -> Option<McBranch> {
        match self {
            McResolution::Resolved(branch) => Some(branch),
            McResolution::Preserved(_) | McResolution::Empty => None,
        }
    }
}

fn resolve_mc_alternate_content_with_policy(
    xml: &[u8],
    containing_xml: Option<&[u8]>,
    supported_namespaces: &[&str],
    preserve_unsupported: bool,
) -> McResolution {
    let mut has_unsupported_choice = false;
    let mut pos: usize = 0;

    while let Some(choice_start) = find_tag_simd(xml, b"mc:Choice", pos) {
        let choice_elem_end = find_gt_simd(xml, choice_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());
        let choice_elem = &xml[choice_start..choice_elem_end];

        if let Some(requires) = parse_string_attr(choice_elem, b"Requires=\"") {
            let supported = !requires.is_empty()
                && requires.split_whitespace().all(|pfx| {
                    resolve_namespace_prefix(pfx, xml, containing_xml)
                        .is_some_and(|uri| supported_namespaces.contains(&uri.as_str()))
                });

            if supported {
                let content_start = choice_elem_end;
                let choice_end = extract_element_bounds(xml, choice_start)
                    .map(|(_, end)| end)
                    .unwrap_or(xml.len());
                let content_end =
                    closing_start_before(xml, content_start, choice_end).unwrap_or(choice_end);

                return McResolution::Resolved(McBranch {
                    start: content_start,
                    end: content_end,
                    is_choice: true,
                });
            }
            has_unsupported_choice = true;
        }

        pos = extract_element_bounds(xml, choice_start)
            .map(|(_, end)| end)
            .unwrap_or(choice_elem_end);
    }

    if preserve_unsupported && has_unsupported_choice {
        return McResolution::Preserved(String::from_utf8_lossy(xml).into_owned());
    }

    if let Some(fb_start) = find_tag_simd(xml, b"mc:Fallback", 0) {
        let fb_elem_end = find_gt_simd(xml, fb_start)
            .map(|p| p + 1)
            .unwrap_or(xml.len());

        if fb_elem_end >= 2 && xml[fb_elem_end - 2] == b'/' {
            if preserve_unsupported {
                return McResolution::Empty;
            }
            return McResolution::Resolved(McBranch {
                start: fb_elem_end,
                end: fb_elem_end,
                is_choice: false,
            });
        }

        let content_start = fb_elem_end;
        let fallback_end = extract_element_bounds(xml, fb_start)
            .map(|(_, end)| end)
            .unwrap_or(xml.len());
        let content_end =
            closing_start_before(xml, content_start, fallback_end).unwrap_or(fallback_end);

        return McResolution::Resolved(McBranch {
            start: content_start,
            end: content_end,
            is_choice: false,
        });
    }

    McResolution::Empty
}

fn resolve_namespace_prefix(
    prefix: &str,
    xml: &[u8],
    containing_xml: Option<&[u8]>,
) -> Option<String> {
    namespace_decl_in_start_tag(xml, prefix)
        .or_else(|| containing_xml.and_then(|ctx| namespace_decl_in_start_tag(ctx, prefix)))
        .or_else(|| namespace_decl_anywhere(xml, prefix))
        .or_else(|| match prefix {
            "x14" => Some(NS_X14.to_string()),
            "x15" => Some(NS_X15.to_string()),
            _ => None,
        })
}

fn namespace_decl_in_start_tag(xml: &[u8], prefix: &str) -> Option<String> {
    let start_tag_end = find_gt_simd(xml, 0).unwrap_or(xml.len());
    namespace_decl_anywhere(&xml[..start_tag_end], prefix)
}

fn namespace_decl_anywhere(xml: &[u8], prefix: &str) -> Option<String> {
    let attr = format!("xmlns:{}=\"", prefix);
    parse_string_attr(xml, attr.as_bytes())
}
