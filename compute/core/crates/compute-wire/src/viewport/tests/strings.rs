use super::*;

#[test]
fn test_string_pool_roundtrip() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let string_pool_bytes = u32::from_le_bytes(buf[16..20].try_into().unwrap()) as usize;
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + cell_count * CELL_STRIDE;

    // First cell: display_off=0, display_len=2 ("42")
    let cell0 = HEADER_SIZE;
    let d_off = u32::from_le_bytes(buf[cell0 + 8..cell0 + 12].try_into().unwrap()) as usize;
    let d_len = u16::from_le_bytes(buf[cell0 + 20..cell0 + 22].try_into().unwrap()) as usize;
    let text = std::str::from_utf8(&buf[pool_start + d_off..pool_start + d_off + d_len]).unwrap();
    assert_eq!(text, "42");

    // Verify string pool byte count
    assert_eq!(string_pool_bytes, 14); // "42" + "Hello" + "#DIV/0!"
}

#[test]
fn test_error_cell_string_pool() {
    let data = make_test_data();
    let buf = serialize_viewport_binary(&data, 0, false, 0);
    let cell_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
    let pool_start = HEADER_SIZE + cell_count * CELL_STRIDE;

    // Third cell (index 2)
    let off = HEADER_SIZE + 2 * CELL_STRIDE;
    // display_off should be NO_STRING (no formatted text)
    let d_off = u32::from_le_bytes(buf[off + 8..off + 12].try_into().unwrap());
    assert_eq!(d_off, NO_STRING);
    // error_off should point to "#DIV/0!" in the string pool
    let e_off = u32::from_le_bytes(buf[off + 12..off + 16].try_into().unwrap()) as usize;
    let e_len = u16::from_le_bytes(buf[off + 22..off + 24].try_into().unwrap()) as usize;
    let error_text =
        std::str::from_utf8(&buf[pool_start + e_off..pool_start + e_off + e_len]).unwrap();
    assert_eq!(error_text, "#DIV/0!");
}
