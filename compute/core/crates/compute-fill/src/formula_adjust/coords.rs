pub(super) struct ShiftedCoord {
    pub(super) value: u32,
    pub(super) out_of_bounds: bool,
}

/// Shift a single coordinate by `delta`, respecting the `absolute` flag.
///
/// When out of bounds, the shifted value is set to `original`.
#[inline]
pub(super) fn shift_coord(original: u32, delta: i64, absolute: bool, max: u32) -> ShiftedCoord {
    if absolute {
        return ShiftedCoord {
            value: original,
            out_of_bounds: false,
        };
    }

    let shifted = original as i64 + delta;
    if shifted < 0 || shifted >= max as i64 {
        ShiftedCoord {
            value: original,
            out_of_bounds: true,
        }
    } else {
        ShiftedCoord {
            value: shifted as u32,
            out_of_bounds: false,
        }
    }
}
