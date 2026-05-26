use bridge_types::BridgeError;

/// Bridge-compatible error type for xlsx-parser.
/// Wraps String because parse_xlsx_full_native returns Result<T, String>.
#[derive(Debug)]
pub struct XlsxBridgeError(String);

impl std::fmt::Display for XlsxBridgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl BridgeError for XlsxBridgeError {}

impl From<String> for XlsxBridgeError {
    fn from(s: String) -> Self {
        Self(s)
    }
}
