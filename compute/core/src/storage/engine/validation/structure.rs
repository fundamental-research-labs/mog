use domain_types::units::{CharWidth, Points};
use value_types::ComputeError;

const MAX_ROW_HEIGHT_PT: f64 = 409.0;
const MAX_COL_WIDTH_CHARS: f64 = 255.0;

pub fn validate_delete_bounds(at: u32, count: u32, current_count: u32) -> Result<(), ComputeError> {
    if at + count > current_count {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Cannot delete {} rows/cols from index {}: only {} exist",
                count, at, current_count
            ),
        });
    }
    Ok(())
}

pub fn validate_row_height(height: Points) -> Result<(), ComputeError> {
    if height.0 <= 0.0 || height.0 > MAX_ROW_HEIGHT_PT {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Row height must be 0-{} points, got {}",
                MAX_ROW_HEIGHT_PT, height.0
            ),
        });
    }
    Ok(())
}

pub fn validate_col_width(width: CharWidth) -> Result<(), ComputeError> {
    if width.0 <= 0.0 || width.0 > MAX_COL_WIDTH_CHARS {
        return Err(ComputeError::InvalidInput {
            message: format!(
                "Column width must be 0-{} characters, got {}",
                MAX_COL_WIDTH_CHARS, width.0
            ),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_delete_overflow() {
        assert!(validate_delete_bounds(5, 10, 8).is_err());
    }

    #[test]
    fn accepts_valid_delete() {
        assert!(validate_delete_bounds(5, 3, 8).is_ok());
        assert!(validate_delete_bounds(0, 8, 8).is_ok());
    }

    #[test]
    fn rejects_zero_row_height() {
        assert!(validate_row_height(Points(0.0)).is_err());
        assert!(validate_row_height(Points(-1.0)).is_err());
    }

    #[test]
    fn rejects_excessive_row_height() {
        assert!(validate_row_height(Points(410.0)).is_err());
    }

    #[test]
    fn accepts_valid_row_height() {
        assert!(validate_row_height(Points(0.5)).is_ok());
        assert!(validate_row_height(Points(20.0)).is_ok());
        assert!(validate_row_height(Points(409.0)).is_ok());
    }

    #[test]
    fn rejects_zero_col_width() {
        assert!(validate_col_width(CharWidth(0.0)).is_err());
        assert!(validate_col_width(CharWidth(-5.0)).is_err());
    }

    #[test]
    fn rejects_excessive_col_width() {
        assert!(validate_col_width(CharWidth(256.0)).is_err());
    }

    #[test]
    fn accepts_valid_col_width() {
        assert!(validate_col_width(CharWidth(0.5)).is_ok());
        assert!(validate_col_width(CharWidth(8.43)).is_ok());
        assert!(validate_col_width(CharWidth(255.0)).is_ok());
    }
}
