use super::super::mutation::BridgeSortCriterion;
use cell_types::{MAX_COLS, MAX_ROWS};
use value_types::ComputeError;

pub fn validate_sort_criteria(criteria: &[BridgeSortCriterion]) -> Result<(), ComputeError> {
    if criteria.is_empty() {
        return Err(ComputeError::InvalidInput {
            message: "sortRange requires at least one sort criterion".into(),
        });
    }
    Ok(())
}

pub fn validate_range_bounds(
    start_row: u32,
    start_col: u32,
    end_row: u32,
    end_col: u32,
) -> Result<(), ComputeError> {
    if end_row > MAX_ROWS || end_col > MAX_COLS {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Range ({},{})..({},{}) exceeds sheet bounds ({}x{})",
                start_row, start_col, end_row, end_col, MAX_ROWS, MAX_COLS
            ),
        });
    }
    if start_row > end_row || start_col > end_col {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Invalid range: start ({},{}) > end ({},{})",
                start_row, start_col, end_row, end_col
            ),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_sort_criteria() {
        assert!(validate_sort_criteria(&[]).is_err());
    }

    #[test]
    fn accepts_non_empty_sort_criteria() {
        use crate::storage::engine::mutation::BridgeSortMode;
        use domain_types::domain::filter::SortOrder;
        let criteria = vec![BridgeSortCriterion {
            column: 0,
            direction: SortOrder::Asc,
            case_sensitive: false,
            mode: BridgeSortMode::Value { custom_list: None },
        }];
        assert!(validate_sort_criteria(&criteria).is_ok());
    }

    #[test]
    fn rejects_range_exceeding_sheet_bounds() {
        assert!(validate_range_bounds(0, 0, MAX_ROWS + 1, 0).is_err());
        assert!(validate_range_bounds(0, 0, 0, MAX_COLS + 1).is_err());
    }

    #[test]
    fn rejects_inverted_range() {
        assert!(validate_range_bounds(5, 0, 3, 0).is_err());
        assert!(validate_range_bounds(0, 5, 0, 3).is_err());
    }

    #[test]
    fn accepts_valid_range() {
        assert!(validate_range_bounds(0, 0, 100, 100).is_ok());
        assert!(validate_range_bounds(0, 0, MAX_ROWS, MAX_COLS).is_ok());
    }
}
