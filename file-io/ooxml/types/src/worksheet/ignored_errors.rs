//! Ignored error types (ECMA-376 CT_IgnoredError, CT_IgnoredErrors).

/// Single ignored error rule (CT_IgnoredError, sml.xsd §18.3.1.46).
///
/// Associates a cell range with specific error types that should be
/// suppressed (hidden from the user) in the spreadsheet UI.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct IgnoredError {
    /// Cell range(s) to which this rule applies (ST_Sqref).
    pub sqref: String,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub eval_error: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub two_digit_text_year: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub number_stored_as_text: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub formula: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub formula_range: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub unlocked_formula: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub calculated_column: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub empty_cell_reference: bool,
    #[serde(default, skip_serializing_if = "super::is_false")]
    pub list_data_validation: bool,
}

/// Container for ignored errors (CT_IgnoredErrors, sml.xsd §18.3.1.45).
///
/// Wraps all `<ignoredError>` elements within a worksheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct IgnoredErrors {
    /// Individual ignored error rules (1..unbounded).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ignored_error: Vec<IgnoredError>,
    /// Extension list for future compatibility.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_lst: Option<crate::ExtensionList>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignored_error_default() {
        let err = IgnoredError::default();
        assert!(err.sqref.is_empty());
        assert!(!err.eval_error);
        assert!(!err.number_stored_as_text);
        assert!(!err.formula);
    }

    #[test]
    fn ignored_errors_default() {
        let errors = IgnoredErrors::default();
        assert!(errors.ignored_error.is_empty());
        assert!(errors.ext_lst.is_none());
    }

    #[test]
    fn ignored_error_serde_roundtrip() {
        let err = IgnoredError {
            sqref: "A1:B2".to_string(),
            number_stored_as_text: true,
            eval_error: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&err).unwrap();
        let deserialized: IgnoredError = serde_json::from_str(&json).unwrap();
        assert_eq!(err, deserialized);
    }

    #[test]
    fn ignored_error_serde_skip_false() {
        let err = IgnoredError {
            sqref: "A1".to_string(),
            ..Default::default()
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(
            !json.contains("eval_error"),
            "false bools should be skipped: {json}"
        );
        assert!(
            !json.contains("formula"),
            "false bools should be skipped: {json}"
        );
    }

    #[test]
    fn ignored_errors_serde_skip_empty() {
        let errors = IgnoredErrors::default();
        let json = serde_json::to_string(&errors).unwrap();
        assert!(
            !json.contains("ignored_error"),
            "empty vec should be skipped: {json}"
        );
        assert!(!json.contains("ext_lst"), "None should be skipped: {json}");
    }
}
