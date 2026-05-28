use crate::domain::pivot::read::{PivotCache, PivotLocation};
use pivot_types::CellRange;

pub(super) fn parse_output_anchor(location: &PivotLocation) -> Option<(u32, u32)> {
    location.ref_.as_ref().and_then(|r| match r.start {
        formula_types::CellRef::Positional { row, col, .. } => Some((row, col)),
        formula_types::CellRef::Resolved(_) => None,
    })
}

pub(super) fn parse_source_range(cache: &PivotCache) -> Option<CellRange> {
    let range_str = cache.source_ref.as_ref()?;
    let (start_row, start_col, end_row, end_col) = crate::infra::a1::parse_a1_range(range_str)?;
    Some(CellRange::new(start_row, start_col, end_row, end_col))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_source_range_from_cache_ref() {
        let cache = PivotCache {
            source_ref: Some("B2:D5".to_string()),
            ..Default::default()
        };

        assert_eq!(parse_source_range(&cache), Some(CellRange::new(1, 1, 4, 3)));
    }

    #[test]
    fn positional_output_ref_resolves_anchor() {
        let location = PivotLocation {
            ref_: compute_parser::parse_a1_range("C4:E9"),
            ..Default::default()
        };

        assert_eq!(parse_output_anchor(&location), Some((3, 2)));
    }

    #[test]
    fn missing_output_ref_is_rejected() {
        assert_eq!(parse_output_anchor(&PivotLocation::default()), None);
    }
}
