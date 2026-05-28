use crate::infra::scanner::{find_closing_tag, find_gt_simd, find_tag_simd};

use super::attrs::parse_string_attr;

/// Namespaces we understand and can render.
pub const MC_SUPPORTED_NAMESPACES: &[&str] = &[
    "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main",
    "http://schemas.microsoft.com/office/spreadsheetml/2010/11/main",
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

type PrefixResolver = dyn Fn(&str) -> Option<&'static str>;

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
                let content_end =
                    find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(xml.len());

                return McResolution::Resolved(McBranch {
                    start: content_start,
                    end: content_end,
                    is_choice: true,
                });
            } else {
                has_unsupported_choice = true;
            }
        }

        let choice_close =
            find_closing_tag(xml, b"mc:Choice", choice_start).unwrap_or(choice_elem_end);
        pos = find_gt_simd(xml, choice_close)
            .map(|p| p + 1)
            .unwrap_or(choice_close + 1);
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
        let content_end = find_closing_tag(xml, b"mc:Fallback", fb_start).unwrap_or(xml.len());

        return McResolution::Resolved(McBranch {
            start: content_start,
            end: content_end,
            is_choice: false,
        });
    }

    McResolution::Empty
}
