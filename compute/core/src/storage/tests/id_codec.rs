use super::*;

#[test]
fn test_hex_roundtrip() {
    let id: u128 = 0x550e8400_e29b_41d4_a716_446655440000;
    let hex = id_to_hex(id);
    assert_eq!(hex, "550e8400e29b41d4a716446655440000");
    assert_eq!(hex_to_id(&hex), Some(id));
}

#[test]
fn test_hex_zero() {
    let hex = id_to_hex(0);
    assert_eq!(hex, "00000000000000000000000000000000");
    assert_eq!(hex_to_id(&hex), Some(0));
}

#[test]
fn test_hex_max() {
    let hex = id_to_hex(u128::MAX);
    assert_eq!(hex, "ffffffffffffffffffffffffffffffff");
    assert_eq!(hex_to_id(&hex), Some(u128::MAX));
}
