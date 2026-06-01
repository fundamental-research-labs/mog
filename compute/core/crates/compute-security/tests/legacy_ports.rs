//! Direct ports of legacy TypeScript test cases to Rust, preserving
//! describe/it structure so a reviewer can diff the two side-by-side.
//!
//! Sources:
//! - `kernel/src/services/security/__tests__/tag-matcher.test.ts`
//! - Principal derivation cases pulled from the "derived tags (SG-1)"
//!   describe block in `policy-engine.test.ts` (the non-policy-engine
//!   parts that exercise pure principal logic).
//!
//! Resolution/matrix/template cases stay in their legacy TS files until
//! R1.1/R1.2/R1.3 stand up the Rust equivalents.

use compute_security::{
    AccessLevel, NON_OWNER_TAG, OWNER_TAG, Principal, PrincipalPool, PrincipalTag, TagMatcher,
    TagSpecificity,
};

fn m(pattern: &str) -> TagMatcher {
    TagMatcher::parse(pattern)
}
fn t(tag: &str) -> PrincipalTag {
    PrincipalTag::from(tag)
}

// =============================================================================
// describe('matchTag')
// =============================================================================

mod match_tag {
    use super::*;

    // describe('exact match')
    #[test]
    fn should_match_identical_strings() {
        assert!(m("agent:copilot").matches(&t("agent:copilot")));
    }

    #[test]
    fn should_not_match_different_strings() {
        assert!(!m("agent:copilot").matches(&t("agent:analyst")));
    }

    #[test]
    fn should_not_match_substrings() {
        assert!(!m("agent:copilot").matches(&t("agent:copilot-v2")));
    }

    #[test]
    fn should_match_mog_owner_exactly() {
        assert!(m("mog:owner").matches(&t("mog:owner")));
    }

    #[test]
    fn should_not_match_when_pattern_is_a_prefix_of_tag() {
        assert!(!m("agent").matches(&t("agent:copilot")));
    }

    // describe('prefix glob')
    #[test]
    fn should_match_tag_starting_with_prefix() {
        assert!(m("agent:*").matches(&t("agent:copilot")));
    }

    #[test]
    fn should_match_any_tag_with_the_prefix() {
        assert!(m("agent:*").matches(&t("agent:analyst")));
        assert!(m("agent:*").matches(&t("agent:x")));
    }

    #[test]
    fn should_not_match_tag_with_different_prefix() {
        assert!(!m("agent:*").matches(&t("user:alice")));
    }

    #[test]
    fn should_match_nested_prefix_globs() {
        assert!(m("sf:role:*").matches(&t("sf:role:admin")));
        assert!(m("sf:role:*").matches(&t("sf:role:viewer")));
    }

    #[test]
    fn should_not_match_partial_prefix() {
        assert!(!m("sf:role:*").matches(&t("sf:user:admin")));
    }

    #[test]
    fn should_match_even_when_glob_part_is_empty() {
        // "agent:*" should match "agent:" (tag = prefix exactly)
        assert!(m("agent:*").matches(&t("agent:")));
    }

    // describe('wildcard')
    #[test]
    fn should_match_any_tag() {
        assert!(m("*").matches(&t("agent:copilot")));
        assert!(m("*").matches(&t("user:alice")));
        assert!(m("*").matches(&t("mog:owner")));
        assert!(m("*").matches(&t("")));
    }

    // describe('no match')
    #[test]
    fn should_not_match_completely_different_strings() {
        assert!(!m("admin").matches(&t("user")));
    }

    #[test]
    fn should_not_match_when_tag_is_prefix_of_pattern() {
        assert!(!m("agent:copilot").matches(&t("agent")));
    }
}

// =============================================================================
// describe('getTagSpecificity')
// =============================================================================

mod get_tag_specificity {
    use super::*;

    #[test]
    fn should_return_exact_for_non_glob_patterns() {
        assert_eq!(m("agent:copilot").specificity(), TagSpecificity::Exact);
        assert_eq!(m("mog:owner").specificity(), TagSpecificity::Exact);
        assert_eq!(m("sf:role:admin").specificity(), TagSpecificity::Exact);
    }

    #[test]
    fn should_return_prefix_glob_for_patterns_ending_with_star() {
        assert_eq!(m("agent:*").specificity(), TagSpecificity::PrefixGlob);
        assert_eq!(m("sf:role:*").specificity(), TagSpecificity::PrefixGlob);
        assert_eq!(m("user:*").specificity(), TagSpecificity::PrefixGlob);
    }

    #[test]
    fn should_return_wildcard_for_single_star() {
        assert_eq!(m("*").specificity(), TagSpecificity::Wildcard);
    }
}

// =============================================================================
// describe('Principal — derived tags (SG-1)') — pure derivation, no engine.
// Counterparts in TS live inside policy-engine.test.ts; the derivation itself
// is pure and is the piece we can exercise today without R1.1.
// =============================================================================

mod principal_derivation {
    use super::*;

    #[test]
    fn adds_mog_non_owner_when_mog_owner_is_absent() {
        let pool = PrincipalPool::new();
        let p = pool.intern([t("user:alice")]);
        let tags: Vec<_> = p.effective_tags().map(|x| x.as_str().to_owned()).collect();
        assert!(tags.contains(&NON_OWNER_TAG.to_string()));
    }

    #[test]
    fn does_not_add_mog_non_owner_when_mog_owner_is_present() {
        let pool = PrincipalPool::new();
        let p = pool.intern([t(OWNER_TAG)]);
        let tags: Vec<_> = p.effective_tags().map(|x| x.as_str().to_owned()).collect();
        assert!(!tags.contains(&NON_OWNER_TAG.to_string()));
        assert!(tags.contains(&OWNER_TAG.to_string()));
    }

    #[test]
    fn empty_tag_principal_becomes_non_owner() {
        let pool = PrincipalPool::new();
        let p = Principal::anonymous(&pool);
        let tags: Vec<_> = p.effective_tags().map(|x| x.as_str().to_owned()).collect();
        assert_eq!(tags, vec![NON_OWNER_TAG.to_string()]);
    }
}

// =============================================================================
// AccessLevel ordering — legacy TS tested via comparisons at the engine
// layer; the pure ordering invariant is the most we can assert without R1.1.
// =============================================================================

mod access_level_ordering {
    use super::*;

    #[test]
    fn admin_outranks_write_read_structure_none() {
        assert!(AccessLevel::Admin > AccessLevel::Write);
        assert!(AccessLevel::Write > AccessLevel::Read);
        assert!(AccessLevel::Read > AccessLevel::Structure);
        assert!(AccessLevel::Structure > AccessLevel::None);
    }

    #[test]
    fn discriminants_match_legacy_contract() {
        // Legacy TS encoded these as string literals; Rust uses
        // repr(u8) with the same serialised names. Lock down both.
        assert_eq!(AccessLevel::None.as_u8(), 0);
        assert_eq!(AccessLevel::Structure.as_u8(), 1);
        assert_eq!(AccessLevel::Read.as_u8(), 2);
        assert_eq!(AccessLevel::Write.as_u8(), 3);
        assert_eq!(AccessLevel::Admin.as_u8(), 4);
    }
}
