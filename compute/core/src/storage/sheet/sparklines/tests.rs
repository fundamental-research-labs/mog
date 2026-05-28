mod groups;
mod items;
mod range;
mod serde;
mod support;

#[test]
fn test_storage_key_formats() {
    assert_eq!(super::keys::idx_key(3, 5), "idx:3,5");
    assert_eq!(super::keys::group_key("g-1"), "group:g-1");
}
