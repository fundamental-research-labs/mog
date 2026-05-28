//! Scanner helpers for validation read parsing.

use crate::infra::scanner::find_tag_simd;

/// Find a non-namespaced XML tag, skipping namespace-prefixed variants.
///
/// `find_tag_simd` matches both `<tag>` and `<ns:tag>`. This wrapper filters
/// out the namespaced hits by checking that `bytes[pos+1]` starts the tag name
/// directly (e.g., `<dataValidations` not `<x14:dataValidations`).
pub(crate) fn find_non_namespaced_tag(bytes: &[u8], tag: &[u8], start: usize) -> Option<usize> {
    let mut search_from = start;
    loop {
        let pos = find_tag_simd(bytes, tag, search_from)?;
        // pos points to '<'. The byte at pos+1 should be the first byte of `tag`
        // for the non-namespaced variant.
        if pos + 1 < bytes.len() && bytes[pos + 1] == tag[0] {
            return Some(pos);
        }
        search_from = pos + 1;
    }
}

pub(crate) fn find_prefixed_tag(
    bytes: &[u8],
    prefix: &[u8],
    tag: &[u8],
    start: usize,
) -> Option<usize> {
    let mut search_from = start;
    loop {
        let pos = find_tag_simd(bytes, tag, search_from)?;
        let name_start = pos + 1;
        let prefix_end = name_start + prefix.len();
        if prefix_end < bytes.len()
            && &bytes[name_start..prefix_end] == prefix
            && bytes[prefix_end] == b':'
            && bytes.get(prefix_end + 1) == Some(&tag[0])
        {
            return Some(pos);
        }
        search_from = pos + 1;
    }
}
