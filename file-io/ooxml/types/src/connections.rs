//! Connection and external data types (ECMA-376 Part 1, §18.13 — External Data Connections).

// =============================================================================
// CredMethod
// =============================================================================

/// Credential method for external data connections (ECMA-376 ST_CredMethod, §18.18.16).
///
/// Determines how credentials are supplied when connecting to an external data source.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum CredMethod {
    /// Use integrated (Windows) authentication.
    #[default]
    Integrated,
    /// No credentials.
    None,
    /// Prompt the user for credentials.
    Prompt,
    /// Use stored credentials.
    Stored,
}

impl CredMethod {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "none" => Self::None,
            "prompt" => Self::Prompt,
            "stored" => Self::Stored,
            _ => Self::Integrated,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Integrated => "integrated",
            Self::None => "none",
            Self::Prompt => "prompt",
            Self::Stored => "stored",
        }
    }
}

// =============================================================================
// ExternalConnectionType
// =============================================================================

/// Field data type for text import (ECMA-376 ST_ExternalConnectionType).
///
/// Specifies how a field's data should be interpreted during text file import.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum ExternalConnectionType {
    /// General format (default).
    #[default]
    General,
    /// Text format.
    Text,
    /// Month-Day-Year date format.
    Mdy,
    /// Day-Month-Year date format.
    Dmy,
    /// Year-Month-Day date format.
    Ymd,
    /// Month-Year-Day date format.
    Myd,
    /// Day-Year-Month date format.
    Dym,
    /// Year-Day-Month date format.
    Ydm,
    /// Skip this field.
    Skip,
    /// EMD date format (Eastern Mediterranean Day).
    Emd,
}

impl ExternalConnectionType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "text" => Self::Text,
            "MDY" => Self::Mdy,
            "DMY" => Self::Dmy,
            "YMD" => Self::Ymd,
            "MYD" => Self::Myd,
            "DYM" => Self::Dym,
            "YDM" => Self::Ydm,
            "skip" => Self::Skip,
            "EMD" => Self::Emd,
            _ => Self::General,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::General => "general",
            Self::Text => "text",
            Self::Mdy => "MDY",
            Self::Dmy => "DMY",
            Self::Ymd => "YMD",
            Self::Myd => "MYD",
            Self::Dym => "DYM",
            Self::Ydm => "YDM",
            Self::Skip => "skip",
            Self::Emd => "EMD",
        }
    }
}

// =============================================================================
// FileType
// =============================================================================

/// File type for text import (ECMA-376 ST_FileType, §18.18.29).
///
/// Specifies the platform file type for a text import data source.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum FileType {
    /// Macintosh file type.
    Mac,
    /// Windows file type (default).
    #[default]
    Win,
    /// DOS file type.
    Dos,
    /// Linux file type.
    Lin,
    /// Other file type.
    Other,
}

impl FileType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "mac" => Self::Mac,
            "dos" => Self::Dos,
            "lin" => Self::Lin,
            "other" => Self::Other,
            _ => Self::Win,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Mac => "mac",
            Self::Win => "win",
            Self::Dos => "dos",
            Self::Lin => "lin",
            Self::Other => "other",
        }
    }
}

// =============================================================================
// GrowShrinkType
// =============================================================================

/// Grow/shrink behavior for query tables (ECMA-376 ST_GrowShrinkType, §18.18.35).
///
/// Determines how the destination range adjusts when refreshed data changes size.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum GrowShrinkType {
    /// Insert or delete rows/columns to accommodate data.
    #[default]
    InsertDelete,
    /// Insert rows/columns for growth; clear cells for shrinkage.
    InsertClear,
    /// Overwrite existing data; clear cells for shrinkage.
    OverwriteClear,
}

impl GrowShrinkType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "insertClear" => Self::InsertClear,
            "overwriteClear" => Self::OverwriteClear,
            _ => Self::InsertDelete,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::InsertDelete => "insertDelete",
            Self::InsertClear => "insertClear",
            Self::OverwriteClear => "overwriteClear",
        }
    }
}

// =============================================================================
// HtmlFmt
// =============================================================================

/// HTML formatting mode for web queries (ECMA-376 ST_HtmlFmt, §18.18.37).
///
/// Controls how much HTML formatting is preserved when importing web data.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum HtmlFmt {
    /// No HTML formatting.
    #[default]
    None,
    /// Rich text formatting only.
    Rtf,
    /// All HTML formatting.
    All,
}

impl HtmlFmt {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "rtf" => Self::Rtf,
            "all" => Self::All,
            _ => Self::None,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Rtf => "rtf",
            Self::All => "all",
        }
    }
}

// =============================================================================
// ParameterType
// =============================================================================

/// Parameter type for query parameters (ECMA-376 ST_ParameterType, §18.18.56).
///
/// Specifies how a query parameter value is obtained.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum ParameterType {
    /// Prompt the user for the parameter value.
    #[default]
    Prompt,
    /// Use a fixed value.
    Value,
    /// Read the value from a cell reference.
    Cell,
}

impl ParameterType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "value" => Self::Value,
            "cell" => Self::Cell,
            _ => Self::Prompt,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Prompt => "prompt",
            Self::Value => "value",
            Self::Cell => "cell",
        }
    }
}

// =============================================================================
// Qualifier
// =============================================================================

/// Text qualifier for delimited text import (ECMA-376 ST_Qualifier, §18.18.64).
///
/// Specifies the character used to enclose text fields in a delimited text file.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum Qualifier {
    /// Double quote (`"`).
    #[default]
    DoubleQuote,
    /// Single quote (`'`).
    SingleQuote,
    /// No text qualifier.
    None,
}

impl Qualifier {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "singleQuote" => Self::SingleQuote,
            "none" => Self::None,
            _ => Self::DoubleQuote,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::DoubleQuote => "doubleQuote",
            Self::SingleQuote => "singleQuote",
            Self::None => "none",
        }
    }
}

// =============================================================================
// TextField
// =============================================================================

/// A single text field definition for text import (ECMA-376 CT_TextField).
///
/// Defines the data type and position of a field within a delimited or
/// fixed-width text file.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TextField {
    /// Data type for this field. Default: `General`.
    pub field_type: ExternalConnectionType,
    /// Position (column index) for fixed-width fields.
    pub position: Option<u32>,
}

// =============================================================================
// TextFields
// =============================================================================

/// Collection of text field definitions (ECMA-376 CT_TextFields).
///
/// Container for `TextField` elements used during text file import.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TextFields {
    /// The text field definitions.
    pub fields: Vec<TextField>,
    /// Optional count attribute.
    pub count: Option<u32>,
}

// =============================================================================
// TextPr
// =============================================================================

/// Text import properties (ECMA-376 CT_TextPr, §18.13.6).
///
/// Defines all settings for importing data from a delimited or fixed-width
/// text file into a spreadsheet.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TextPr {
    /// Whether to prompt the user before refreshing. Default: `true`.
    pub prompt: bool,
    /// File type of the text source. Default: `Win`.
    pub file_type: FileType,
    /// Code page for character encoding. Default: `1252`.
    pub code_page: Option<u32>,
    /// First row of data to import. Default: `1`.
    pub first_row: Option<u32>,
    /// Path to the source text file.
    pub source_file: Option<String>,
    /// Whether the file is delimited (true) or fixed-width (false). Default: `true`.
    pub delimited: bool,
    /// Decimal separator character. Default: `"."`.
    pub decimal: Option<String>,
    /// Thousands separator character. Default: `","`.
    pub thousands: Option<String>,
    /// Use tab as a delimiter. Default: `true`.
    pub tab: bool,
    /// Use space as a delimiter. Default: `false`.
    pub space: bool,
    /// Use comma as a delimiter. Default: `false`.
    pub comma: bool,
    /// Use semicolon as a delimiter. Default: `false`.
    pub semicolon: bool,
    /// Treat consecutive delimiters as one. Default: `false`.
    pub consecutive: bool,
    /// Text qualifier character. Default: `DoubleQuote`.
    pub qualifier: Qualifier,
    /// Custom delimiter character.
    pub delimiter: Option<String>,
    /// Field definitions for the text import.
    pub text_fields: Option<TextFields>,
}

impl Default for TextPr {
    fn default() -> Self {
        Self {
            prompt: true,
            file_type: FileType::Win,
            code_page: Some(1252),
            first_row: Some(1),
            source_file: None,
            delimited: true,
            decimal: Some(".".to_string()),
            thousands: Some(",".to_string()),
            tab: true,
            space: false,
            comma: false,
            semicolon: false,
            consecutive: false,
            qualifier: Qualifier::DoubleQuote,
            delimiter: None,
            text_fields: None,
        }
    }
}

// =============================================================================
// WebPr
// =============================================================================

/// Web query properties (ECMA-376 CT_WebPr, §18.13.9).
///
/// Defines settings for importing data from a web page into a spreadsheet.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WebPr {
    /// Whether the source is XML. Default: `false`.
    pub xml: bool,
    /// Whether to import source data. Default: `false`.
    pub source_data: bool,
    /// Whether to parse PRE blocks. Default: `false`.
    pub parse_pre: bool,
    /// Whether to treat consecutive delimiters as one. Default: `false`.
    pub consecutive: bool,
    /// Whether to use the first row as headers. Default: `false`.
    pub first_row: bool,
    /// Whether to use Excel 97 compatibility mode. Default: `false`.
    pub xl97: bool,
    /// Whether to import dates as text. Default: `false`.
    pub text_dates: bool,
    /// Whether to use Excel 2000 compatibility mode. Default: `false`.
    pub xl2000: bool,
    /// URL of the web page to query.
    pub url: Option<String>,
    /// POST body for the web query.
    pub post: Option<String>,
    /// URL of the edit page.
    pub edit_page: Option<String>,
    /// Whether to import HTML tables. Default: `false`.
    pub html_tables: bool,
    /// HTML formatting mode. Default: `None`.
    pub html_fmt: HtmlFmt,
    /// Tables associated with this web query (CT_Tables).
    pub tables: Option<ConnectionTables>,
}

// =============================================================================
// ConnectionTableMissing
// =============================================================================

/// Marker for a missing table reference (ECMA-376 CT_TableMissing).
///
/// Represents a placeholder for a table that could not be found.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConnectionTableMissing;

// =============================================================================
// ConnectionTableEntry
// =============================================================================

/// A single table reference entry within a connection's table list.
///
/// Can reference a table by name, by index, or indicate a missing table.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ConnectionTableEntry {
    /// The referenced table is missing.
    Missing(ConnectionTableMissing),
    /// A table referenced by name.
    Name(String),
    /// A table referenced by zero-based index.
    Index(u32),
}

// =============================================================================
// ConnectionTables
// =============================================================================

/// Collection of table references for a connection (ECMA-376 CT_Tables).
///
/// Contains the list of tables associated with an external data connection.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ConnectionTables {
    /// The table reference entries.
    pub items: Vec<ConnectionTableEntry>,
    /// Optional count attribute.
    pub count: Option<u32>,
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // CredMethod tests
    #[test]
    fn test_cred_method_from_ooxml() {
        assert_eq!(CredMethod::from_ooxml("integrated"), CredMethod::Integrated);
        assert_eq!(CredMethod::from_ooxml("none"), CredMethod::None);
        assert_eq!(CredMethod::from_ooxml("prompt"), CredMethod::Prompt);
        assert_eq!(CredMethod::from_ooxml("stored"), CredMethod::Stored);
        // Unknown values fall back to default
        assert_eq!(CredMethod::from_ooxml("unknown"), CredMethod::Integrated);
    }

    #[test]
    fn test_cred_method_to_ooxml() {
        assert_eq!(CredMethod::Integrated.to_ooxml(), "integrated");
        assert_eq!(CredMethod::None.to_ooxml(), "none");
        assert_eq!(CredMethod::Prompt.to_ooxml(), "prompt");
        assert_eq!(CredMethod::Stored.to_ooxml(), "stored");
    }

    #[test]
    fn test_cred_method_roundtrip() {
        for val in [
            CredMethod::Integrated,
            CredMethod::None,
            CredMethod::Prompt,
            CredMethod::Stored,
        ] {
            assert_eq!(CredMethod::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_cred_method_default() {
        assert_eq!(CredMethod::default(), CredMethod::Integrated);
    }

    // ExternalConnectionType tests
    #[test]
    fn test_external_connection_type_from_ooxml() {
        assert_eq!(
            ExternalConnectionType::from_ooxml("general"),
            ExternalConnectionType::General
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("text"),
            ExternalConnectionType::Text
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("MDY"),
            ExternalConnectionType::Mdy
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("DMY"),
            ExternalConnectionType::Dmy
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("YMD"),
            ExternalConnectionType::Ymd
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("MYD"),
            ExternalConnectionType::Myd
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("DYM"),
            ExternalConnectionType::Dym
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("YDM"),
            ExternalConnectionType::Ydm
        );
        assert_eq!(
            ExternalConnectionType::from_ooxml("skip"),
            ExternalConnectionType::Skip
        );
        // Unknown values fall back to default
        assert_eq!(
            ExternalConnectionType::from_ooxml("unknown"),
            ExternalConnectionType::General
        );
    }

    #[test]
    fn test_external_connection_type_to_ooxml() {
        assert_eq!(ExternalConnectionType::General.to_ooxml(), "general");
        assert_eq!(ExternalConnectionType::Text.to_ooxml(), "text");
        assert_eq!(ExternalConnectionType::Mdy.to_ooxml(), "MDY");
        assert_eq!(ExternalConnectionType::Dmy.to_ooxml(), "DMY");
        assert_eq!(ExternalConnectionType::Ymd.to_ooxml(), "YMD");
        assert_eq!(ExternalConnectionType::Myd.to_ooxml(), "MYD");
        assert_eq!(ExternalConnectionType::Dym.to_ooxml(), "DYM");
        assert_eq!(ExternalConnectionType::Ydm.to_ooxml(), "YDM");
        assert_eq!(ExternalConnectionType::Skip.to_ooxml(), "skip");
    }

    #[test]
    fn test_external_connection_type_roundtrip() {
        for val in [
            ExternalConnectionType::General,
            ExternalConnectionType::Text,
            ExternalConnectionType::Mdy,
            ExternalConnectionType::Dmy,
            ExternalConnectionType::Ymd,
            ExternalConnectionType::Myd,
            ExternalConnectionType::Dym,
            ExternalConnectionType::Ydm,
            ExternalConnectionType::Skip,
        ] {
            assert_eq!(ExternalConnectionType::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_external_connection_type_default() {
        assert_eq!(
            ExternalConnectionType::default(),
            ExternalConnectionType::General
        );
    }

    // FileType tests
    #[test]
    fn test_file_type_from_ooxml() {
        assert_eq!(FileType::from_ooxml("mac"), FileType::Mac);
        assert_eq!(FileType::from_ooxml("win"), FileType::Win);
        assert_eq!(FileType::from_ooxml("dos"), FileType::Dos);
        assert_eq!(FileType::from_ooxml("lin"), FileType::Lin);
        assert_eq!(FileType::from_ooxml("other"), FileType::Other);
        // Unknown values fall back to default
        assert_eq!(FileType::from_ooxml("unknown"), FileType::Win);
    }

    #[test]
    fn test_file_type_to_ooxml() {
        assert_eq!(FileType::Mac.to_ooxml(), "mac");
        assert_eq!(FileType::Win.to_ooxml(), "win");
        assert_eq!(FileType::Dos.to_ooxml(), "dos");
        assert_eq!(FileType::Lin.to_ooxml(), "lin");
        assert_eq!(FileType::Other.to_ooxml(), "other");
    }

    #[test]
    fn test_file_type_roundtrip() {
        for val in [
            FileType::Mac,
            FileType::Win,
            FileType::Dos,
            FileType::Lin,
            FileType::Other,
        ] {
            assert_eq!(FileType::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_file_type_default() {
        assert_eq!(FileType::default(), FileType::Win);
    }

    // GrowShrinkType tests
    #[test]
    fn test_grow_shrink_type_from_ooxml() {
        assert_eq!(
            GrowShrinkType::from_ooxml("insertDelete"),
            GrowShrinkType::InsertDelete
        );
        assert_eq!(
            GrowShrinkType::from_ooxml("insertClear"),
            GrowShrinkType::InsertClear
        );
        assert_eq!(
            GrowShrinkType::from_ooxml("overwriteClear"),
            GrowShrinkType::OverwriteClear
        );
        // Unknown values fall back to default
        assert_eq!(
            GrowShrinkType::from_ooxml("unknown"),
            GrowShrinkType::InsertDelete
        );
    }

    #[test]
    fn test_grow_shrink_type_roundtrip() {
        for val in [
            GrowShrinkType::InsertDelete,
            GrowShrinkType::InsertClear,
            GrowShrinkType::OverwriteClear,
        ] {
            assert_eq!(GrowShrinkType::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_grow_shrink_type_default() {
        assert_eq!(GrowShrinkType::default(), GrowShrinkType::InsertDelete);
    }

    // HtmlFmt tests
    #[test]
    fn test_html_fmt_from_ooxml() {
        assert_eq!(HtmlFmt::from_ooxml("none"), HtmlFmt::None);
        assert_eq!(HtmlFmt::from_ooxml("rtf"), HtmlFmt::Rtf);
        assert_eq!(HtmlFmt::from_ooxml("all"), HtmlFmt::All);
        // Unknown values fall back to default
        assert_eq!(HtmlFmt::from_ooxml("unknown"), HtmlFmt::None);
    }

    #[test]
    fn test_html_fmt_roundtrip() {
        for val in [HtmlFmt::None, HtmlFmt::Rtf, HtmlFmt::All] {
            assert_eq!(HtmlFmt::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_html_fmt_default() {
        assert_eq!(HtmlFmt::default(), HtmlFmt::None);
    }

    // ParameterType tests
    #[test]
    fn test_parameter_type_from_ooxml() {
        assert_eq!(ParameterType::from_ooxml("prompt"), ParameterType::Prompt);
        assert_eq!(ParameterType::from_ooxml("value"), ParameterType::Value);
        assert_eq!(ParameterType::from_ooxml("cell"), ParameterType::Cell);
        // Unknown values fall back to default
        assert_eq!(ParameterType::from_ooxml("unknown"), ParameterType::Prompt);
    }

    #[test]
    fn test_parameter_type_roundtrip() {
        for val in [
            ParameterType::Prompt,
            ParameterType::Value,
            ParameterType::Cell,
        ] {
            assert_eq!(ParameterType::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_parameter_type_default() {
        assert_eq!(ParameterType::default(), ParameterType::Prompt);
    }

    // Qualifier tests
    #[test]
    fn test_qualifier_from_ooxml() {
        assert_eq!(Qualifier::from_ooxml("doubleQuote"), Qualifier::DoubleQuote);
        assert_eq!(Qualifier::from_ooxml("singleQuote"), Qualifier::SingleQuote);
        assert_eq!(Qualifier::from_ooxml("none"), Qualifier::None);
        // Unknown values fall back to default
        assert_eq!(Qualifier::from_ooxml("unknown"), Qualifier::DoubleQuote);
    }

    #[test]
    fn test_qualifier_roundtrip() {
        for val in [
            Qualifier::DoubleQuote,
            Qualifier::SingleQuote,
            Qualifier::None,
        ] {
            assert_eq!(Qualifier::from_ooxml(val.to_ooxml()), val);
        }
    }

    #[test]
    fn test_qualifier_default() {
        assert_eq!(Qualifier::default(), Qualifier::DoubleQuote);
    }

    // Struct default tests
    #[test]
    fn test_text_pr_default() {
        let tp = TextPr::default();
        assert!(tp.prompt);
        assert_eq!(tp.file_type, FileType::Win);
        assert_eq!(tp.code_page, Some(1252));
        assert_eq!(tp.first_row, Some(1));
        assert!(tp.source_file.is_none());
        assert!(tp.delimited);
        assert_eq!(tp.decimal.as_deref(), Some("."));
        assert_eq!(tp.thousands.as_deref(), Some(","));
        assert!(tp.tab);
        assert!(!tp.space);
        assert!(!tp.comma);
        assert!(!tp.semicolon);
        assert!(!tp.consecutive);
        assert_eq!(tp.qualifier, Qualifier::DoubleQuote);
        assert!(tp.delimiter.is_none());
        assert!(tp.text_fields.is_none());
    }

    #[test]
    fn test_web_pr_default() {
        let wp = WebPr::default();
        assert!(!wp.xml);
        assert!(!wp.source_data);
        assert!(!wp.parse_pre);
        assert!(!wp.consecutive);
        assert!(!wp.first_row);
        assert!(!wp.xl97);
        assert!(!wp.text_dates);
        assert!(!wp.xl2000);
        assert!(wp.url.is_none());
        assert!(wp.post.is_none());
        assert!(wp.edit_page.is_none());
        assert!(!wp.html_tables);
        assert_eq!(wp.html_fmt, HtmlFmt::None);
    }

    #[test]
    fn test_connection_tables_default() {
        let ct = ConnectionTables::default();
        assert!(ct.items.is_empty());
        assert!(ct.count.is_none());
    }

    #[test]
    fn test_connection_table_entry_variants() {
        let missing = ConnectionTableEntry::Missing(ConnectionTableMissing);
        let name = ConnectionTableEntry::Name("Sheet1".to_string());
        let index = ConnectionTableEntry::Index(42);

        // Verify Debug output works (no panic)
        let _ = format!("{missing:?}");
        let _ = format!("{name:?}");
        let _ = format!("{index:?}");
    }
}
