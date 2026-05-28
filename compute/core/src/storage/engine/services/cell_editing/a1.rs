pub(in crate::storage::engine) fn a1_range_string(
    top_row: u32,
    left_col: u32,
    bottom_row: u32,
    right_col: u32,
) -> String {
    use cell_types::col_to_letter_buf;
    let mut s = String::with_capacity(16);
    col_to_letter_buf(left_col, &mut s);
    use std::fmt::Write;
    let _ = write!(&mut s, "{}", top_row + 1);
    s.push(':');
    col_to_letter_buf(right_col, &mut s);
    let _ = write!(&mut s, "{}", bottom_row + 1);
    s
}
