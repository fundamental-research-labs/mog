use super::*;
use cell_types::ColId;
use compute_security::{PolicyMetadata, PrincipalPool, TagMatcher};

fn policy(tag: &str, level: AccessLevel) -> AccessPolicy {
    AccessPolicy {
        id: PolicyId::new_v4(),
        principal_tag: TagMatcher::parse(tag),
        target: AccessTarget::Workbook,
        level,
        priority: 0,
        enabled: true,
        metadata: PolicyMetadata {
            created_by: Arc::from("test"),
            created_at_millis: 0,
            template_id: None,
        },
    }
}

struct Columns(Vec<ColId>);
impl ColumnIndex for Columns {
    fn position_of(&self, col: ColId) -> Option<u32> {
        self.0.iter().position(|c| *c == col).map(|p| p as u32)
    }
    fn column_count(&self) -> u32 {
        self.0.len() as u32
    }
}

#[test]
fn mutation_publishes_activation_and_one_event_before_returning() {
    let events = Arc::new(SecurityEventBuffer::default());
    let mut state = SecurityState::with_event_buffer(Arc::clone(&events));
    let active = state.active_handle();
    assert!(!active.load(Ordering::Acquire));
    assert!(events.drain().is_empty());
    let p = policy("agent:*", AccessLevel::Read);
    state.add_policy(p.clone());
    assert!(active.load(Ordering::Acquire));
    assert_eq!(state.policies(), &[p.clone()]);
    assert_eq!(state.policy_version(), 1);
    assert!(matches!(
        events.drain().as_slice(),
        [SecurityEvent::PoliciesReloaded {
            policy_version_before: 0,
            policy_version_after: 1,
            active: true,
        }]
    ));
    state.remove_policy(p.id);
    assert!(!active.load(Ordering::Acquire));
    assert!(state.policies().is_empty());
    assert!(matches!(
        events.drain().as_slice(),
        [SecurityEvent::PoliciesReloaded {
            policy_version_before: 1,
            policy_version_after: 2,
            active: false,
        }]
    ));
}

#[test]
fn policy_updates_invalidate_cached_decisions_and_preserve_old_views() {
    let mut state = SecurityState::default();
    let pool = PrincipalPool::new();
    let principal = pool.intern([PrincipalTag::from("agent:test")]);
    let sheet = SheetId::from_raw(1);
    let cols = Columns(vec![ColId::from_raw(2)]);
    let p = policy("agent:*", AccessLevel::Read);
    state.add_policy(p.clone());
    let old_policies = state.policy_engine();
    let first = state.active_matrix(&principal, sheet, &cols);
    assert_eq!(first.sheet_default(), AccessLevel::Read);
    assert!(Arc::ptr_eq(
        &first,
        &state.active_matrix(&principal, sheet, &cols)
    ));
    state.update_policy(
        p.id,
        &AccessPolicyPatch {
            level: Some(AccessLevel::None),
            ..Default::default()
        },
    );
    let second = state.active_matrix(&principal, sheet, &cols);
    assert_eq!(second.sheet_default(), AccessLevel::None);
    assert!(!Arc::ptr_eq(&first, &second));
    assert_eq!(old_policies.policies()[0].level, AccessLevel::Read);
    state.bump_structure_version();
    assert!(!Arc::ptr_eq(
        &second,
        &state.active_matrix(&principal, sheet, &cols)
    ));
}

#[test]
fn replacing_an_id_keeps_one_policy_and_uuid_order() {
    let mut state = SecurityState::default();
    let policies: Vec<_> = (0..5)
        .map(|i| policy(&format!("agent:{i}"), AccessLevel::Read))
        .collect();
    for p in &policies {
        state.add_policy(p.clone());
    }
    let mut replacement = policies[2].clone();
    replacement.level = AccessLevel::Write;
    state.add_policy(replacement.clone());
    assert_eq!(state.policies().len(), 5);
    assert_eq!(
        state.policies().iter().find(|p| p.id == replacement.id),
        Some(&replacement)
    );
    assert!(
        state
            .policies()
            .windows(2)
            .all(|p| p[0].id.as_uuid() < p[1].id.as_uuid())
    );
}

#[test]
fn repeated_templates_remove_all_generated_policies_only() {
    let mut state = SecurityState::default();
    let custom = policy("agent:custom", AccessLevel::Write);
    state.add_policy(custom.clone());
    let first = compute_security::Template::ProtectWorkbook.generate();
    let second = compute_security::Template::ProtectWorkbook.generate();
    state.apply_template("protect-workbook".into(), &first);
    state.apply_template("protect-workbook".into(), &second);
    assert_eq!(state.policies().len(), 3);
    let removed = state.remove_template("protect-workbook");
    assert_eq!(removed, vec![first[0].id, second[0].id]);
    assert_eq!(state.policies(), &[custom]);
}
