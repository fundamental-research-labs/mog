use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ChartError {
    #[error("transform failed in '{transform}': {reason}")]
    TransformFailed { transform: String, reason: String },
    #[error("invalid bin configuration: {0}")]
    InvalidBin(String),
}
