use super::super::{ExternalLinkBinder, to_identity_formula_with_external_binder};
use super::fixtures::MockResolver;
use crate::parser::{ParseError, ParseErrorKind};
use formula_types::{ExternalSheetKey, ExternalWorkbookToken, IdentityFormulaRef, LinkId};

struct FixedBinder {
    link_id: LinkId,
}

impl ExternalLinkBinder for FixedBinder {
    fn bind_external_workbook(
        &self,
        _workbook: &ExternalWorkbookToken,
    ) -> Result<LinkId, ParseError> {
        Ok(self.link_id)
    }
}

struct ErrorBinder;

impl ExternalLinkBinder for ErrorBinder {
    fn bind_external_workbook(
        &self,
        _workbook: &ExternalWorkbookToken,
    ) -> Result<LinkId, ParseError> {
        Err(ParseError::new(
            ParseErrorKind::InvalidReference,
            crate::Span::empty(),
        ))
    }
}

#[test]
fn external_ref_requires_binder() {
    let r = MockResolver::new();
    let err = to_identity_formula_with_external_binder("=[1]Sheet1!A1", &r, None).unwrap_err();

    assert_eq!(err.kind, ParseErrorKind::InvalidReference);
}

#[test]
fn external_binder_error_propagates() {
    let r = MockResolver::new();
    let binder = ErrorBinder;
    let err =
        to_identity_formula_with_external_binder("=[1]Sheet1!A1", &r, Some(&binder)).unwrap_err();

    assert_eq!(err.kind, ParseErrorKind::InvalidReference);
}

#[test]
fn external_cell_uses_bound_link_sheet_and_one_based_address() {
    let r = MockResolver::new();
    let binder = FixedBinder {
        link_id: LinkId::from_raw(7),
    };
    let f = to_identity_formula_with_external_binder("=[1]Sheet1!$A$1", &r, Some(&binder)).unwrap();

    assert_eq!(f.template, "{0}");
    match &f.refs[0] {
        IdentityFormulaRef::ExternalCell(cell) => {
            assert_eq!(cell.link_id, binder.link_id);
            assert_eq!(
                cell.sheet,
                ExternalSheetKey::Name {
                    name: "Sheet1".to_string(),
                }
            );
            assert_eq!(cell.address.row, 1);
            assert_eq!(cell.address.col, 1);
            assert!(cell.abs.row_abs);
            assert!(cell.abs.col_abs);
        }
        other => panic!("expected external cell, got {other:?}"),
    }
}

#[test]
fn external_range_uses_bound_link_and_one_based_address() {
    let r = MockResolver::new();
    let binder = FixedBinder {
        link_id: LinkId::from_raw(8),
    };
    let f =
        to_identity_formula_with_external_binder("=[1]'Sheet Name'!$A$1:B10", &r, Some(&binder))
            .unwrap();

    assert_eq!(f.template, "{0}");
    match &f.refs[0] {
        IdentityFormulaRef::ExternalRange(range) => {
            assert_eq!(range.link_id, binder.link_id);
            assert_eq!(range.address.start.row, 1);
            assert_eq!(range.address.start.col, 1);
            assert_eq!(range.address.end.row, 10);
            assert_eq!(range.address.end.col, 2);
            assert!(range.abs.start.row_abs);
            assert!(range.abs.start.col_abs);
            assert!(!range.abs.end.row_abs);
            assert!(!range.abs.end.col_abs);
        }
        other => panic!("expected external range, got {other:?}"),
    }
}
