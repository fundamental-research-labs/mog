use std::fmt::Write as _;

pub(super) fn write_r1c1_row(out: &mut String, row: u32, absolute: bool, base_row: u32) {
    out.push('R');
    if absolute {
        write!(out, "{}", row + 1).unwrap();
    } else {
        let offset = i64::from(row) - i64::from(base_row);
        if offset != 0 {
            write!(out, "[{offset}]").unwrap();
        }
    }
}

pub(super) fn write_r1c1_col(out: &mut String, col: u32, absolute: bool, base_col: u32) {
    out.push('C');
    if absolute {
        write!(out, "{}", col + 1).unwrap();
    } else {
        let offset = i64::from(col) - i64::from(base_col);
        if offset != 0 {
            write!(out, "[{offset}]").unwrap();
        }
    }
}
