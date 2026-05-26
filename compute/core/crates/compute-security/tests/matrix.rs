//! Port of `kernel/src/services/security/__tests__/access-matrix.test.ts`.
//! Matrix is built through `PolicyEngine::evaluate_sheet`; no direct
//! constructor in this crate (matrix is a resolver output, not a user-
//! authored type).

use std::sync::Arc;

use cell_types::{ColId, SheetId};
use compute_security::{
    AccessLevel, AccessPolicy, AccessTarget, ColumnIndex, PolicyEngine, PolicyId, PolicyMetadata,
    PrincipalPool, PrincipalTag, TagMatcher,
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

fn sheet() -> SheetId {
    SheetId::from_raw(0x1111_1111_1111_1111_1111_1111_1111_1111)
}
fn col_a() -> ColId {
    ColId::from_raw(0xa0a0_a0a0_a0a0_a0a0_a0a0_a0a0_a0a0_a0a0)
}
fn col_b() -> ColId {
    ColId::from_raw(0xb0b0_b0b0_b0b0_b0b0_b0b0_b0b0_b0b0_b0b0)
}
fn col_c() -> ColId {
    ColId::from_raw(0xc0c0_c0c0_c0c0_c0c0_c0c0_c0c0_c0c0_c0c0)
}

fn make_policy(
    principal_tag: &str,
    target: AccessTarget,
    level: AccessLevel,
    priority: i32,
) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(principal_tag),
        target,
        level,
        priority,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("test"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

fn principal_with(tags: &[&str]) -> compute_security::Principal {
    let pool = PrincipalPool::new();
    pool.intern(tags.iter().map(|t| PrincipalTag::from(*t)))
}

/// Stub column index. Tests pass `(ColId, position)` pairs.
struct StubIndex {
    columns: Vec<(ColId, u32)>,
    count: u32,
}

impl StubIndex {
    fn new(columns: Vec<(ColId, u32)>) -> Self {
        let count = columns.iter().map(|(_, p)| p + 1).max().unwrap_or(0);
        Self { columns, count }
    }

    fn with_count(columns: Vec<(ColId, u32)>, count: u32) -> Self {
        Self { columns, count }
    }
}

impl ColumnIndex for StubIndex {
    fn position_of(&self, col: ColId) -> Option<u32> {
        self.columns
            .iter()
            .find_map(|(c, p)| if *c == col { Some(*p) } else { None })
    }

    fn column_count(&self) -> u32 {
        self.count
    }
}

// -----------------------------------------------------------------------------
// describe('matrix construction')
// -----------------------------------------------------------------------------

mod construction {
    use super::*;

    #[test]
    fn builds_matrix_with_sheet_default_from_workbook_policy() {
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Workbook,
            AccessLevel::Structure,
            0,
        )]);
        let index = StubIndex::with_count(vec![], 0);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.sheet_default(), AccessLevel::Structure);
        assert_eq!(m.column_overrides().len(), 0);
    }

    #[test]
    fn builds_matrix_with_column_overrides() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let index = StubIndex::new(vec![(col_a(), 0), (col_b(), 1)]);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.sheet_default(), AccessLevel::Read);
        // Two columns; position 0 (col A) overridden; position 1 defaults.
        assert_eq!(m.column_overrides().len(), 2);
        assert_eq!(m.column_overrides()[0], AccessLevel::None);
        assert_eq!(m.column_overrides()[1], AccessLevel::Read);
    }

    #[test]
    fn sheet_policy_overrides_workbook_for_sheet_default() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Sheet { sheet_id: sheet() },
                AccessLevel::Structure,
                0,
            ),
        ]);
        let index = StubIndex::with_count(vec![], 0);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.sheet_default(), AccessLevel::Structure);
    }
}

// -----------------------------------------------------------------------------
// describe('O(1) lookup via get')
// -----------------------------------------------------------------------------

mod lookup {
    use super::*;

    #[test]
    fn returns_column_override_when_present() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let index = StubIndex::new(vec![(col_a(), 0)]);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);

        // Column 0 (col A) has override.
        assert_eq!(m.get(0, 0), AccessLevel::None);
        assert_eq!(m.get(5, 0), AccessLevel::None);
        // Column 1 has no override → sheet default. Count was 1, so
        // position 1 falls through the col_overrides.get() guard.
        assert_eq!(m.get(0, 1), AccessLevel::Read);
        assert_eq!(m.get(5, 1), AccessLevel::Read);
    }

    #[test]
    fn column_overrides_take_precedence_over_sheet_default() {
        let engine = PolicyEngine::new([
            make_policy("user:*", AccessTarget::Workbook, AccessLevel::Write, 0),
            make_policy(
                "user:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::Read,
                0,
            ),
            make_policy(
                "user:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_b(),
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let index = StubIndex::new(vec![(col_a(), 0), (col_b(), 1), (col_c(), 2)]);
        let p = principal_with(&["user:alice"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);

        assert_eq!(m.get(0, 0), AccessLevel::Read);
        assert_eq!(m.get(0, 1), AccessLevel::None);
        assert_eq!(m.get(0, 2), AccessLevel::Write);
    }

    #[test]
    fn no_overrides_falls_back_to_sheet_default_for_all_cells() {
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Workbook,
            AccessLevel::Structure,
            0,
        )]);
        let index = StubIndex::with_count(vec![], 0);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);

        assert_eq!(m.get(0, 0), AccessLevel::Structure);
        assert_eq!(m.get(10, 5), AccessLevel::Structure);
        assert_eq!(m.get(99, 99), AccessLevel::Structure);
    }

    #[test]
    fn column_beyond_column_count_falls_back_to_sheet_default() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let index = StubIndex::new(vec![(col_a(), 0)]);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.get(0, 999), AccessLevel::Read);
    }
}

// -----------------------------------------------------------------------------
// describe('default deny in matrix')
// -----------------------------------------------------------------------------

mod default_deny {
    use super::*;

    #[test]
    fn sheet_default_is_none_for_non_owner_with_no_matching_policies() {
        let engine = PolicyEngine::new(std::iter::empty());
        let index = StubIndex::with_count(vec![], 0);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.sheet_default(), AccessLevel::None);
        assert_eq!(m.get(0, 0), AccessLevel::None);
    }

    #[test]
    fn sheet_default_is_admin_for_owner_with_no_policies() {
        let engine = PolicyEngine::new(std::iter::empty());
        let index = StubIndex::with_count(vec![], 0);
        let p = principal_with(&["mog:owner"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.sheet_default(), AccessLevel::Admin);
        assert_eq!(m.get(0, 0), AccessLevel::Admin);
    }
}

// -----------------------------------------------------------------------------
// describe('is_uniform')
// -----------------------------------------------------------------------------

mod is_uniform {
    use super::*;

    #[test]
    fn returns_some_when_no_col_overrides() {
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let index = StubIndex::with_count(vec![], 0);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.is_uniform(), Some(AccessLevel::Read));
    }

    #[test]
    fn returns_some_when_all_col_overrides_equal_sheet_default() {
        // No column policies — all column positions inherit sheet_default.
        let engine = PolicyEngine::new([make_policy(
            "agent:*",
            AccessTarget::Workbook,
            AccessLevel::Read,
            0,
        )]);
        let index = StubIndex::new(vec![(col_a(), 0), (col_b(), 1)]);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.is_uniform(), Some(AccessLevel::Read));
    }

    #[test]
    fn returns_none_when_a_column_differs_from_sheet_default() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_a(),
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let index = StubIndex::new(vec![(col_a(), 0), (col_b(), 1)]);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        assert_eq!(m.is_uniform(), None);
    }
}

// -----------------------------------------------------------------------------
// describe('deleted column policies silently skipped')
// Design choice: `evaluate_sheet` drops policies whose ColId no longer
// resolves through `ColumnIndex`. Pinned down here so R2's cache
// behaviour stays defined.
// -----------------------------------------------------------------------------

mod deleted_columns {
    use super::*;

    #[test]
    fn column_policy_with_unknown_col_id_is_silently_skipped() {
        let engine = PolicyEngine::new([
            make_policy("agent:*", AccessTarget::Workbook, AccessLevel::Read, 0),
            make_policy(
                "agent:*",
                AccessTarget::Column {
                    sheet_id: sheet(),
                    col_id: col_c(), // not in index
                },
                AccessLevel::None,
                0,
            ),
        ]);
        let index = StubIndex::new(vec![(col_a(), 0), (col_b(), 1)]);
        let p = principal_with(&["agent:copilot"]);
        let m = engine.evaluate_sheet(&p, sheet(), &index);
        // All columns inherit sheet_default because the policy's column
        // is not present in the index.
        assert_eq!(m.column_overrides()[0], AccessLevel::Read);
        assert_eq!(m.column_overrides()[1], AccessLevel::Read);
    }
}
