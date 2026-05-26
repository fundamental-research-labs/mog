//! Revision tracking types (ECMA-376 Part 1, §18.11 — Revision Records).

// =============================================================================
// FormulaExpression
// =============================================================================

/// Formula expression type (ECMA-376 ST_FormulaExpression, §18.18.31).
///
/// Describes the type of formula expression in a revision record.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum FormulaExpression {
    /// A single cell reference.
    #[default]
    Ref,
    /// A reference error.
    RefError,
    /// A range/area reference.
    Area,
    /// An area reference error.
    AreaError,
    /// A computed area reference.
    ComputedArea,
}

impl FormulaExpression {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "ref" => Self::Ref,
            "refError" => Self::RefError,
            "area" => Self::Area,
            "areaError" => Self::AreaError,
            "computedArea" => Self::ComputedArea,
            _ => Self::Ref,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Ref => "ref",
            Self::RefError => "refError",
            Self::Area => "area",
            Self::AreaError => "areaError",
            Self::ComputedArea => "computedArea",
        }
    }
}

// =============================================================================
// RevisionAction
// =============================================================================

/// Revision action type (ECMA-376 ST_RevisionAction, §18.18.65).
///
/// Indicates whether a revision represents an addition or deletion.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum RevisionAction {
    /// An addition.
    #[default]
    Add,
    /// A deletion.
    Delete,
}

impl RevisionAction {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "add" => Self::Add,
            "delete" => Self::Delete,
            _ => Self::Add,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Delete => "delete",
        }
    }
}

// =============================================================================
// RwColActionType
// =============================================================================

/// Row/column action type (ECMA-376 ST_rwColActionType, §18.18.66).
///
/// Specifies the kind of row or column structural change in a revision.
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize,
)]
pub enum RwColActionType {
    /// Insert a row.
    #[default]
    InsertRow,
    /// Delete a row.
    DeleteRow,
    /// Insert a column.
    InsertCol,
    /// Delete a column.
    DeleteCol,
}

impl RwColActionType {
    /// Parse from an OOXML attribute value.
    #[must_use]
    pub fn from_ooxml(s: &str) -> Self {
        match s {
            "insertRow" => Self::InsertRow,
            "deleteRow" => Self::DeleteRow,
            "insertCol" => Self::InsertCol,
            "deleteCol" => Self::DeleteCol,
            _ => Self::InsertRow,
        }
    }

    /// Serialize to the OOXML attribute value.
    #[must_use]
    pub fn to_ooxml(&self) -> &'static str {
        match self {
            Self::InsertRow => "insertRow",
            Self::DeleteRow => "deleteRow",
            Self::InsertCol => "insertCol",
            Self::DeleteCol => "deleteCol",
        }
    }
}

// =============================================================================
// UndoInfo
// =============================================================================

/// Undo information for a revision (ECMA-376 CT_UndoInfo, §18.11.1.13).
///
/// Records the details needed to undo a specific revision action.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct UndoInfo {
    /// Zero-based index of the expression.
    pub index: u32,
    /// Formula expression type.
    pub exp: FormulaExpression,
    /// Whether this is a 3-D reference (`ref3D` attribute).
    pub ref3_d: bool,
    /// Whether this is an array formula.
    pub array: bool,
    /// Whether the value is present.
    pub v: bool,
    /// Whether number formatting is present.
    pub nf: bool,
    /// Whether cell style is present.
    pub cs: bool,
    /// Cell reference for the undo target.
    pub dr: String,
    /// Defined name, if applicable.
    pub dn: Option<String>,
    /// Cell reference.
    pub r: Option<String>,
    /// Sheet ID (`sId` attribute).
    pub sheet_id: Option<u32>,
}

// =============================================================================
// UserInfo
// =============================================================================

/// Information about a shared workbook user (child of CT_Users).
///
/// Represents a single user who has accessed the shared workbook.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct UserInfo {
    /// Globally unique identifier for the user.
    pub guid: String,
    /// Display name of the user.
    pub name: String,
    /// Numeric identifier for the user.
    pub id: u32,
    /// ISO 8601 datetime of last access.
    pub date_time: String,
}

// =============================================================================
// Users
// =============================================================================

/// Shared workbook users (ECMA-376 CT_Users, §18.11.2.2).
///
/// Container for the list of users who have accessed a shared workbook.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Users {
    /// Number of user entries.
    pub count: Option<u32>,
    /// List of user information records.
    pub user_info: Vec<UserInfo>,
}

// =============================================================================
// Unit Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_formula_expression_from_ooxml() {
        assert_eq!(FormulaExpression::from_ooxml("ref"), FormulaExpression::Ref);
        assert_eq!(
            FormulaExpression::from_ooxml("refError"),
            FormulaExpression::RefError
        );
        assert_eq!(
            FormulaExpression::from_ooxml("area"),
            FormulaExpression::Area
        );
        assert_eq!(
            FormulaExpression::from_ooxml("areaError"),
            FormulaExpression::AreaError
        );
        assert_eq!(
            FormulaExpression::from_ooxml("computedArea"),
            FormulaExpression::ComputedArea
        );
        // Unknown values fall back to default
        assert_eq!(
            FormulaExpression::from_ooxml("unknown"),
            FormulaExpression::Ref
        );
    }

    #[test]
    fn test_formula_expression_to_ooxml() {
        assert_eq!(FormulaExpression::Ref.to_ooxml(), "ref");
        assert_eq!(FormulaExpression::RefError.to_ooxml(), "refError");
        assert_eq!(FormulaExpression::Area.to_ooxml(), "area");
        assert_eq!(FormulaExpression::AreaError.to_ooxml(), "areaError");
        assert_eq!(FormulaExpression::ComputedArea.to_ooxml(), "computedArea");
    }

    #[test]
    fn test_formula_expression_roundtrip() {
        for variant in [
            FormulaExpression::Ref,
            FormulaExpression::RefError,
            FormulaExpression::Area,
            FormulaExpression::AreaError,
            FormulaExpression::ComputedArea,
        ] {
            assert_eq!(FormulaExpression::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_formula_expression_default() {
        assert_eq!(FormulaExpression::default(), FormulaExpression::Ref);
    }

    #[test]
    fn test_revision_action_from_ooxml() {
        assert_eq!(RevisionAction::from_ooxml("add"), RevisionAction::Add);
        assert_eq!(RevisionAction::from_ooxml("delete"), RevisionAction::Delete);
        assert_eq!(RevisionAction::from_ooxml("unknown"), RevisionAction::Add);
    }

    #[test]
    fn test_revision_action_to_ooxml() {
        assert_eq!(RevisionAction::Add.to_ooxml(), "add");
        assert_eq!(RevisionAction::Delete.to_ooxml(), "delete");
    }

    #[test]
    fn test_revision_action_roundtrip() {
        for variant in [RevisionAction::Add, RevisionAction::Delete] {
            assert_eq!(RevisionAction::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_revision_action_default() {
        assert_eq!(RevisionAction::default(), RevisionAction::Add);
    }

    #[test]
    fn test_rw_col_action_type_from_ooxml() {
        assert_eq!(
            RwColActionType::from_ooxml("insertRow"),
            RwColActionType::InsertRow
        );
        assert_eq!(
            RwColActionType::from_ooxml("deleteRow"),
            RwColActionType::DeleteRow
        );
        assert_eq!(
            RwColActionType::from_ooxml("insertCol"),
            RwColActionType::InsertCol
        );
        assert_eq!(
            RwColActionType::from_ooxml("deleteCol"),
            RwColActionType::DeleteCol
        );
        assert_eq!(
            RwColActionType::from_ooxml("unknown"),
            RwColActionType::InsertRow
        );
    }

    #[test]
    fn test_rw_col_action_type_to_ooxml() {
        assert_eq!(RwColActionType::InsertRow.to_ooxml(), "insertRow");
        assert_eq!(RwColActionType::DeleteRow.to_ooxml(), "deleteRow");
        assert_eq!(RwColActionType::InsertCol.to_ooxml(), "insertCol");
        assert_eq!(RwColActionType::DeleteCol.to_ooxml(), "deleteCol");
    }

    #[test]
    fn test_rw_col_action_type_roundtrip() {
        for variant in [
            RwColActionType::InsertRow,
            RwColActionType::DeleteRow,
            RwColActionType::InsertCol,
            RwColActionType::DeleteCol,
        ] {
            assert_eq!(RwColActionType::from_ooxml(variant.to_ooxml()), variant);
        }
    }

    #[test]
    fn test_rw_col_action_type_default() {
        assert_eq!(RwColActionType::default(), RwColActionType::InsertRow);
    }

    #[test]
    fn test_undo_info_default() {
        let info = UndoInfo::default();
        assert_eq!(info.index, 0);
        assert_eq!(info.exp, FormulaExpression::Ref);
        assert!(!info.ref3_d);
        assert!(!info.array);
        assert!(!info.v);
        assert!(!info.nf);
        assert!(!info.cs);
        assert_eq!(info.dr, "");
        assert!(info.dn.is_none());
        assert!(info.r.is_none());
        assert!(info.sheet_id.is_none());
    }

    #[test]
    fn test_undo_info_serde_roundtrip() {
        let original = UndoInfo {
            index: 3,
            exp: FormulaExpression::Area,
            ref3_d: true,
            dr: "A1:B2".to_string(),
            sheet_id: Some(1),
            ..UndoInfo::default()
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: UndoInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }

    #[test]
    fn test_users_default() {
        let users = Users::default();
        assert!(users.count.is_none());
        assert!(users.user_info.is_empty());
    }

    #[test]
    fn test_users_serde_roundtrip() {
        let original = Users {
            count: Some(1),
            user_info: vec![UserInfo {
                guid: "{12345678-1234-1234-1234-123456789012}".to_string(),
                name: "Test User".to_string(),
                id: 1,
                date_time: "2024-01-15T10:30:00Z".to_string(),
            }],
        };
        let json = serde_json::to_string(&original).unwrap();
        let deserialized: Users = serde_json::from_str(&json).unwrap();
        assert_eq!(original, deserialized);
    }
}
