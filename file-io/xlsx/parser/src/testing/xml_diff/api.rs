use std::collections::{HashMap, HashSet};
use std::fmt;

use super::defaults::common_attribute_defaults;

/// Expanded XML name: `{namespace-uri}local-name`.
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
    /// accepted and match when the local names align.
    pub unordered_element_paths: HashSet<String>,

    /// Default-attribute table: `(element expanded-name, attribute expanded-name) -> default value`.
    ///
    /// When one document specifies an attribute with its default value and
    /// the other omits it, they compare equal.
    pub attribute_defaults: HashMap<(ExpandedName, ExpandedName), String>,
}

impl XmlDiffOptions {
    /// Construct options with a small seed of common ECMA-376 defaults and
    /// no unordered paths.
    ///
    /// Seeds are minimal by design: consumers add entries as they land
    /// parallel-assertion gates.
    pub fn with_common_defaults() -> Self {
        Self {
            unordered_element_paths: HashSet::new(),
            attribute_defaults: common_attribute_defaults(),
        }
    }

    /// Test whether a path is listed as unordered, allowing either fully
    /// expanded names or local-only names on either side.
    pub(super) fn contains_path(&self, expanded: &str, local_only: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expanded_name_display_unbound() {
        assert_eq!(ExpandedName::unbound("root").to_string(), "root");
    }

    #[test]
    fn expanded_name_display_bound() {
        assert_eq!(
            ExpandedName::new("http://example.com/ns", "root").to_string(),
            "{http://example.com/ns}root"
        );
    }

    #[test]
    fn default_options_are_empty() {
        let opts = XmlDiffOptions::default();
        assert!(opts.unordered_element_paths.is_empty());
        assert!(opts.attribute_defaults.is_empty());
    }

    #[test]
    fn common_default_options_seed_attributes_only() {
        let opts = XmlDiffOptions::with_common_defaults();
        assert!(opts.unordered_element_paths.is_empty());
        assert!(!opts.attribute_defaults.is_empty());
    }

    #[test]
    fn local_only_unordered_path_matching() {
        let mut opts = XmlDiffOptions::default();
        opts.unordered_element_paths
            .insert("/root/items".to_string());
        assert!(opts.contains_path(
            "/{http://example.com/ns}root/{http://example.com/ns}items",
            "/root/items"
        ));
    }
}
