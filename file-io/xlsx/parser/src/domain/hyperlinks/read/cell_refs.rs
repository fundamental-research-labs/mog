//! Cell reference helpers used by hyperlink range lookup.

use crate::domain::hyperlinks::types::{Hyperlink, Hyperlinks};

impl Hyperlinks {
    /// Get all hyperlinks for cells in a range.
    ///
    /// If `range` is not a valid range, this falls back to exact cell reference
    /// equality with each hyperlink's `cell_ref`.
    pub fn get_in_range(&self, range: &str) -> Vec<&Hyperlink> {
        if let Some((start_ref, end_ref)) = parse_cell_range(range) {
            self.hyperlinks
                .iter()
                .filter(|h| {
                    if let Some((col, row)) = parse_cell_ref(&h.cell_ref) {
                        let (start_col, start_row) = start_ref;
                        let (end_col, end_row) = end_ref;
                        col >= start_col && col <= end_col && row >= start_row && row <= end_row
                    } else {
                        false
                    }
                })
                .collect()
        } else {
            self.hyperlinks
                .iter()
                .filter(|h| h.cell_ref == range)
                .collect()
        }
    }
}

fn parse_cell_ref(cell_ref: &str) -> Option<(u32, u32)> {
    let bytes = cell_ref.as_bytes();
    let mut col: u32 = 0;
    let mut row: u32 = 0;
    let mut i = 0;

    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
        let c = bytes[i].to_ascii_uppercase();
        col = col * 26 + (c - b'A' + 1) as u32;
        i += 1;
    }

    if col == 0 {
        return None;
    }

    while i < bytes.len() && bytes[i].is_ascii_digit() {
        row = row * 10 + (bytes[i] - b'0') as u32;
        i += 1;
    }

    if row == 0 || i != bytes.len() {
        return None;
    }

    Some((col, row))
}

fn parse_cell_range(range: &str) -> Option<((u32, u32), (u32, u32))> {
    let mut parts = range.split(':');
    let start = parts.next()?;
    let end = parts.next()?;
    if parts.next().is_some() {
        return None;
    }

    let start = parse_cell_ref(start)?;
    let end = parse_cell_ref(end)?;
    Some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cell_ref() {
        assert_eq!(parse_cell_ref("A1"), Some((1, 1)));
        assert_eq!(parse_cell_ref("B5"), Some((2, 5)));
        assert_eq!(parse_cell_ref("Z26"), Some((26, 26)));
        assert_eq!(parse_cell_ref("AA1"), Some((27, 1)));
        assert_eq!(parse_cell_ref("AB100"), Some((28, 100)));
        assert_eq!(parse_cell_ref("XFD1048576"), Some((16384, 1048576)));
        assert_eq!(parse_cell_ref("a1"), Some((1, 1)));
    }

    #[test]
    fn test_parse_cell_ref_invalid() {
        assert_eq!(parse_cell_ref(""), None);
        assert_eq!(parse_cell_ref("1A"), None);
        assert_eq!(parse_cell_ref("A"), None);
        assert_eq!(parse_cell_ref("1"), None);
        assert_eq!(parse_cell_ref("A1:B2"), None);
    }

    #[test]
    fn test_parse_cell_range() {
        let range = parse_cell_range("A1:B5").unwrap();
        assert_eq!(range, ((1, 1), (2, 5)));

        let range = parse_cell_range("AA10:ZZ100").unwrap();
        assert_eq!(range, ((27, 10), (702, 100)));
    }

    #[test]
    fn test_parse_cell_range_invalid() {
        assert!(parse_cell_range("A1").is_none());
        assert!(parse_cell_range("A1:").is_none());
        assert!(parse_cell_range(":B5").is_none());
        assert!(parse_cell_range("A1:B5:C6").is_none());
    }

    #[test]
    fn test_hyperlinks_get_in_range() {
        let hls = Hyperlinks {
            hyperlinks: vec![
                Hyperlink {
                    cell_ref: "A1".to_string(),
                    ..Default::default()
                },
                Hyperlink {
                    cell_ref: "B2".to_string(),
                    ..Default::default()
                },
                Hyperlink {
                    cell_ref: "C3".to_string(),
                    ..Default::default()
                },
            ],
        };

        assert_eq!(hls.get_in_range("A1:B2").len(), 2);
        assert_eq!(hls.get_in_range("A1:C3").len(), 3);
        assert_eq!(hls.get_in_range("E5:F6").len(), 0);
    }

    #[test]
    fn lowercase_hyperlink_refs_match_ranges() {
        let hls = Hyperlinks {
            hyperlinks: vec![Hyperlink {
                cell_ref: "b2".to_string(),
                ..Default::default()
            }],
        };

        assert_eq!(hls.get_in_range("A1:C3").len(), 1);
    }

    #[test]
    fn multi_cell_hyperlink_refs_do_not_match_larger_range() {
        let hls = Hyperlinks {
            hyperlinks: vec![Hyperlink {
                cell_ref: "A1:B2".to_string(),
                ..Default::default()
            }],
        };

        assert_eq!(hls.get_in_range("A1:C3").len(), 0);
    }
}
