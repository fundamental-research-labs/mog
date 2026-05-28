//! Structural XML diff for round-trip parity gates.
//!
//! Parity gates write the typed-reconstruction XML and the legacy blob-path
//! XML side by side and compare them on the fidelity corpus. The comparison is
//! **structural**, not byte-for-byte:
//!
//! - **Namespace prefixes canonical.** `<c:chart xmlns:c="...">` and
//!   `<chart xmlns:c="...">` compare equal. Prefixes are resolved to
//!   `{namespace-uri}localname` expanded-name tuples.
//! - **Attribute order insignificant** within an element: attributes are
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
//! - wire into specific sub-plan consumers,
//! - ship a complete ECMA-376 default-attribute table,
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

mod api;
mod compare;
mod defaults;
mod parse;
mod text;
mod tree;

pub use api::{ExpandedName, XmlDiff, XmlDiffOptions};

use compare::compare_documents;
use parse::parse;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
