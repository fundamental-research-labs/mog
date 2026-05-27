use super::*;

/// Serializable parse error
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullParseError {
    /// Error code
    pub code: u32,
    /// Severity: "warning", "error", "fatal"
    pub severity: String,
    /// Error message
    pub message: String,
    /// Part/file where error occurred
    pub part: Option<String>,
    /// Row if applicable
    pub row: Option<u32>,
    /// Column if applicable
    pub col: Option<u32>,
}

impl From<&ParseErrorDetail> for FullParseError {
    fn from(e: &ParseErrorDetail) -> Self {
        Self {
            code: e.code.code(),
            severity: e.severity.to_string(),
            message: e.message.clone(),
            part: e.location.as_ref().map(|l| l.part.clone()),
            row: e.location.as_ref().and_then(|l| l.row),
            col: e.location.as_ref().and_then(|l| l.col),
        }
    }
}
