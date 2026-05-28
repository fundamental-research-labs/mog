use super::IdentityRangeSchemaRef;

pub(super) fn parse_range_corners(rr: &IdentityRangeSchemaRef) -> Option<((u32, u32), (u32, u32))> {
    fn parse_row_col(id: &str) -> Option<(u32, u32)> {
        let (r_str, c_str) = id.split_once(':')?;
        Some((r_str.parse::<u32>().ok()?, c_str.parse::<u32>().ok()?))
    }
    Some((parse_row_col(&rr.start_id)?, parse_row_col(&rr.end_id)?))
}

pub(in crate::storage::sheet) fn position_in_range(
    row: u32,
    col: u32,
    rr: &IdentityRangeSchemaRef,
) -> bool {
    let Some(((sr, sc), (er, ec))) = parse_range_corners(rr) else {
        return false;
    };
    let min_r = sr.min(er);
    let max_r = sr.max(er);
    let min_c = sc.min(ec);
    let max_c = sc.max(ec);
    row >= min_r && row <= max_r && col >= min_c && col <= max_c
}

pub(super) fn anchor_of_first_containing_range(
    ranges: &[IdentityRangeSchemaRef],
    row: u32,
    col: u32,
) -> Option<(u32, u32)> {
    for rr in ranges {
        if !position_in_range(row, col, rr) {
            continue;
        }
        let ((sr, sc), (er, ec)) = parse_range_corners(rr)?;
        return Some((sr.min(er), sc.min(ec)));
    }
    None
}
