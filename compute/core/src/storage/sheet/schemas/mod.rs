//! Native column schemas and ordered data validations.
use cell_types::SheetId;

mod columns;
mod state;
pub(crate) use state::{StoredValidation, ValidationState};
mod range_geometry;
mod range_view;
mod ranges;
mod validator;

pub use columns::{
    clear_column_schema, get_all_column_schemas, get_column_schema, set_column_schema,
};
pub use ranges::{
    delete_range_schema, get_range_schema, get_range_schemas_for_sheet, set_range_schema,
    update_range_schema,
};
pub(crate) use validator::{
    DataValidationOutcome, validate_cell_value, validate_cell_value_against_data_validations,
};

// Re-export pure domain types from domain-types.
pub use domain_types::domain::validation::*;

pub(crate) fn get_validation_specs_for_sheet(
    storage: &crate::storage::WorkbookStorage,
    sheet_id: &SheetId,
) -> Vec<ValidationSpec> {
    storage
        .sheet_metadata
        .get(sheet_id)
        .map(|metadata| {
            metadata
                .validations
                .rules
                .iter()
                .map(|entry| entry.spec.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// Rewrite worksheet-qualified references in every stored validation rule.
///
/// Validation formulas are workbook-level dependencies even though their rules
/// are stored with a sheet. Keep them synchronized with a worksheet rename so
/// the next XLSX export does not retain an invalid former sheet name.
pub(crate) fn rewrite_validation_sheet_references(
    storage: &mut crate::storage::WorkbookStorage,
    old_name: &str,
    new_name: &str,
) {
    if old_name.eq_ignore_ascii_case(new_name) {
        return;
    }
    rewrite_validation_formulas(storage, |formula| {
        crate::storage::cells::formula_updater::replace_sheet_name_in_a1_formula(
            formula, old_name, new_name,
        )
    });
}

/// Invalidate every validation formula referring to a deleted worksheet.
pub(crate) fn invalidate_validation_sheet_references(
    storage: &mut crate::storage::WorkbookStorage,
    deleted_sheet_name: &str,
) {
    rewrite_validation_formulas(storage, |formula| {
        crate::storage::cells::formula_updater::invalidate_sheet_references_in_a1_formula(
            formula,
            deleted_sheet_name,
        )
    });
}

fn rewrite_validation_formulas(
    storage: &mut crate::storage::WorkbookStorage,
    rewrite_formula: impl Fn(&str) -> String,
) {
    let rewrites: Vec<_> = storage
        .sheet_metadata
        .iter()
        .flat_map(|(sheet_id, metadata)| {
            metadata.validations.rules.iter().filter_map(|entry| {
                let mut rewritten = entry.spec.clone();
                rewrite_validation_rule_formulas(&mut rewritten.rule, &rewrite_formula);
                (rewritten != entry.spec).then(|| (*sheet_id, entry.id.clone(), rewritten))
            })
        })
        .collect();

    for (sheet_id, id, rewritten) in rewrites {
        crate::storage::engine::history::metadata::capture_sheet_vector_entry!(
            storage,
            sheet_id,
            validations.rules,
            id,
            entry => entry.id
        );
        if let Some(entry) = storage
            .sheet_metadata
            .get_mut(&sheet_id)
            .and_then(|metadata| {
                metadata
                    .validations
                    .rules
                    .iter_mut()
                    .find(|entry| entry.id == id)
            })
        {
            entry.spec = rewritten;
        }
    }
}

fn rewrite_validation_rule_formulas(
    rule: &mut ValidationRule,
    rewrite_formula: &impl Fn(&str) -> String,
) {
    let rewrite = |formula: &mut String| {
        *formula = rewrite_formula(formula);
    };
    match rule {
        ValidationRule::None { formula1 }
        | ValidationRule::List { formula1, .. }
        | ValidationRule::Custom { formula1 } => rewrite(formula1),
        ValidationRule::WholeNumber {
            formula1, formula2, ..
        }
        | ValidationRule::Decimal {
            formula1, formula2, ..
        }
        | ValidationRule::Date {
            formula1, formula2, ..
        }
        | ValidationRule::Time {
            formula1, formula2, ..
        }
        | ValidationRule::TextLength {
            formula1, formula2, ..
        } => {
            rewrite(formula1);
            if let Some(formula2) = formula2 {
                rewrite(formula2);
            }
        }
    }
}

#[cfg(test)]
pub(super) use range_geometry::position_in_range;
#[cfg(test)]
pub(super) use validator::str_to_cell_value;

#[cfg(test)]
mod tests;
