use super::support::*;
use super::*;

#[test]
fn test_update_preserves_entries() {
    // Insert A then B; update A; both entries still present.
    let (mut storage, sid, _gi) = storage_with_sheet();
    let a = range_schema_at("rs-A", "0:0", "0:0");
    let b = range_schema_at("rs-B", "1:0", "1:0");

    set_range_schema(&mut storage, &sid, &a).unwrap();
    set_range_schema(&mut storage, &sid, &b).unwrap();
    let mut ids = view_ids(&storage, &sid);
    ids.sort();
    assert_eq!(ids, vec!["rs-A", "rs-B"]);

    // Mutate A's enforcement and update by id.
    let mut a2 = a.clone();
    a2.enforcement = Some(EnforcementLevel::Warning);
    update_range_schema(&mut storage, &sid, "rs-A", &a2).unwrap();

    // Both entries still present and the field was actually updated.
    let mut ids = view_ids(&storage, &sid);
    ids.sort();
    assert_eq!(ids, vec!["rs-A", "rs-B"]);
    let fetched = get_range_schema(&storage, &sid, "rs-A").expect("rs-A");
    assert_eq!(fetched.enforcement, Some(EnforcementLevel::Warning));
    assert_eq!(validation_rule_count(&storage, &sid), 2);
}
