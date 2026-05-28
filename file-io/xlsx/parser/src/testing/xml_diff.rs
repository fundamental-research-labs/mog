//! Structural XML diff for round-trip parity gates.
//!
//! Parity gates write the typed-reconstruction XML and the legacy blob-path
//! XML side by side and compare them on the fidelity corpus. The comparison is
//! **structural**, not byte-for-byte:
//!
//! - **Namespace prefixes canonical.** `<c:chart xmlns:c="…">` and
//!   `<chart xmlns:c="…">` compare equal. Prefixes are resolved to
//!   `{namespace-uri}localname` expanded-name tuples.
//! - **Attribute order insignificant** within an element — attributes are
//!   sorted by expanded name before comparison.
//! - **Default-attribute elision insignificant.** An unspecified attribute
//!   equivalent to its ECMA-376 default compares equal to the default. The
//!   default table ([`XmlDiffOptions::attribute_defaults`]) starts empty and
//!   is populated incrementally by consumers as defaults become relevant.
//! - **Whitespace between elements insignificant**; whitespace inside mixed
//!   content (e.g. `<a:t>` runs, shared strings) significant.
//!   `xml:space="preserve"` honored when set.
//! - **Element order significant** by default (the OOXML XSD is mostly
//!   sequence-typed). Insignificance is opt-in per path via
//!   [`XmlDiffOptions::unordered_element_paths`].
//!
//! # Scope boundary
//!
//! This module is an intentionally narrow comparison helper. It does NOT:
//!
//! - wire into specific sub-plan consumers (each sub-plan adds its own call
//!   sites in its own PR),
//! - ship a complete ECMA-376 default-attribute table (consumers add entries
//!   as they need them; the table is designed to be extensible),
//! - infer sequence / all / choice from the XSD (opt-in allowlist only).
//!
//! # Typical usage
//!
//! ```ignore
//! use xlsx_parser::testing::xml_diff::{XmlDiff, XmlDiffOptions, structural_diff};
//!
//! let opts = XmlDiffOptions::default();
//! match structural_diff(blob_xml, typed_xml, &opts) {
//!     XmlDiff::Equal => {}
//!     XmlDiff::Differ { path, reason, .. } => {
//!         panic!("parallel-assertion failed at {path}: {reason}");
//!     }
//! }
//! ```

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fmt;

use quick_xml::events::Event;
use quick_xml::events::attributes::Attribute;
use quick_xml::name::{Namespace, ResolveResult};
use quick_xml::reader::NsReader;

// ---------------------------------------------------------------------------
// Public API — option / result types
// ---------------------------------------------------------------------------

/// Expanded XML name — `{namespace-uri}local-name`.
///
/// Two `ExpandedName`s compare equal iff they refer to the same namespace
/// URI (empty string for the unbound / no-namespace case) and the same
/// local name. Prefixes are discarded during parsing.
#[derive(Clone, Debug, Eq, PartialEq, Hash, PartialOrd, Ord)]
pub struct ExpandedName {
    /// Namespace URI, or empty string for the unbound / no-namespace case.
    pub namespace: String,
    /// Element or attribute local name.
    pub local: String,
}

impl ExpandedName {
    /// Construct a new expanded name.
    pub fn new(namespace: impl Into<String>, local: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
            local: local.into(),
        }
    }

    /// Construct an expanded name with no namespace binding.
    pub fn unbound(local: impl Into<String>) -> Self {
        Self::new("", local)
    }
}

impl fmt::Display for ExpandedName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.namespace.is_empty() {
            write!(f, "{}", self.local)
        } else {
            write!(f, "{{{}}}{}", self.namespace, self.local)
        }
    }
}

/// Options controlling the structural diff.
#[derive(Clone, Debug, Default)]
pub struct XmlDiffOptions {
    /// Element paths (canonical "/"-joined expanded names) for which child
    /// element order is *insignificant*. Each entry is the path to the
    /// **parent** element whose direct children should be compared as a
    /// multiset rather than a sequence.
    ///
    /// Path format: a slash-joined sequence of expanded names
    /// (`{uri}local`), with a leading slash. For example,
    /// `/{http://.../main}workbook/{http://.../main}definedNames` marks the
    /// `<definedNames>` element as an unordered container. As a convenience,
    /// paths using just local names (e.g. `/workbook/definedNames`) are also
    /// accepted and match when the local names align — see
    /// [`Self::contains_path`].
    pub unordered_element_paths: HashSet<String>,

    /// Default-attribute table: `(element expanded-name, attribute expanded-name) -> default value`.
    ///
    /// When one document specifies an attribute with its default value and
    /// the other omits it, they compare equal.
    ///
    /// Seeded with a small set of common ECMA-376 defaults; extend as
    /// consumers need specific elements.
    pub attribute_defaults: HashMap<(ExpandedName, ExpandedName), String>,
}

impl XmlDiffOptions {
    /// Construct options with a small seed of common ECMA-376 defaults and
    /// no unordered paths.
    ///
    /// Seeds are minimal by design — consumers add entries as they land
    /// parallel-assertion gates.
    pub fn with_common_defaults() -> Self {
        Self {
            unordered_element_paths: HashSet::new(),
            attribute_defaults: common_attribute_defaults(),
        }
    }

    /// Test whether a path is listed as unordered, allowing either fully
    /// expanded names or local-only names on either side.
    fn contains_path(&self, expanded: &str, local_only: &str) -> bool {
        self.unordered_element_paths.contains(expanded)
            || self.unordered_element_paths.contains(local_only)
    }
}

/// Result of a structural diff.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum XmlDiff {
    /// The two documents are structurally equal.
    Equal,
    /// The two documents differ at the given path.
    Differ {
        /// Slash-joined expanded-name path to the first divergence site.
        path: String,
        /// A rendering of the left-side value, when applicable (e.g. an
        /// attribute value, a text run, or an element name).
        left: Option<String>,
        /// A rendering of the right-side value, when applicable.
        right: Option<String>,
        /// Human-readable description of the divergence.
        reason: String,
    },
}

/// Compare two XML documents structurally per the typed OOXML preservation contract.
///
/// Accepts bytes; if you have strings use `structural_diff(left.as_bytes(), right.as_bytes(), opts)`.
pub fn structural_diff(left: &[u8], right: &[u8], options: &XmlDiffOptions) -> XmlDiff {
    let left_tree = match parse(left) {
        Ok(t) => t,
        Err(e) => {
            return XmlDiff::Differ {
                path: "/".to_string(),
                left: Some(format!("parse error: {e}")),
                right: None,
                reason: "left document failed to parse".to_string(),
            };
        }
    };
    let right_tree = match parse(right) {
        Ok(t) => t,
        Err(e) => {
            return XmlDiff::Differ {
                path: "/".to_string(),
                left: None,
                right: Some(format!("parse error: {e}")),
                reason: "right document failed to parse".to_string(),
            };
        }
    };

    compare_documents(&left_tree, &right_tree, options)
}

/// Assert that two XML documents are structurally equal, returning a
/// human-readable error message on mismatch.
///
/// This is a convenience wrapper around [`structural_diff`] for direct use in
/// `assert!(assert_structurally_equal(..).is_ok())` or
/// `assert_structurally_equal(..).expect(..)` patterns.
pub fn assert_structurally_equal(
    left: &[u8],
    right: &[u8],
    options: &XmlDiffOptions,
) -> Result<(), String> {
    match structural_diff(left, right, options) {
        XmlDiff::Equal => Ok(()),
        XmlDiff::Differ {
            path,
            left,
            right,
            reason,
        } => {
            let left = left.unwrap_or_else(|| "(absent)".to_string());
            let right = right.unwrap_or_else(|| "(absent)".to_string());
            Err(format!(
                "structural XML diff at {path}: {reason}\n  left:  {left}\n  right: {right}"
            ))
        }
    }
}

// ---------------------------------------------------------------------------
// Parsed-tree representation
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct Element {
    name: ExpandedName,
    /// Attributes, stored unsorted during parse; sorted before comparison.
    attrs: Vec<(ExpandedName, String)>,
    children: Vec<Node>,
    /// Whether `xml:space="preserve"` is in scope for this element's direct
    /// text content. Inherited down the tree.
    preserve_space: bool,
}

#[derive(Clone, Debug)]
enum Node {
    Element(Element),
    /// Text or CDATA. For the comparison contract, CDATA is treated as text.
    Text(String),
}

#[derive(Clone, Debug)]
struct Document {
    root: Option<Element>,
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

fn parse(input: &[u8]) -> Result<Document, String> {
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
                // Text outside the root element (e.g. leading whitespace
                // before `<?xml ?>` / root) is ignored.
            }
            Event::CData(ref c) => {
                let bytes: &[u8] = c.as_ref();
                let s = String::from_utf8(bytes.to_vec())
                    .map_err(|e| format!("cdata utf8 error: {e}"))?;
                if let Some(parent) = stack.last_mut() {
                    parent.children.push(Node::Text(s));
                }
            }
            Event::Comment(_) | Event::Decl(_) | Event::PI(_) | Event::DocType(_) => {
                // Comments, XML declarations, processing instructions, and
                // DOCTYPE declarations are not semantically significant for
                // OOXML structural equivalence. Ignore.
            }
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
        // Filter xmlns declarations — they are structural metadata, not
        // semantic attributes. (quick-xml's namespace resolver already
        // tracks them on the NsReader.)
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

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

fn compare_documents(left: &Document, right: &Document, options: &XmlDiffOptions) -> XmlDiff {
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

    // Default-elision: if an attribute is present on one side with the
    // default value and absent on the other, remove it from both maps.
    //
    // We iterate over the union of keys so we don't miss either side.
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

    // Now both maps should have identical keys and identical values.
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
    // Mixed-content detection: if any text child has non-whitespace content
    // OR xml:space="preserve" is in scope, text is significant. Otherwise
    // text children are whitespace between elements and are discarded.
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
    // Unordered comparison: greedy multiset-match on Element children.
    // Text children in an unordered container are meaningless — skip.
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

// ---------------------------------------------------------------------------
// Text / whitespace helpers
// ---------------------------------------------------------------------------

fn has_nonwhitespace_text(children: &[Node]) -> bool {
    children
        .iter()
        .any(|c| matches!(c, Node::Text(t) if t.chars().any(|ch| !ch.is_whitespace())))
}

fn filter_children(children: &[Node], significant_text: bool) -> Vec<&Node> {
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
fn normalize_text(s: &str, preserve_space: bool) -> String {
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

fn push_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}

// ---------------------------------------------------------------------------
// Seed default-attribute table
// ---------------------------------------------------------------------------

/// Seed defaults for the most common ECMA-376 elements. Consumers extend
/// by merging into [`XmlDiffOptions::attribute_defaults`].
fn common_attribute_defaults() -> HashMap<(ExpandedName, ExpandedName), String> {
    let mut m = HashMap::new();

    // CT_Color — `<color indexed="0"/>` is the implicit default for colors
    // that carry an `indexed` value of 0. Namespaced under the main
    // spreadsheet namespace.
    const MAIN_NS: &str = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    m.insert(
        (
            ExpandedName::new(MAIN_NS, "color"),
            ExpandedName::unbound("indexed"),
        ),
        "0".to_string(),
    );

    // CT_Color.auto="false" is the default.
    m.insert(
        (
            ExpandedName::new(MAIN_NS, "color"),
            ExpandedName::unbound("auto"),
        ),
        "false".to_string(),
    );

    // CT_CatAx / CT_ValAx on charts: `<delete val="0"/>` — axes default to
    // not-deleted. The chart namespace is long; use as a string literal.
    const CHART_NS: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
    for tag in &["delete", "auto", "noMultiLvlLbl"] {
        m.insert(
            (
                ExpandedName::new(CHART_NS, (*tag).to_string()),
                ExpandedName::unbound("val"),
            ),
            "0".to_string(),
        );
    }

    m
}

// Keep `Cow` in scope so downstream edits that switch to returning Cow
// don't have to re-import. (Silences unused-import warnings in the
// interim — the import *is* used transitively via quick-xml.)
#[allow(dead_code)]
fn _cow_touch<'a>(_: Cow<'a, str>) {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

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

    // ----- Namespace prefix normalization -----

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
        assert!(path.starts_with("/"), "path={path}");
    }

    // ----- Attribute order -----

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

    // ----- Default-attribute elision -----

    #[test]
    fn default_attribute_elision_equal() {
        let mut opts = XmlDiffOptions::default();
        opts.attribute_defaults.insert(
            (ExpandedName::unbound("e"), ExpandedName::unbound("a")),
            "1".to_string(),
        );
        // Left specifies a=1 (the default), right omits.
        eq(r#"<e a="1"/>"#, r#"<e/>"#, &opts);
        // Also the reverse.
        eq(r#"<e/>"#, r#"<e a="1"/>"#, &opts);
    }

    #[test]
    fn non_default_attribute_not_elided() {
        let mut opts = XmlDiffOptions::default();
        opts.attribute_defaults.insert(
            (ExpandedName::unbound("e"), ExpandedName::unbound("a")),
            "1".to_string(),
        );
        // a=2 is not the default; the two must compare different.
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

    // ----- Whitespace -----

    #[test]
    fn whitespace_between_elements_insignificant() {
        let left = r#"<root><a/><b/></root>"#;
        let right = "<root>\n  <a/>\n  <b/>\n</root>";
        eq(left, right, &XmlDiffOptions::default());
    }

    #[test]
    fn mixed_content_whitespace_collapsed() {
        // `<p>hello</p>` vs `<p> hello </p>` equal after inner-whitespace
        // collapse (leading/trailing ws still shows up, but the second
        // form normalizes to " hello " and the first to "hello" → not
        // equal under strict semantics). Since we do NOT strip, we expect
        // DIFF here unless preserve-space is off AND consumer wanted a
        // lenient-trim form. Per the contract ("whitespace inside mixed
        // content SIGNIFICANT"), this must differ.
        let (_, reason) = differ(
            r#"<p>hello</p>"#,
            r#"<p> hello </p>"#,
            &XmlDiffOptions::default(),
        );
        assert!(reason.contains("text content differs"), "reason={reason}");
    }

    #[test]
    fn mixed_content_inner_whitespace_run_collapses() {
        // `<p>a  b</p>` vs `<p>a b</p>` — collapse inner whitespace runs.
        eq(
            r#"<p>a  b</p>"#,
            r#"<p>a b</p>"#,
            &XmlDiffOptions::default(),
        );
    }

    #[test]
    fn xml_space_preserve_keeps_whitespace() {
        // Under xml:space="preserve", runs are NOT collapsed.
        let left = r#"<p xml:space="preserve">a  b</p>"#;
        let right = r#"<p xml:space="preserve">a b</p>"#;
        let (_, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(reason.contains("text content differs"), "reason={reason}");
    }

    #[test]
    fn text_run_content_differs() {
        let left = r#"<root><t>hello</t></root>"#;
        let right = r#"<root><t>world</t></root>"#;
        let (path, reason) = differ(left, right, &XmlDiffOptions::default());
        assert!(reason.contains("text content differs"), "reason={reason}");
        assert!(path.contains("/root/t"), "path={path}");
    }

    // ----- Element order -----

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

    // ----- Element-name mismatch -----

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

    // ----- Nested -----

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

    // ----- CDATA / comment handling -----

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

    // ----- API: assert wrapper -----

    #[test]
    fn assert_structurally_equal_ok() {
        let r = assert_structurally_equal(
            b"<e a=\"1\" b=\"2\"/>",
            b"<e b=\"2\" a=\"1\"/>",
            &XmlDiffOptions::default(),
        );
        assert!(r.is_ok(), "expected Ok; got {r:?}");
    }

    #[test]
    fn assert_structurally_equal_err_includes_path() {
        let r = assert_structurally_equal(
            b"<root><e a=\"1\"/></root>",
            b"<root><e a=\"2\"/></root>",
            &XmlDiffOptions::default(),
        );
        match r {
            Ok(()) => panic!("expected Err"),
            Err(msg) => {
                assert!(msg.contains("/root/e/@a"), "msg={msg}");
                assert!(msg.contains("attribute value differs"), "msg={msg}");
            }
        }
    }

    // ----- Parse error reporting -----

    #[test]
    fn unparseable_left_reports_error() {
        let (path, reason) = differ("<root><unclosed>", "<root/>", &XmlDiffOptions::default());
        assert_eq!(path, "/");
        assert!(
            reason.contains("left document failed to parse"),
            "reason={reason}"
        );
    }

    // ----- Real-ish OOXML fragment -----

    #[test]
    fn ooxml_chart_axis_structural_equality() {
        // Cross-prefix / default-namespace equivalence on a realistic OOXML
        // chart fragment: left uses the `c:` prefix, right uses the same URI
        // as the default namespace. Attribute order also differs on <axId>.
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
