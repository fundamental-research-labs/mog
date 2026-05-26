//! External link, DDE link, OLE link, connection, and data consolidation types
//! (ECMA-376 Part 1, Sections 18.14, 18.15 — SpreadsheetML External Links & Connections).
//!
//! Types modelling the contents of `xl/externalLinks/externalLinkN.xml` and
//! `xl/connections.xml`: external workbook references, DDE/OLE links,
//! data connections, and data consolidation references.

// ============================================================================
// DdeValueType — ST_DdeValueType
// ============================================================================

/// DDE value type (ST_DdeValueType).
///
/// Specifies the type of a DDE value.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum DdeValueType {
    /// Nil — no value.
    #[xml("nil")]
    Nil,
    /// Boolean value.
    #[xml("b")]
    Boolean,
    /// Numeric value (default).
    #[default]
    #[xml("n")]
    Number,
    /// Error value.
    #[xml("e")]
    Error,
    /// String value.
    #[xml("str")]
    String,
}

// ============================================================================
// ConnectionCredentials — ST_CredMethod
// ============================================================================

/// Connection credential method (ST_CredMethod).
///
/// Specifies how credentials are supplied for a data connection.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Default,
    serde::Serialize,
    serde::Deserialize,
    xml_derive::XmlEnum,
)]
pub enum ConnectionCredentials {
    /// Use Windows integrated authentication (default).
    #[default]
    #[xml("integrated")]
    Integrated,
    /// No credentials.
    #[xml("none")]
    None,
    /// Use stored credentials.
    #[xml("stored")]
    Stored,
    /// Prompt the user for credentials.
    #[xml("prompt")]
    Prompt,
}

// ============================================================================
// ExternalLink — CT_ExternalLink
// ============================================================================

/// Root element of an external link part (CT_ExternalLink).
///
/// Each `xl/externalLinks/externalLinkN.xml` contains exactly one of these.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ExternalLink {
    /// The content of the external link — one of several link types.
    pub content: Option<ExternalLinkContent>,
}

/// Choice group for the content of an external link (CT_ExternalLink choice).
///
/// An external link is exactly one of: an external book reference, a DDE link,
/// an OLE link, or an extension list.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ExternalLinkContent {
    /// Reference to an external workbook.
    Book(ExternalBook),
    /// DDE (Dynamic Data Exchange) link.
    Dde(DdeLink),
    /// OLE (Object Linking and Embedding) link.
    Ole(OleLink),
    /// Extension list for forward-compatible round-tripping.
    Extension(crate::ExtensionList),
}

// ============================================================================
// ExternalBook — CT_ExternalBook
// ============================================================================

/// Reference to an external workbook (CT_ExternalBook).
///
/// Caches sheet names, defined names, and cell data from the external source.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ExternalBook {
    /// Relationship ID pointing to the external workbook file.
    pub r_id: String,
    /// Cached sheet names from the external workbook.
    pub sheet_names: Vec<ExternalSheetName>,
    /// Cached defined names from the external workbook.
    pub defined_names: Vec<ExternalDefinedName>,
    /// Cached cell data from the external workbook.
    pub sheet_data_set: Vec<ExternalSheetData>,
}

// ============================================================================
// ExternalSheetName — CT_ExternalSheetName
// ============================================================================

/// A sheet name from an external workbook (CT_ExternalSheetName).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ExternalSheetName {
    /// The sheet name value.
    pub val: Option<String>,
}

// ============================================================================
// ExternalDefinedName — CT_ExternalDefinedName
// ============================================================================

/// A defined name from an external workbook (CT_ExternalDefinedName).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ExternalDefinedName {
    /// The defined name (required).
    pub name: String,
    /// The formula or cell reference this name refers to.
    pub ref_refers_to: Option<String>,
    /// Sheet index scope (if scoped to a specific sheet).
    pub sheet_id: Option<u32>,
}

// ============================================================================
// ExternalSheetData — CT_ExternalSheetData
// ============================================================================

/// Cached cell data for one sheet in an external workbook (CT_ExternalSheetData).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ExternalSheetData {
    /// Zero-based sheet index in the external workbook.
    pub sheet_id: u32,
    /// Whether an error occurred refreshing this sheet's data. Default: `false`.
    pub refresh_error: bool,
    /// Cached row data.
    pub rows: Vec<ExternalRow>,
}

// ============================================================================
// ExternalRow — CT_ExternalRow
// ============================================================================

/// A cached row from an external workbook sheet (CT_ExternalRow).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct ExternalRow {
    /// Row number (1-based).
    pub r: u32,
    /// Cached cell values in this row.
    pub cells: Vec<ExternalCell>,
}

// ============================================================================
// ExternalCell — CT_ExternalCell
// ============================================================================

/// A cached cell value from an external workbook (CT_ExternalCell).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ExternalCell {
    /// Cell reference (e.g. "A1").
    pub r: Option<String>,
    /// Cell value type.
    pub t: crate::worksheet::CellType,
    /// Value metadata index.
    pub vm: Option<u32>,
    /// The cached cell value as a string.
    pub v: Option<String>,
}

impl Default for ExternalCell {
    fn default() -> Self {
        Self {
            r: None,
            t: crate::worksheet::CellType::Number,
            vm: None,
            v: None,
        }
    }
}

// ============================================================================
// OleLink — CT_OleLink (simplified)
// ============================================================================

/// OLE link to an external object (CT_OleLink, simplified).
///
/// Contains a relationship ID to the linked OLE object.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct OleLink {
    /// Relationship ID to the OLE object.
    pub r_id: String,
    /// Program identifier for the OLE server (required, e.g. "Excel.Sheet").
    #[serde(rename = "progId")]
    pub prog_id: String,
    /// OLE items.
    pub items: Option<crate::ExtensionList>,
}

// ============================================================================
// DdeLink — CT_DdeLink
// ============================================================================

/// DDE (Dynamic Data Exchange) link (CT_DdeLink).
///
/// Represents a link to an external application via DDE protocol.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DdeLink {
    /// DDE service name (e.g. application name).
    pub dde_service: String,
    /// DDE topic (e.g. file name).
    pub dde_topic: String,
    /// DDE items (named data channels).
    pub items: Vec<DdeItem>,
}

// ============================================================================
// DdeItem — CT_DdeItem
// ============================================================================

/// A single DDE item (named data channel) (CT_DdeItem).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DdeItem {
    /// Item name (default "0").
    pub name: Option<String>,
    /// Whether this is an OLE link.
    pub ole: bool,
    /// Whether to advise (notify on change).
    pub advise: bool,
    /// Whether to prefer picture format.
    pub prefer_pic: bool,
    /// DDE values for this item.
    pub values: Vec<DdeValue>,
}

// ============================================================================
// DdeValues — CT_DdeValues
// ============================================================================

/// Collection of DDE values with optional row/column dimensions (CT_DdeValues).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DdeValues {
    /// Number of rows of DDE data.
    pub rows: Option<u32>,
    /// Number of columns of DDE data.
    pub cols: Option<u32>,
    /// The DDE value items.
    pub items: Vec<DdeValue>,
}

// ============================================================================
// DdeValue — CT_DdeValue
// ============================================================================

/// A single DDE value (CT_DdeValue).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DdeValue {
    /// The value type.
    pub t: DdeValueType,
    /// The value text content.
    pub val: String,
}

impl Default for DdeValue {
    fn default() -> Self {
        Self {
            t: DdeValueType::Number,
            val: String::new(),
        }
    }
}

// ============================================================================
// Connections — CT_Connections
// ============================================================================

/// Collection of data connections (CT_Connections).
///
/// Root element of `xl/connections.xml`.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct Connections {
    /// The data connections.
    pub items: Vec<Connection>,
}

// ============================================================================
// Connection — CT_Connection
// ============================================================================

/// A data connection definition (CT_Connection).
///
/// Describes a connection to an external data source (database, web query,
/// text file, etc.).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Connection {
    /// Connection ID (required).
    pub id: u32,
    /// Path to a connection file.
    pub source_file: Option<String>,
    /// Path to an ODBC file DSN.
    pub odbc_file: Option<String>,
    /// Keep the connection open after refresh.
    pub keep_alive: bool,
    /// Auto-refresh interval in minutes (0 = no auto-refresh).
    pub interval: Option<u32>,
    /// Connection name.
    pub name: Option<String>,
    /// Connection description.
    pub description: Option<String>,
    /// Connection type code.
    pub r#type: Option<u32>,
    /// Reconnection method (1 = required, 2 = always, 3 = never).
    pub reconnection_method: u32,
    /// Refresh the connection on file open.
    pub refresh_on_load: bool,
    /// Save cached data with the connection.
    pub save_data: bool,
    /// Credential method for authentication.
    pub credentials: ConnectionCredentials,
    /// Single sign-on ID.
    pub single_sign_on_id: Option<String>,
    /// Whether to save the password with the connection.
    pub save_password: bool,
    /// Minimum time between refreshes in minutes.
    pub min_refresh_period: Option<u32>,
    /// Refresh in the background.
    pub background: bool,
    /// Version of the application that last refreshed.
    pub refreshed_version: Option<u8>,
    /// Minimum version required to refresh.
    pub min_refreshed_version: Option<u8>,
    /// Whether new data was retrieved on last refresh.
    pub new_data: bool,
    /// Whether the connection has been deleted.
    pub deleted: bool,
    /// Only use the connection file (ignore embedded connection string).
    pub only_use_conn_file: bool,
    /// Database connection properties.
    pub db_pr: Option<DbPr>,
    /// OLAP connection properties.
    pub olap_pr: Option<crate::ExtensionList>,
    /// Web query properties.
    pub web_pr: Option<crate::ExtensionList>,
    /// Text file import properties.
    pub text_pr: Option<crate::ExtensionList>,
    /// Query parameters.
    pub parameters: Option<crate::ExtensionList>,
    /// Extension list.
    pub ext_lst: Option<crate::ExtensionList>,
}

impl Default for Connection {
    fn default() -> Self {
        Self {
            id: 0,
            source_file: None,
            odbc_file: None,
            keep_alive: false,
            interval: None,
            name: None,
            description: None,
            r#type: None,
            reconnection_method: 1,
            refresh_on_load: false,
            save_data: false,
            credentials: ConnectionCredentials::Integrated,
            single_sign_on_id: None,
            save_password: false,
            min_refresh_period: None,
            background: false,
            refreshed_version: None,
            min_refreshed_version: None,
            new_data: false,
            deleted: false,
            only_use_conn_file: false,
            db_pr: None,
            olap_pr: None,
            web_pr: None,
            text_pr: None,
            parameters: None,
            ext_lst: None,
        }
    }
}

// ============================================================================
// DbPr — CT_DbPr
// ============================================================================

/// Database connection properties (CT_DbPr).
///
/// Contains the connection string and optional SQL command for a database
/// data connection.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DbPr {
    /// The database connection string (required).
    pub connection: String,
    /// SQL command text.
    pub command: Option<String>,
    /// Server-side command text.
    pub server_command: Option<String>,
    /// Command type (default 2 = SQL).
    pub command_type: Option<u32>,
}

// ============================================================================
// DataBinding — CT_DataBinding
// ============================================================================

/// XML data binding properties (CT_DataBinding).
///
/// Describes how XML data maps to cells in the workbook.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DataBinding {
    /// Name of the data binding.
    pub data_binding_name: Option<String>,
    /// Whether this is a file-based binding.
    pub file_binding: Option<bool>,
    /// Associated connection ID.
    pub connection_id: Option<u32>,
    /// Name of the file binding source.
    pub file_binding_name: Option<String>,
    /// Data binding load mode (required).
    pub data_binding_load_mode: u32,
}

// ============================================================================
// DataConsolidate — CT_DataConsolidate
// ============================================================================

/// Data consolidation settings (CT_DataConsolidate).
///
/// Defines how data from multiple ranges is consolidated.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DataConsolidate {
    /// Consolidation function name (e.g. "sum", "count", "average").
    pub function: Option<String>,
    /// Use labels in the first column of source data.
    pub start_labels: bool,
    /// Use labels in the first row of source data.
    pub top_labels: bool,
    /// Create links to source data.
    pub link: bool,
    /// Source data references.
    pub data_refs: Vec<DataRef>,
}

// ============================================================================
// DataRef — CT_DataRef
// ============================================================================

/// A reference to source data for consolidation (CT_DataRef).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Default)]
pub struct DataRef {
    /// Cell reference range.
    pub r#ref: Option<String>,
    /// Defined name reference.
    pub name: Option<String>,
    /// Sheet name.
    pub sheet: Option<String>,
    /// Relationship ID to external source.
    pub r_id: Option<String>,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // -- Default value tests --------------------------------------------------

    #[test]
    fn external_link_default() {
        let link = ExternalLink::default();
        assert_eq!(link.content, None);
    }

    #[test]
    fn external_book_default() {
        let book = ExternalBook::default();
        assert_eq!(book.r_id, "");
        assert!(book.sheet_names.is_empty());
        assert!(book.defined_names.is_empty());
        assert!(book.sheet_data_set.is_empty());
    }

    #[test]
    fn external_cell_default() {
        let cell = ExternalCell::default();
        assert_eq!(cell.t, crate::worksheet::CellType::Number);
        assert_eq!(cell.r, None);
        assert_eq!(cell.vm, None);
        assert_eq!(cell.v, None);
    }

    #[test]
    fn dde_link_default() {
        let link = DdeLink::default();
        assert_eq!(link.dde_service, "");
        assert_eq!(link.dde_topic, "");
        assert!(link.items.is_empty());
    }

    #[test]
    fn dde_item_default() {
        let item = DdeItem::default();
        assert_eq!(item.name, None);
        assert!(!item.ole);
        assert!(!item.advise);
        assert!(!item.prefer_pic);
        assert!(item.values.is_empty());
    }

    #[test]
    fn dde_value_default() {
        let val = DdeValue::default();
        assert_eq!(val.t, DdeValueType::Number);
        assert_eq!(val.val, "");
    }

    #[test]
    fn dde_values_default() {
        let vals = DdeValues::default();
        assert_eq!(vals.rows, None);
        assert_eq!(vals.cols, None);
        assert!(vals.items.is_empty());
    }

    #[test]
    fn connection_default() {
        let conn = Connection::default();
        assert_eq!(conn.id, 0);
        assert!(!conn.keep_alive);
        assert_eq!(conn.reconnection_method, 1);
        assert!(!conn.refresh_on_load);
        assert!(!conn.save_data);
        assert_eq!(conn.credentials, ConnectionCredentials::Integrated);
        assert!(!conn.save_password);
        assert!(!conn.background);
        assert!(!conn.new_data);
        assert!(!conn.deleted);
        assert!(!conn.only_use_conn_file);
        assert!(conn.db_pr.is_none());
    }

    #[test]
    fn db_pr_default() {
        let pr = DbPr::default();
        assert_eq!(pr.connection, "");
        assert_eq!(pr.command, None);
        assert_eq!(pr.command_type, None);
    }

    #[test]
    fn data_consolidate_default() {
        let dc = DataConsolidate::default();
        assert_eq!(dc.function, None);
        assert!(!dc.start_labels);
        assert!(!dc.top_labels);
        assert!(!dc.link);
        assert!(dc.data_refs.is_empty());
    }

    #[test]
    fn data_ref_default() {
        let dr = DataRef::default();
        assert_eq!(dr.r#ref, None);
        assert_eq!(dr.name, None);
        assert_eq!(dr.sheet, None);
        assert_eq!(dr.r_id, None);
    }

    #[test]
    fn data_binding_default() {
        let db = DataBinding::default();
        assert_eq!(db.data_binding_load_mode, 0);
        assert_eq!(db.file_binding, None);
        assert_eq!(db.connection_id, None);
    }

    // -- Enum roundtrip tests -------------------------------------------------

    #[test]
    fn dde_value_type_roundtrip() {
        let variants = [
            (DdeValueType::Nil, "nil"),
            (DdeValueType::Boolean, "b"),
            (DdeValueType::Number, "n"),
            (DdeValueType::Error, "e"),
            (DdeValueType::String, "str"),
        ];
        for (variant, ooxml) in &variants {
            assert_eq!(variant.to_ooxml(), *ooxml);
            assert_eq!(DdeValueType::from_ooxml(ooxml), *variant);
            assert_eq!(DdeValueType::from_bytes(ooxml.as_bytes()), *variant);
            assert_eq!(variant.as_str(), *ooxml);
        }
    }

    #[test]
    fn dde_value_type_default() {
        assert_eq!(DdeValueType::default(), DdeValueType::Number);
    }

    #[test]
    fn dde_value_type_unknown_fallback() {
        assert_eq!(DdeValueType::from_ooxml("unknown"), DdeValueType::Number);
        assert_eq!(DdeValueType::from_bytes(b"unknown"), DdeValueType::Number);
    }

    #[test]
    fn connection_credentials_roundtrip() {
        let variants = [
            (ConnectionCredentials::Integrated, "integrated"),
            (ConnectionCredentials::None, "none"),
            (ConnectionCredentials::Stored, "stored"),
            (ConnectionCredentials::Prompt, "prompt"),
        ];
        for (variant, ooxml) in &variants {
            assert_eq!(variant.to_ooxml(), *ooxml);
            assert_eq!(ConnectionCredentials::from_ooxml(ooxml), *variant);
            assert_eq!(
                ConnectionCredentials::from_bytes(ooxml.as_bytes()),
                *variant
            );
            assert_eq!(variant.as_str(), *ooxml);
        }
    }

    #[test]
    fn connection_credentials_default() {
        assert_eq!(
            ConnectionCredentials::default(),
            ConnectionCredentials::Integrated
        );
    }

    #[test]
    fn connection_credentials_unknown_fallback() {
        assert_eq!(
            ConnectionCredentials::from_ooxml("unknown"),
            ConnectionCredentials::Integrated
        );
        assert_eq!(
            ConnectionCredentials::from_bytes(b"unknown"),
            ConnectionCredentials::Integrated
        );
    }
}
