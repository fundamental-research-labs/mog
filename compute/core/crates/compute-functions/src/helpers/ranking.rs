/// Find the rank of `number` in a sorted ascending slice using binary search
/// with exact numeric comparisons. Returns `(count_less, count_equal)` where "less"
/// and "equal" are defined relative to the `order` parameter:
/// - order == 0 (descending): "less" means values > number, "equal" means values == number
/// - order != 0 (ascending): "less" means values < number, "equal" means values == number
pub fn rank_components(sorted_asc: &[f64], number: f64, order: i32) -> Option<(usize, usize)> {
    // A fixed epsilon collapses distinct small numbers into ties. Rank the
    // stored numeric values, preserving exact duplicates at every scale.
    let first_ge = sorted_asc.partition_point(|&x| x < number);
    let first_gt = sorted_asc.partition_point(|&x| x <= number);
    let equal_count = first_gt - first_ge;

    if equal_count == 0 {
        return None; // number not found in array
    }

    if order == 0 {
        // Descending: count how many are strictly greater
        let greater_count = sorted_asc.len() - first_gt;
        Some((greater_count, equal_count))
    } else {
        // Ascending: count how many are strictly less
        Some((first_ge, equal_count))
    }
}
