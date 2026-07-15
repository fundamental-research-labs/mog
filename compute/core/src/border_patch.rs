//! Wire contract for an ordered, atomic spreadsheet border command.

use domain_types::CellBorders;

/// Persisted member of the ECMA-376 border composite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BorderPatchField {
    Top,
    Right,
    Bottom,
    Left,
    Diagonal,
    DiagonalUp,
    DiagonalDown,
    Vertical,
    Horizontal,
    Outline,
}

impl BorderPatchField {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Top => "top",
            Self::Right => "right",
            Self::Bottom => "bottom",
            Self::Left => "left",
            Self::Diagonal => "diagonal",
            Self::DiagonalUp => "diagonalUp",
            Self::DiagonalDown => "diagonalDown",
            Self::Vertical => "vertical",
            Self::Horizontal => "horizontal",
            Self::Outline => "outline",
        }
    }

    pub(crate) fn is_present_in(self, borders: &CellBorders) -> bool {
        match self {
            Self::Top => borders.top.is_some(),
            Self::Right => borders.right.is_some(),
            Self::Bottom => borders.bottom.is_some(),
            Self::Left => borders.left.is_some(),
            Self::Diagonal => borders.diagonal.is_some(),
            Self::DiagonalUp => borders.diagonal_up.is_some(),
            Self::DiagonalDown => borders.diagonal_down.is_some(),
            Self::Vertical => borders.vertical.is_some(),
            Self::Horizontal => borders.horizontal.is_some(),
            Self::Outline => borders.outline.is_some(),
        }
    }
}

/// Storage target for one nested border patch operation.
///
/// Cell ranges mutate direct cell formats. Row and column targets mutate their
/// respective inherited format layers without materializing every cell.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BorderPatchTarget {
    Cells {
        start_row: u32,
        start_col: u32,
        end_row: u32,
        end_col: u32,
    },
    Row {
        row: u32,
    },
    Column {
        col: u32,
    },
}

/// One nested border patch within an atomic spreadsheet border command.
///
/// `borders` supplies complete edge/flag values. `clear_fields` removes direct
/// edge/flag overrides. Omitted members remain unchanged.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BorderPatchOperation {
    pub target: BorderPatchTarget,
    pub borders: CellBorders,
    pub clear_fields: Vec<BorderPatchField>,
}

impl BorderPatchOperation {
    pub(crate) fn is_noop(&self) -> bool {
        self.borders == CellBorders::default() && self.clear_fields.is_empty()
    }

    pub(crate) fn conflicting_field(&self) -> Option<BorderPatchField> {
        self.clear_fields
            .iter()
            .copied()
            .find(|field| field.is_present_in(&self.borders))
    }
}

#[cfg(test)]
mod tests {
    use super::{BorderPatchField, BorderPatchTarget};

    #[test]
    fn border_patch_fields_have_a_closed_camel_case_wire_vocabulary() {
        let fields = [
            BorderPatchField::Top,
            BorderPatchField::Right,
            BorderPatchField::Bottom,
            BorderPatchField::Left,
            BorderPatchField::Diagonal,
            BorderPatchField::DiagonalUp,
            BorderPatchField::DiagonalDown,
            BorderPatchField::Vertical,
            BorderPatchField::Horizontal,
            BorderPatchField::Outline,
        ];

        for field in fields {
            assert_eq!(
                serde_json::to_string(&field).unwrap(),
                format!("\"{}\"", field.as_str())
            );
        }
        assert!(serde_json::from_str::<BorderPatchField>("\"unsupportedEdge\"").is_err());
    }

    #[test]
    fn cell_target_round_trips_with_camel_case_fields() {
        let target = BorderPatchTarget::Cells {
            start_row: 1,
            start_col: 2,
            end_row: 3,
            end_col: 4,
        };
        let json = serde_json::to_value(&target).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "kind": "cells",
                "startRow": 1,
                "startCol": 2,
                "endRow": 3,
                "endCol": 4,
            })
        );
        assert!(serde_json::from_value::<BorderPatchTarget>(json).is_ok());
    }
}
