#[inline]
fn is_start_tag_boundary(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | b'>' | b'/')
}

#[inline]
fn is_closing_tag_boundary(byte: u8) -> bool {
    matches!(byte, b'>' | b' ' | b'\t' | b'\n' | b'\r')
}

#[inline]
fn local_name_start(bytes: &[u8], name_start: usize, name_end: usize) -> usize {
    bytes[name_start..name_end]
        .iter()
        .position(|&b| b == b':')
        .map_or(name_start, |colon_offset| name_start + colon_offset + 1)
}

#[inline]
pub(super) fn start_tag_name_matches(
    bytes: &[u8],
    name_start: usize,
    name_end: usize,
    tag: &[u8],
) -> bool {
    name_matches(bytes, name_start, name_end, tag, is_start_tag_boundary)
}

#[inline]
pub(super) fn closing_tag_name_matches(
    bytes: &[u8],
    name_start: usize,
    name_end: usize,
    tag: &[u8],
) -> bool {
    name_matches(bytes, name_start, name_end, tag, is_closing_tag_boundary)
}

#[inline]
fn name_matches(
    bytes: &[u8],
    name_start: usize,
    name_end: usize,
    tag: &[u8],
    is_boundary: impl Fn(u8) -> bool,
) -> bool {
    if name_matches_at(bytes, name_start, name_end, tag, &is_boundary) {
        return true;
    }

    let local_start = local_name_start(bytes, name_start, name_end);
    local_start != name_start && name_matches_at(bytes, local_start, name_end, tag, is_boundary)
}

#[inline]
fn name_matches_at(
    bytes: &[u8],
    local_start: usize,
    name_end: usize,
    tag: &[u8],
    is_boundary: impl Fn(u8) -> bool,
) -> bool {
    let after_tag = local_start + tag.len();

    if after_tag > bytes.len() || !bytes[local_start..].starts_with(tag) || after_tag > name_end {
        return false;
    }

    after_tag >= bytes.len() || is_boundary(bytes[after_tag])
}
