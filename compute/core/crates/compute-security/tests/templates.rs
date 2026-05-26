//! Port of `kernel/src/services/security/__tests__/templates.test.ts`.

use std::sync::Arc;

use cell_types::SheetId;
use compute_security::{
    AccessLevel, AccessTarget, NON_OWNER_TAG, PRIORITY_TEMPLATE_MAX, PRIORITY_TEMPLATE_MIN,
    Template,
};

fn sheet() -> SheetId {
    SheetId::from_raw(0x1111_1111_1111_1111_1111_1111_1111_1111)
}

// -----------------------------------------------------------------------------
// describe('protect-sheet template')
// -----------------------------------------------------------------------------

mod protect_sheet {
    use super::*;

    #[test]
    fn generates_a_single_policy_with_correct_properties() {
        let tpl = Template::ProtectSheet { sheet_id: sheet() };
        let policies = tpl.generate();
        assert_eq!(policies.len(), 1);
        let p = &policies[0];
        assert_eq!(p.principal_tag.pattern(), NON_OWNER_TAG);
        assert_eq!(p.target, AccessTarget::Sheet { sheet_id: sheet() });
        assert_eq!(p.level, AccessLevel::Read);
        assert_eq!(p.priority, 100);
        assert!(p.enabled);
        assert_eq!(p.metadata.template_id.as_deref(), Some("protect-sheet"));
        assert_eq!(&*p.metadata.created_by, "mog:system");
    }

    #[test]
    fn id_is_populated_by_the_template_generator() {
        // Legacy TS deferred ID assignment to the store. Rust Rust
        // generates the ID at template construction because policies are
        // stored by ID in Yrs — no separate assignment step. Just confirm
        // distinct IDs on distinct calls.
        let tpl = Template::ProtectSheet { sheet_id: sheet() };
        let a = tpl.generate();
        let b = tpl.generate();
        assert_ne!(a[0].id, b[0].id);
    }
}

// -----------------------------------------------------------------------------
// describe('protect-workbook template')
// -----------------------------------------------------------------------------

mod protect_workbook {
    use super::*;

    #[test]
    fn generates_a_single_policy_with_correct_properties() {
        let tpl = Template::ProtectWorkbook;
        let policies = tpl.generate();
        assert_eq!(policies.len(), 1);
        let p = &policies[0];
        assert_eq!(p.principal_tag.pattern(), NON_OWNER_TAG);
        assert_eq!(p.target, AccessTarget::Workbook);
        assert_eq!(p.level, AccessLevel::Read);
        assert_eq!(p.priority, 100);
        assert!(p.enabled);
        assert_eq!(p.metadata.template_id.as_deref(), Some("protect-workbook"));
        assert_eq!(&*p.metadata.created_by, "mog:system");
    }
}

// -----------------------------------------------------------------------------
// describe('agent-structure template')
// -----------------------------------------------------------------------------

mod agent_structure {
    use super::*;

    #[test]
    fn generates_a_single_policy_with_default_tag_pattern() {
        let tpl = Template::AgentStructure { tag_pattern: None };
        let policies = tpl.generate();
        assert_eq!(policies.len(), 1);
        let p = &policies[0];
        assert_eq!(p.principal_tag.pattern(), "agent:*");
        assert_eq!(p.target, AccessTarget::Workbook);
        assert_eq!(p.level, AccessLevel::Structure);
        assert_eq!(p.priority, 100);
        assert!(p.enabled);
        assert_eq!(p.metadata.template_id.as_deref(), Some("agent-structure"));
        assert_eq!(&*p.metadata.created_by, "mog:system");
    }

    #[test]
    fn uses_custom_tag_pattern_when_provided() {
        let tpl = Template::AgentStructure {
            tag_pattern: Some(Arc::from("agent:copilot")),
        };
        let policies = tpl.generate();
        assert_eq!(policies.len(), 1);
        assert_eq!(policies[0].principal_tag.pattern(), "agent:copilot");
    }

    #[test]
    fn uses_custom_tag_pattern_with_glob() {
        let tpl = Template::AgentStructure {
            tag_pattern: Some(Arc::from("app:ai-*")),
        };
        let policies = tpl.generate();
        assert_eq!(policies.len(), 1);
        assert_eq!(policies[0].principal_tag.pattern(), "app:ai-*");
    }
}

// -----------------------------------------------------------------------------
// describe('template registry') — legacy tested a dynamic factory map;
// Rust expresses the same via the `Template` enum + the `id()`
// accessor. The invariants the TS registry tests locked down are:
// every template has a stable id and every emitted policy lands in
// [PRIORITY_TEMPLATE_MIN, PRIORITY_TEMPLATE_MAX].
// -----------------------------------------------------------------------------

mod registry {
    use super::*;

    #[test]
    fn template_ids_match_round_one_catalogue() {
        assert_eq!(
            Template::ProtectSheet { sheet_id: sheet() }.id(),
            "protect-sheet",
        );
        assert_eq!(Template::ProtectWorkbook.id(), "protect-workbook");
        assert_eq!(
            Template::AgentStructure { tag_pattern: None }.id(),
            "agent-structure",
        );
    }

    #[test]
    fn every_emitted_policy_lands_in_the_template_priority_band() {
        let cases = [
            Template::ProtectSheet { sheet_id: sheet() },
            Template::ProtectWorkbook,
            Template::AgentStructure { tag_pattern: None },
        ];
        for tpl in cases {
            let policies = tpl.generate();
            assert!(!policies.is_empty());
            for p in policies {
                assert!(p.priority >= PRIORITY_TEMPLATE_MIN);
                assert!(p.priority <= PRIORITY_TEMPLATE_MAX);
                assert!(p.enabled);
                assert!(p.metadata.template_id.is_some());
            }
        }
    }
}
