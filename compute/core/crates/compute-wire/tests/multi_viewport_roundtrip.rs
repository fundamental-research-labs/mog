#![allow(clippy::pedantic, clippy::all, missing_docs)]

mod support;

use compute_wire::serialize_multi_viewport_patches;
use support::wire::{read_u8, read_u16, read_u32};

#[test]
fn multi_viewport_roundtrip() {
    let vp1_data = vec![1u8, 2, 3, 4, 5];
    let vp2_data = vec![10, 20, 30];
    let patches = vec![
        ("viewport-A".to_string(), vp1_data.clone()),
        ("viewport-B".to_string(), vp2_data.clone()),
    ];

    let buf = serialize_multi_viewport_patches(&patches);

    // Header: u16 viewport_count
    let vp_count = read_u16(&buf, 0) as usize;
    assert_eq!(vp_count, 2);

    // Entry 0
    let mut off = 2;
    let id_len_0 = read_u8(&buf, off) as usize;
    off += 1;
    let id_0 = String::from_utf8(buf[off..off + id_len_0].to_vec()).unwrap();
    assert_eq!(id_0, "viewport-A");
    off += id_len_0;
    let patch_len_0 = read_u32(&buf, off) as usize;
    off += 4;
    assert_eq!(patch_len_0, 5);
    assert_eq!(&buf[off..off + patch_len_0], &vp1_data[..]);
    off += patch_len_0;

    // Entry 1
    let id_len_1 = read_u8(&buf, off) as usize;
    off += 1;
    let id_1 = String::from_utf8(buf[off..off + id_len_1].to_vec()).unwrap();
    assert_eq!(id_1, "viewport-B");
    off += id_len_1;
    let patch_len_1 = read_u32(&buf, off) as usize;
    off += 4;
    assert_eq!(patch_len_1, 3);
    assert_eq!(&buf[off..off + patch_len_1], &vp2_data[..]);
    off += patch_len_1;

    assert_eq!(off, buf.len(), "consumed entire buffer");
}

#[test]
fn multi_viewport_empty() {
    let buf = serialize_multi_viewport_patches(&[]);
    assert_eq!(buf.len(), 2);
    assert_eq!(read_u16(&buf, 0), 0);
}
