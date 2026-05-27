use crate::hex::{hex_to_id, parse_cell_id, parse_sheet_id};

#[test]
fn test_hex_parsing() {
    let id: u128 = 0x550e8400_e29b_41d4_a716_446655440000;
    let hex = format!("{:032x}", id);
    assert_eq!(hex_to_id(&hex), Some(id));

    assert!(parse_sheet_id(&hex).is_some());
    assert!(parse_cell_id(&hex).is_some());

    assert_eq!(hex_to_id("not_hex"), None);
    assert!(parse_sheet_id("zzz").is_none());
    assert!(parse_cell_id("zzz").is_none());
}
