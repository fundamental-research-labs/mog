use thiserror::Error;

#[derive(Debug, Error)]
#[non_exhaustive]
pub enum TableError {
    #[error("filter evaluation failed: {0}")]
    FilterEvaluation(String),
    #[error("slicer cache build failed for field '{field}': {reason}")]
    SlicerCache { field: String, reason: String },
    #[error("sort comparator failed: {0}")]
    SortComparator(String),
    #[error("range resolution failed: {0}")]
    RangeResolution(String),
    #[error("invalid range: {0}")]
    InvalidRange(String),
    #[error("invalid table name: {0}")]
    InvalidTableName(String),
    #[error("duplicate table name: {0}")]
    DuplicateTableName(String),
    #[error("duplicate column name: {0}")]
    DuplicateColumnName(String),
    #[error("table style not found: {0}")]
    StyleNotFound(String),
    #[error("duplicate table style name: {0}")]
    DuplicateStyleName(String),
}
