//! Primitive writers for palette binary records.

use super::string_pool::StringPool;

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/// Write a `StrRef` (`u32` offset + `u16` length) to `buf`.
pub(super) fn write_str_ref(buf: &mut Vec<u8>, offset: u32, length: u16) {
    buf.extend_from_slice(&offset.to_le_bytes());
    buf.extend_from_slice(&length.to_le_bytes());
}

/// Intern a string and write its `StrRef` to `buf`.
pub(super) fn write_string(buf: &mut Vec<u8>, s: &str, pool: &mut StringPool) {
    let (offset, length) = pool.intern(s);
    write_str_ref(buf, offset, length);
}

pub(super) fn write_bool(buf: &mut Vec<u8>, v: bool) {
    buf.push(u8::from(v));
}

pub(super) fn write_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

pub(super) fn write_i32(buf: &mut Vec<u8>, v: i32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

pub(super) fn write_f64(buf: &mut Vec<u8>, v: f64) {
    buf.extend_from_slice(&v.to_le_bytes());
}

pub(super) fn write_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}
