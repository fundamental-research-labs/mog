use value_types::ComputeError;

pub(super) fn invalid_data_table(code: &str, detail: &str) -> ComputeError {
    ComputeError::InvalidInput {
        message: format!("{code}: {detail}"),
    }
}
