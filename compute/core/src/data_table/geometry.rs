#[derive(Debug, Clone, Copy)]
pub(super) struct Rect {
    pub(super) start_row: u32,
    pub(super) start_col: u32,
    pub(super) end_row: u32,
    pub(super) end_col: u32,
}
impl Rect {
    pub(super) fn contains(self, row: u32, col: u32) -> bool {
        row >= self.start_row && row <= self.end_row && col >= self.start_col && col <= self.end_col
    }

    pub(super) fn intersects(self, other: Rect) -> bool {
        self.start_row <= other.end_row
            && self.end_row >= other.start_row
            && self.start_col <= other.end_col
            && self.end_col >= other.start_col
    }
}
