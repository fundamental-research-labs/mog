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
