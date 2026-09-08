use thiserror::Error;

/// Errors from evaluating Office.js against the compute engine.
#[derive(Debug, Error)]
pub enum OfficeJsError {
    #[error("{0}")]
    Script(String),
    #[error("javascript runtime: {0}")]
    Runtime(String),
    #[error("engine: {0}")]
    Engine(#[from] compute_api::ComputeApiError),
}

impl OfficeJsError {
    pub(crate) fn runtime(err: impl std::fmt::Display) -> Self {
        Self::Runtime(err.to_string())
    }

    /// Office.js `RichApi.Error` code when the script threw one.
    pub fn code(&self) -> Option<&str> {
        match self {
            Self::Script(message) if message.contains("PropertyNotLoaded") => {
                Some("PropertyNotLoaded")
            }
            Self::Script(message) if message.contains("ItemNotFound") => Some("ItemNotFound"),
            _ => None,
        }
    }
}
