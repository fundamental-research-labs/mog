use super::super::*;

#[test]
fn test_multi_viewport_empty() {
    let buf = serialize_multi_viewport_patches(&[]);
    assert_eq!(buf.len(), 2);
    let count = u16::from_le_bytes(buf[0..2].try_into().unwrap());
    assert_eq!(count, 0);
}

#[test]
fn test_multi_viewport_single() {
    let inner = vec![1u8, 2, 3, 4]; // dummy patch bytes
    let patches = vec![("main".to_string(), inner.clone())];
    let buf = serialize_multi_viewport_patches(&patches);

    // Parse header
    let count = u16::from_le_bytes(buf[0..2].try_into().unwrap());
    assert_eq!(count, 1);

    // Parse first viewport entry
    let id_len = buf[2] as usize;
    assert_eq!(id_len, 4); // "main"
    let id = std::str::from_utf8(&buf[3..3 + id_len]).unwrap();
    assert_eq!(id, "main");

    let patch_len =
        u32::from_le_bytes(buf[3 + id_len..3 + id_len + 4].try_into().unwrap()) as usize;
    assert_eq!(patch_len, 4);

    let patch_data = &buf[3 + id_len + 4..3 + id_len + 4 + patch_len];
    assert_eq!(patch_data, &inner[..]);
}

#[test]
fn test_multi_viewport_multiple() {
    let patches = vec![
        ("top-left".to_string(), vec![10u8, 20]),
        ("bottom-right".to_string(), vec![30u8, 40, 50]),
    ];
    let buf = serialize_multi_viewport_patches(&patches);

    let count = u16::from_le_bytes(buf[0..2].try_into().unwrap());
    assert_eq!(count, 2);

    // Parse first entry
    let mut off = 2;
    let id1_len = buf[off] as usize;
    off += 1;
    let id1 = std::str::from_utf8(&buf[off..off + id1_len]).unwrap();
    assert_eq!(id1, "top-left");
    off += id1_len;
    let p1_len = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap()) as usize;
    off += 4;
    assert_eq!(p1_len, 2);
    assert_eq!(&buf[off..off + p1_len], &[10u8, 20]);
    off += p1_len;

    // Parse second entry
    let id2_len = buf[off] as usize;
    off += 1;
    let id2 = std::str::from_utf8(&buf[off..off + id2_len]).unwrap();
    assert_eq!(id2, "bottom-right");
    off += id2_len;
    let p2_len = u32::from_le_bytes(buf[off..off + 4].try_into().unwrap()) as usize;
    off += 4;
    assert_eq!(p2_len, 3);
    assert_eq!(&buf[off..off + p2_len], &[30u8, 40, 50]);
}
