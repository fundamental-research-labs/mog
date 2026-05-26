//! Ports `kernel/src/services/security/__tests__/tag-matcher.test.ts` to
//! Rust. Covers exact, prefix-glob, wildcard, non-match, specificity
//! classification, and parse edge cases.

use compute_security::{PrincipalTag, TagMatcher, TagSpecificity};

fn m(pattern: &str) -> TagMatcher {
    TagMatcher::parse(pattern)
}

fn t(tag: &str) -> PrincipalTag {
    PrincipalTag::from(tag)
}

// =============================================================================
// matches — exact match
// =============================================================================

#[test]
fn exact_match_identical_strings() {
    assert!(m("agent:copilot").matches(&t("agent:copilot")));
}

#[test]
fn exact_match_different_strings_fail() {
    assert!(!m("agent:copilot").matches(&t("agent:analyst")));
}

#[test]
fn exact_match_no_substring_hit() {
    assert!(!m("agent:copilot").matches(&t("agent:copilot-v2")));
}

#[test]
fn exact_match_mog_owner() {
    assert!(m("mog:owner").matches(&t("mog:owner")));
}

#[test]
fn exact_pattern_shorter_than_tag_does_not_match() {
    assert!(!m("agent").matches(&t("agent:copilot")));
}

// =============================================================================
// matches — prefix glob
// =============================================================================

#[test]
fn prefix_glob_matches_tag_with_prefix() {
    assert!(m("agent:*").matches(&t("agent:copilot")));
}

#[test]
fn prefix_glob_matches_any_tag_with_prefix() {
    assert!(m("agent:*").matches(&t("agent:analyst")));
    assert!(m("agent:*").matches(&t("agent:x")));
}

#[test]
fn prefix_glob_rejects_different_prefix() {
    assert!(!m("agent:*").matches(&t("user:alice")));
}

#[test]
fn prefix_glob_nested_prefixes() {
    assert!(m("sf:role:*").matches(&t("sf:role:admin")));
    assert!(m("sf:role:*").matches(&t("sf:role:viewer")));
}

#[test]
fn prefix_glob_rejects_partial_prefix() {
    assert!(!m("sf:role:*").matches(&t("sf:user:admin")));
}

#[test]
fn prefix_glob_matches_empty_suffix() {
    // "agent:*" should match "agent:" (tag = prefix exactly).
    assert!(m("agent:*").matches(&t("agent:")));
}

// =============================================================================
// matches — wildcard
// =============================================================================

#[test]
fn wildcard_matches_any_tag() {
    assert!(m("*").matches(&t("agent:copilot")));
    assert!(m("*").matches(&t("user:alice")));
    assert!(m("*").matches(&t("mog:owner")));
    assert!(m("*").matches(&t("")));
}

// =============================================================================
// matches — no match
// =============================================================================

#[test]
fn no_match_completely_different_strings() {
    assert!(!m("admin").matches(&t("user")));
}

#[test]
fn no_match_when_tag_is_prefix_of_pattern() {
    assert!(!m("agent:copilot").matches(&t("agent")));
}

// =============================================================================
// specificity classification
// =============================================================================

#[test]
fn specificity_exact_for_plain_patterns() {
    assert_eq!(m("agent:copilot").specificity(), TagSpecificity::Exact);
    assert_eq!(m("mog:owner").specificity(), TagSpecificity::Exact);
    assert_eq!(m("sf:role:admin").specificity(), TagSpecificity::Exact);
}

#[test]
fn specificity_prefix_glob_for_star_suffix() {
    assert_eq!(m("agent:*").specificity(), TagSpecificity::PrefixGlob);
    assert_eq!(m("sf:role:*").specificity(), TagSpecificity::PrefixGlob);
    assert_eq!(m("user:*").specificity(), TagSpecificity::PrefixGlob);
}

#[test]
fn specificity_wildcard_for_single_star() {
    assert_eq!(m("*").specificity(), TagSpecificity::Wildcard);
}

#[test]
fn specificity_ordering_exact_gt_prefix_gt_wildcard() {
    assert!(TagSpecificity::Exact > TagSpecificity::PrefixGlob);
    assert!(TagSpecificity::PrefixGlob > TagSpecificity::Wildcard);
}

// =============================================================================
// parse — edge cases
// =============================================================================

#[test]
fn parse_preserves_pattern_text() {
    assert_eq!(m("agent:*").pattern(), "agent:*");
    assert_eq!(m("agent:copilot").pattern(), "agent:copilot");
    assert_eq!(m("*").pattern(), "*");
}

#[test]
fn parse_single_star_is_wildcard_not_empty_prefix() {
    // Single '*' is classified as wildcard, not as a prefix-glob with
    // empty prefix — the two have different specificity and different
    // semantics in the resolution algorithm.
    let matcher = m("*");
    assert_eq!(matcher.specificity(), TagSpecificity::Wildcard);
}

#[test]
fn parse_serde_round_trip_via_string() {
    let original = m("agent:*");
    let json = serde_json::to_string(&original).expect("serialize");
    let decoded: TagMatcher = serde_json::from_str(&json).expect("deserialize");
    assert_eq!(decoded.pattern(), original.pattern());
    assert_eq!(decoded.specificity(), original.specificity());
}
