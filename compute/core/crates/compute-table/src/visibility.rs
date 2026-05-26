//! Row Visibility Module — Pure computation for bitmap composition and RowVisibility.
//!
//! Bitmaps use `Vec<u8>` where each byte is 1 (visible) or 0 (hidden).
//! One byte per data row — simple, cache-friendly, and composable via AND.

use super::types::RowVisibility;

// =============================================================================
// Bitmap Composition
// =============================================================================

/// Compose multiple visibility bitmaps via AND — a row must pass ALL filters.
///
/// - Empty slice -> returns a `Vec<u8>` of all 1s with length 0 (empty).
///   In practice, callers should use `all_visible(count)` when there are no
///   bitmaps.
/// - Single bitmap -> returns a copy (no mutation of input).
/// - Multiple bitmaps -> element-wise AND using the minimum length.
///
/// Internally processes 8 bytes at a time via u64 AND for throughput.
pub fn compose_bitmaps(bitmaps: &[&[u8]]) -> Vec<u8> {
    if bitmaps.is_empty() {
        return Vec::new();
    }

    if bitmaps.len() == 1 {
        return bitmaps[0].to_vec();
    }

    let length = bitmaps.iter().map(|b| b.len()).min().unwrap_or(0);

    // Start with the first bitmap as the base (copy).
    let mut result = bitmaps[0][..length].to_vec();

    // AND each subsequent bitmap into result, processing 8 bytes at a time.
    for bitmap in &bitmaps[1..] {
        let chunks = length / 8;
        let remainder = length % 8;

        for chunk in 0..chunks {
            let offset = chunk * 8;
            // Load 8 bytes from both, AND, store back.
            let a = u64::from_ne_bytes(result[offset..offset + 8].try_into().unwrap());
            let b = u64::from_ne_bytes(bitmap[offset..offset + 8].try_into().unwrap());
            result[offset..offset + 8].copy_from_slice(&(a & b).to_ne_bytes());
        }

        // Handle tail bytes.
        let tail_start = chunks * 8;
        for i in tail_start..tail_start + remainder {
            result[i] &= bitmap[i];
        }
    }

    result
}

// =============================================================================
// Row Visibility
// =============================================================================

/// Create a RowVisibility summary from a bitmap.
///
/// Computes visible_count, first_visible_row, and last_visible_row by scanning
/// the bitmap. first_visible_row and last_visible_row are relative to data range
/// start (0-based). Returns `None` for both if no rows are visible.
pub fn create_row_visibility(bitmap: &[u8]) -> RowVisibility {
    let len = bitmap.len();
    let mut visible_count: u32 = 0;
    let mut first_visible_row: Option<u32> = None;
    let mut last_visible_row: Option<u32> = None;

    // Count visible rows processing 8 bytes at a time.
    // Since each byte is 0 or 1, summing them gives the count.
    let chunks = len / 8;
    let remainder = len % 8;

    for chunk in 0..chunks {
        let offset = chunk * 8;
        let word = u64::from_ne_bytes(bitmap[offset..offset + 8].try_into().unwrap());
        if word != 0 {
            // At least one visible row in this chunk — find first/last and count.
            for j in 0..8 {
                if bitmap[offset + j] != 0 {
                    visible_count += 1;
                    let idx = (offset + j) as u32;
                    if first_visible_row.is_none() {
                        first_visible_row = Some(idx);
                    }
                    last_visible_row = Some(idx);
                }
            }
        }
    }

    // Handle tail.
    let tail_start = chunks * 8;
    for i in 0..remainder {
        if bitmap[tail_start + i] != 0 {
            visible_count += 1;
            let idx = (tail_start + i) as u32;
            if first_visible_row.is_none() {
                first_visible_row = Some(idx);
            }
            last_visible_row = Some(idx);
        }
    }

    RowVisibility {
        bitmap: bitmap.to_vec(),
        visible_count,
        total_count: len as u32,
        first_visible_row,
        last_visible_row,
    }
}

/// Helper: create a RowVisibility where all rows are visible.
pub fn all_visible(count: usize) -> RowVisibility {
    RowVisibility {
        bitmap: vec![1u8; count],
        visible_count: count as u32,
        total_count: count as u32,
        first_visible_row: if count > 0 { Some(0) } else { None },
        last_visible_row: if count > 0 {
            Some((count as u32) - 1)
        } else {
            None
        },
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // compose_bitmaps
    // -----------------------------------------------------------------------

    #[test]
    fn compose_empty_returns_empty() {
        let result = compose_bitmaps(&[]);
        assert!(result.is_empty());
    }

    #[test]
    fn compose_single_returns_copy() {
        let bitmap: Vec<u8> = vec![1, 0, 1, 1, 0];
        let result = compose_bitmaps(&[&bitmap]);
        assert_eq!(result, vec![1, 0, 1, 1, 0]);
    }

    #[test]
    fn compose_two_bitmaps_and() {
        let a: Vec<u8> = vec![1, 1, 0, 1, 0];
        let b: Vec<u8> = vec![1, 0, 0, 1, 1];
        let result = compose_bitmaps(&[&a, &b]);
        assert_eq!(result, vec![1, 0, 0, 1, 0]);
    }

    #[test]
    fn compose_three_bitmaps_and() {
        let a: Vec<u8> = vec![1, 1, 1, 1];
        let b: Vec<u8> = vec![1, 1, 0, 1];
        let c: Vec<u8> = vec![1, 0, 1, 1];
        let result = compose_bitmaps(&[&a, &b, &c]);
        assert_eq!(result, vec![1, 0, 0, 1]);
    }

    #[test]
    fn compose_uses_min_length() {
        let a: Vec<u8> = vec![1, 1, 1, 1, 1];
        let b: Vec<u8> = vec![1, 1, 0];
        let result = compose_bitmaps(&[&a, &b]);
        assert_eq!(result, vec![1, 1, 0]);
    }

    #[test]
    fn compose_all_zeros() {
        let a: Vec<u8> = vec![0, 0, 0];
        let b: Vec<u8> = vec![1, 1, 1];
        let result = compose_bitmaps(&[&a, &b]);
        assert_eq!(result, vec![0, 0, 0]);
    }

    #[test]
    fn compose_all_ones() {
        let a: Vec<u8> = vec![1, 1, 1];
        let b: Vec<u8> = vec![1, 1, 1];
        let result = compose_bitmaps(&[&a, &b]);
        assert_eq!(result, vec![1, 1, 1]);
    }

    // -----------------------------------------------------------------------
    // create_row_visibility
    // -----------------------------------------------------------------------

    #[test]
    fn visibility_all_visible() {
        let bitmap = vec![1, 1, 1, 1, 1];
        let vis = create_row_visibility(&bitmap);
        assert_eq!(vis.visible_count, 5);
        assert_eq!(vis.total_count, 5);
        assert_eq!(vis.first_visible_row, Some(0));
        assert_eq!(vis.last_visible_row, Some(4));
        assert_eq!(vis.bitmap, vec![1, 1, 1, 1, 1]);
    }

    #[test]
    fn visibility_none_visible() {
        let bitmap = vec![0, 0, 0];
        let vis = create_row_visibility(&bitmap);
        assert_eq!(vis.visible_count, 0);
        assert_eq!(vis.total_count, 3);
        assert_eq!(vis.first_visible_row, None);
        assert_eq!(vis.last_visible_row, None);
    }

    #[test]
    fn visibility_some_visible() {
        let bitmap = vec![0, 1, 0, 1, 0];
        let vis = create_row_visibility(&bitmap);
        assert_eq!(vis.visible_count, 2);
        assert_eq!(vis.total_count, 5);
        assert_eq!(vis.first_visible_row, Some(1));
        assert_eq!(vis.last_visible_row, Some(3));
    }

    #[test]
    fn visibility_empty_bitmap() {
        let bitmap: Vec<u8> = vec![];
        let vis = create_row_visibility(&bitmap);
        assert_eq!(vis.visible_count, 0);
        assert_eq!(vis.total_count, 0);
        assert_eq!(vis.first_visible_row, None);
        assert_eq!(vis.last_visible_row, None);
    }

    #[test]
    fn visibility_single_row_visible() {
        let bitmap = vec![1];
        let vis = create_row_visibility(&bitmap);
        assert_eq!(vis.visible_count, 1);
        assert_eq!(vis.total_count, 1);
        assert_eq!(vis.first_visible_row, Some(0));
        assert_eq!(vis.last_visible_row, Some(0));
    }

    #[test]
    fn visibility_single_row_hidden() {
        let bitmap = vec![0];
        let vis = create_row_visibility(&bitmap);
        assert_eq!(vis.visible_count, 0);
        assert_eq!(vis.total_count, 1);
        assert_eq!(vis.first_visible_row, None);
        assert_eq!(vis.last_visible_row, None);
    }

    #[test]
    fn visibility_first_and_last_only() {
        let bitmap = vec![1, 0, 0, 0, 1];
        let vis = create_row_visibility(&bitmap);
        assert_eq!(vis.visible_count, 2);
        assert_eq!(vis.first_visible_row, Some(0));
        assert_eq!(vis.last_visible_row, Some(4));
    }

    // -----------------------------------------------------------------------
    // all_visible
    // -----------------------------------------------------------------------

    #[test]
    fn all_visible_nonzero() {
        let vis = all_visible(5);
        assert_eq!(vis.visible_count, 5);
        assert_eq!(vis.total_count, 5);
        assert_eq!(vis.first_visible_row, Some(0));
        assert_eq!(vis.last_visible_row, Some(4));
        assert_eq!(vis.bitmap, vec![1, 1, 1, 1, 1]);
    }

    #[test]
    fn all_visible_zero() {
        let vis = all_visible(0);
        assert_eq!(vis.visible_count, 0);
        assert_eq!(vis.total_count, 0);
        assert_eq!(vis.first_visible_row, None);
        assert_eq!(vis.last_visible_row, None);
        assert!(vis.bitmap.is_empty());
    }

    // -----------------------------------------------------------------------
    // Integration: compose then create visibility
    // -----------------------------------------------------------------------

    #[test]
    fn compose_then_visibility() {
        let filter1: Vec<u8> = vec![1, 1, 0, 1, 1];
        let filter2: Vec<u8> = vec![1, 0, 1, 1, 0];
        let composed = compose_bitmaps(&[&filter1, &filter2]);
        let vis = create_row_visibility(&composed);
        assert_eq!(vis.visible_count, 2);
        assert_eq!(vis.total_count, 5);
        assert_eq!(vis.first_visible_row, Some(0));
        assert_eq!(vis.last_visible_row, Some(3));
    }
}
