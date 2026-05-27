/// Construct a statrs distribution or return the current function's #NUM! error.
macro_rules! try_dist {
    ($expr:expr, $func_name:expr) => {
        match $expr {
            Ok(d) => d,
            Err(_) => {
                return value_types::CellValue::error_with_message(
                    value_types::CellError::Num,
                    format!("{}: invalid distribution parameters", $func_name),
                )
            }
        }
    };
}

pub(super) use try_dist;
