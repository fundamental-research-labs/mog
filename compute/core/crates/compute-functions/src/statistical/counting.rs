//! Conditional aggregation functions:
//! SUMIF, COUNTIF, AVERAGEIF, SUMIFS, COUNTIFS, AVERAGEIFS, MAXIFS, MINIFS

use value_types::{CellError, CellValue};

use super::helpers::evaluate_multi_criteria_array;
use crate::helpers::coercion::flatten_values_ref;
use crate::helpers::conditional_aggregate::{
    AggregateOp, aggregate_matching_rows, scan_single_criteria,
};
use crate::helpers::criteria::{extract_criteria_elements, parse_criteria};
use crate::helpers::frequency_cache::{self, is_exact_match_criteria};
use crate::signature::{ArgRole, ArgSpec, FunctionSignature, VariadicSpec};
use crate::{ExcelFunction, FunctionRegistry};

// ---------------------------------------------------------------------------
// Static signatures
// ---------------------------------------------------------------------------

static COUNTIF_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[
        ArgSpec {
            name: "range",
            role: ArgRole::Range,
            optional: false,
        },
        ArgSpec {
            name: "criteria",
            role: ArgRole::Criteria,
            optional: false,
        },
    ],
    variadic: None,
    min_args: 2,
    max_args: Some(2),
};

static SUMIF_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[
        ArgSpec {
            name: "range",
            role: ArgRole::Range,
            optional: false,
        },
        ArgSpec {
            name: "criteria",
            role: ArgRole::Criteria,
            optional: false,
        },
        ArgSpec {
            name: "sum_range",
            role: ArgRole::Range,
            optional: true,
        },
    ],
    variadic: None,
    min_args: 2,
    max_args: Some(3),
};

static AVERAGEIF_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[
        ArgSpec {
            name: "range",
            role: ArgRole::Range,
            optional: false,
        },
        ArgSpec {
            name: "criteria",
            role: ArgRole::Criteria,
            optional: false,
        },
        ArgSpec {
            name: "average_range",
            role: ArgRole::Range,
            optional: true,
        },
    ],
    variadic: None,
    min_args: 2,
    max_args: Some(3),
};

static COUNTIFS_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[],
    variadic: Some(VariadicSpec {
        group: &[ArgRole::Range, ArgRole::Criteria],
    }),
    min_args: 2,
    max_args: None,
};

static SUMIFS_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[ArgSpec {
        name: "sum_range",
        role: ArgRole::Range,
        optional: false,
    }],
    variadic: Some(VariadicSpec {
        group: &[ArgRole::Range, ArgRole::Criteria],
    }),
    min_args: 3,
    max_args: None,
};

static AVERAGEIFS_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[ArgSpec {
        name: "average_range",
        role: ArgRole::Range,
        optional: false,
    }],
    variadic: Some(VariadicSpec {
        group: &[ArgRole::Range, ArgRole::Criteria],
    }),
    min_args: 3,
    max_args: None,
};

static MAXIFS_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[ArgSpec {
        name: "max_range",
        role: ArgRole::Range,
        optional: false,
    }],
    variadic: Some(VariadicSpec {
        group: &[ArgRole::Range, ArgRole::Criteria],
    }),
    min_args: 3,
    max_args: None,
};

static MINIFS_SIG: FunctionSignature = FunctionSignature {
    fixed_args: &[ArgSpec {
        name: "min_range",
        role: ArgRole::Range,
        optional: false,
    }],
    variadic: Some(VariadicSpec {
        group: &[ArgRole::Range, ArgRole::Criteria],
    }),
    min_args: 3,
    max_args: None,
};

// ---------------------------------------------------------------------------
// Helper: check if a Range-role argument is an error (defense in depth).
// Only checks args whose role is Range --- never criteria.
// ---------------------------------------------------------------------------

fn first_range_arg_error(args: &[CellValue], sig: &FunctionSignature) -> Option<CellError> {
    for (i, arg) in args.iter().enumerate() {
        if let CellValue::Error(e, _) = arg
            && sig.propagates_error(i)
        {
            return Some(*e);
        }
    }
    None
}

/// Reshape a flat Vec of results into a CellValue::Array matching the given shape.
fn reshape_results(results: Vec<CellValue>, nrows: usize, ncols: usize) -> CellValue {
    let mut rows = Vec::with_capacity(nrows);
    let mut iter = results.into_iter();
    for _ in 0..nrows {
        rows.push(iter.by_ref().take(ncols).collect::<Vec<_>>());
    }
    CellValue::from_rows(rows)
}

// ---------------------------------------------------------------------------
// Single-criteria conditional aggregation (SUMIF, COUNTIF, AVERAGEIF)
// ---------------------------------------------------------------------------

pub(super) struct FnSumIf;
impl ExcelFunction for FnSumIf {
    fn name(&self) -> &'static str {
        "SUMIF"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &SUMIF_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }
        let range = flatten_values_ref(&args[0]);
        let sum_range = if args.len() > 2 {
            flatten_values_ref(&args[2])
        } else {
            range.clone()
        };

        // Array criteria path: return one sum per criteria element.
        if let Some((elements, nrows, ncols)) = extract_criteria_elements(&args[1]) {
            // Fast path: frequency cache for exact-match criteria.
            if elements.iter().all(|e| is_exact_match_criteria(e)) {
                let results: Vec<CellValue> = elements
                    .iter()
                    .map(
                        |elem| match frequency_cache::sum_lookup(&range, &sum_range, elem) {
                            Ok(s) => CellValue::number(s),
                            Err(e) => CellValue::Error(e, None),
                        },
                    )
                    .collect();
                return reshape_results(results, nrows, ncols);
            }
            // Fallback: linear scan per element.
            let results: Vec<CellValue> = elements
                .iter()
                .map(|elem| {
                    let criteria = parse_criteria(elem);
                    scan_single_criteria(
                        &range[..],
                        &*criteria,
                        Some(&sum_range[..]),
                        range.len(),
                        AggregateOp::Sum,
                    )
                })
                .collect();
            return reshape_results(results, nrows, ncols);
        }

        // Scalar path: frequency cache for exact-match, linear scan otherwise.
        if is_exact_match_criteria(&args[1]) {
            return match frequency_cache::sum_lookup(&range, &sum_range, &args[1]) {
                Ok(s) => CellValue::number(s),
                Err(e) => CellValue::Error(e, None),
            };
        }
        let criteria = parse_criteria(&args[1]);
        scan_single_criteria(
            &range[..],
            &*criteria,
            Some(&sum_range[..]),
            range.len(),
            AggregateOp::Sum,
        )
    }
}

pub(super) struct FnCountIf;
impl ExcelFunction for FnCountIf {
    fn name(&self) -> &'static str {
        "COUNTIF"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &COUNTIF_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }
        let range = flatten_values_ref(&args[0]);

        // Array criteria path: return one count per criteria element.
        if let Some((elements, nrows, ncols)) = extract_criteria_elements(&args[1]) {
            // Fast path: if ALL criteria elements are exact-match, use frequency cache.
            if elements.iter().all(|e| is_exact_match_criteria(e)) {
                let results: Vec<CellValue> = elements
                    .iter()
                    .map(|elem| {
                        CellValue::number(frequency_cache::count_lookup(&range, elem) as f64)
                    })
                    .collect();
                return reshape_results(results, nrows, ncols);
            }
            // Fallback: linear scan per element.
            let results: Vec<CellValue> = elements
                .iter()
                .map(|elem| {
                    let criteria = parse_criteria(elem);
                    scan_single_criteria::<[&CellValue], [&CellValue]>(
                        &range[..],
                        &*criteria,
                        None,
                        range.len(),
                        AggregateOp::Count,
                    )
                })
                .collect();
            return reshape_results(results, nrows, ncols);
        }

        // Scalar path: frequency cache for exact-match, linear scan otherwise.
        if is_exact_match_criteria(&args[1]) {
            let count = frequency_cache::count_lookup(&range, &args[1]);
            return CellValue::number(count as f64);
        }
        let criteria = parse_criteria(&args[1]);
        scan_single_criteria::<[&CellValue], [&CellValue]>(
            &range[..],
            &*criteria,
            None,
            range.len(),
            AggregateOp::Count,
        )
    }
}

pub(super) struct FnAverageIf;
impl ExcelFunction for FnAverageIf {
    fn name(&self) -> &'static str {
        "AVERAGEIF"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &AVERAGEIF_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }
        let range = flatten_values_ref(&args[0]);
        let avg_range = if args.len() > 2 {
            flatten_values_ref(&args[2])
        } else {
            range.clone()
        };

        // Array criteria path: return one average per criteria element.
        if let Some((elements, nrows, ncols)) = extract_criteria_elements(&args[1]) {
            // Fast path: frequency cache for exact-match criteria.
            if elements.iter().all(|e| is_exact_match_criteria(e)) {
                let results: Vec<CellValue> = elements
                    .iter()
                    .map(|elem| {
                        match frequency_cache::sum_and_count_lookup(&range, &avg_range, elem) {
                            Ok((sum, count)) => {
                                if count == 0 {
                                    CellValue::error_with_message(
                                        CellError::Div0,
                                        "AVERAGEIF: no matching values found",
                                    )
                                } else {
                                    CellValue::number(sum / count as f64)
                                }
                            }
                            Err(e) => CellValue::Error(e, None),
                        }
                    })
                    .collect();
                return reshape_results(results, nrows, ncols);
            }
            // Fallback: linear scan per element.
            let results: Vec<CellValue> = elements
                .iter()
                .map(|elem| {
                    let criteria = parse_criteria(elem);
                    scan_single_criteria(
                        &range[..],
                        &*criteria,
                        Some(&avg_range[..]),
                        range.len(),
                        AggregateOp::Average,
                    )
                })
                .collect();
            return reshape_results(results, nrows, ncols);
        }

        // Scalar path: frequency cache for exact-match, linear scan otherwise.
        if is_exact_match_criteria(&args[1]) {
            return match frequency_cache::sum_and_count_lookup(&range, &avg_range, &args[1]) {
                Ok((sum, count)) => {
                    if count == 0 {
                        CellValue::error_with_message(
                            CellError::Div0,
                            "AVERAGEIF: no matching values found",
                        )
                    } else {
                        CellValue::number(sum / count as f64)
                    }
                }
                Err(e) => CellValue::Error(e, None),
            };
        }
        let criteria = parse_criteria(&args[1]);
        scan_single_criteria(
            &range[..],
            &*criteria,
            Some(&avg_range[..]),
            range.len(),
            AggregateOp::Average,
        )
    }
}

// ---------------------------------------------------------------------------
// Multi-criteria conditional aggregation (SUMIFS, COUNTIFS, AVERAGEIFS, MAXIFS, MINIFS)
// ---------------------------------------------------------------------------

pub(super) struct FnSumIfs;
impl ExcelFunction for FnSumIfs {
    fn name(&self) -> &'static str {
        "SUMIFS"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &SUMIFS_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if !(args.len() - 1).is_multiple_of(2) {
            return CellValue::error_with_message(
                CellError::Value,
                "SUMIFS: criteria arguments must come in range/criteria pairs",
            );
        }
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }
        let sum_range = flatten_values_ref(&args[0]);
        let (match_vectors, nrows, ncols) = match evaluate_multi_criteria_array(args, 1) {
            Some(r) => r,
            None => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "SUMIFS: failed to evaluate criteria",
                );
            }
        };

        let results: Vec<CellValue> = match_vectors
            .iter()
            .map(|matches| {
                aggregate_matching_rows(
                    matches.ones().map(|i| i as usize),
                    Some(&sum_range[..]),
                    AggregateOp::Sum,
                )
            })
            .collect();

        if nrows == 1 && ncols == 1 {
            results
                .into_iter()
                .next()
                .unwrap_or(CellValue::Error(CellError::Value, None))
        } else {
            reshape_results(results, nrows, ncols)
        }
    }
}

pub(super) struct FnCountIfs;
impl ExcelFunction for FnCountIfs {
    fn name(&self) -> &'static str {
        "COUNTIFS"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &COUNTIFS_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if !args.len().is_multiple_of(2) {
            return CellValue::error_with_message(
                CellError::Value,
                "COUNTIFS: criteria arguments must come in range/criteria pairs",
            );
        }
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }

        // Fast path: single-pair COUNTIFS is semantically COUNTIF.
        // Skip if criteria is a multi-element array — must fall through to
        // evaluate_multi_criteria_array which returns per-element results.
        if args.len() == 2
            && extract_criteria_elements(&args[1]).is_none()
            && is_exact_match_criteria(&args[1])
        {
            let range = flatten_values_ref(&args[0]);
            let count = frequency_cache::count_lookup(&range, &args[1]);
            return CellValue::number(count as f64);
        }

        let (match_vectors, nrows, ncols) = match evaluate_multi_criteria_array(args, 0) {
            Some(r) => r,
            None => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "COUNTIFS: failed to evaluate criteria",
                );
            }
        };

        let results: Vec<CellValue> = match_vectors
            .iter()
            .map(|matches| CellValue::number(matches.count_ones() as f64))
            .collect();

        if nrows == 1 && ncols == 1 {
            results
                .into_iter()
                .next()
                .unwrap_or(CellValue::Error(CellError::Value, None))
        } else {
            reshape_results(results, nrows, ncols)
        }
    }
}

pub(super) struct FnAverageIfs;
impl ExcelFunction for FnAverageIfs {
    fn name(&self) -> &'static str {
        "AVERAGEIFS"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &AVERAGEIFS_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if !(args.len() - 1).is_multiple_of(2) {
            return CellValue::error_with_message(
                CellError::Value,
                "AVERAGEIFS: criteria arguments must come in range/criteria pairs",
            );
        }
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }
        let avg_range = flatten_values_ref(&args[0]);
        let (match_vectors, nrows, ncols) = match evaluate_multi_criteria_array(args, 1) {
            Some(r) => r,
            None => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "AVERAGEIFS: failed to evaluate criteria",
                );
            }
        };

        let results: Vec<CellValue> = match_vectors
            .iter()
            .map(|matches| {
                aggregate_matching_rows(
                    matches.ones().map(|i| i as usize),
                    Some(&avg_range[..]),
                    AggregateOp::Average,
                )
            })
            .collect();

        if nrows == 1 && ncols == 1 {
            results
                .into_iter()
                .next()
                .unwrap_or(CellValue::Error(CellError::Value, None))
        } else {
            reshape_results(results, nrows, ncols)
        }
    }
}

pub(super) struct FnMaxIfs;
impl ExcelFunction for FnMaxIfs {
    fn name(&self) -> &'static str {
        "MAXIFS"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &MAXIFS_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if !(args.len() - 1).is_multiple_of(2) {
            return CellValue::error_with_message(
                CellError::Value,
                "MAXIFS: criteria arguments must come in range/criteria pairs",
            );
        }
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }
        let max_range = flatten_values_ref(&args[0]);
        let (match_vectors, nrows, ncols) = match evaluate_multi_criteria_array(args, 1) {
            Some(r) => r,
            None => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "MAXIFS: failed to evaluate criteria",
                );
            }
        };

        let results: Vec<CellValue> = match_vectors
            .iter()
            .map(|matches| {
                aggregate_matching_rows(
                    matches.ones().map(|i| i as usize),
                    Some(&max_range[..]),
                    AggregateOp::Max,
                )
            })
            .collect();

        if nrows == 1 && ncols == 1 {
            results
                .into_iter()
                .next()
                .unwrap_or(CellValue::Error(CellError::Value, None))
        } else {
            reshape_results(results, nrows, ncols)
        }
    }
}

pub(super) struct FnMinIfs;
impl ExcelFunction for FnMinIfs {
    fn name(&self) -> &'static str {
        "MINIFS"
    }
    fn signature(&self) -> &'static FunctionSignature {
        &MINIFS_SIG
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if !(args.len() - 1).is_multiple_of(2) {
            return CellValue::error_with_message(
                CellError::Value,
                "MINIFS: criteria arguments must come in range/criteria pairs",
            );
        }
        if let Some(e) = first_range_arg_error(args, self.signature()) {
            return CellValue::Error(e, None);
        }
        let min_range = flatten_values_ref(&args[0]);
        let (match_vectors, nrows, ncols) = match evaluate_multi_criteria_array(args, 1) {
            Some(r) => r,
            None => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "MINIFS: failed to evaluate criteria",
                );
            }
        };

        let results: Vec<CellValue> = match_vectors
            .iter()
            .map(|matches| {
                aggregate_matching_rows(
                    matches.ones().map(|i| i as usize),
                    Some(&min_range[..]),
                    AggregateOp::Min,
                )
            })
            .collect();

        if nrows == 1 && ncols == 1 {
            results
                .into_iter()
                .next()
                .unwrap_or(CellValue::Error(CellError::Value, None))
        } else {
            reshape_results(results, nrows, ncols)
        }
    }
}

pub fn register(registry: &mut FunctionRegistry) {
    registry.register_excel(Box::new(FnSumIf));
    registry.register_excel(Box::new(FnCountIf));
    registry.register_excel(Box::new(FnAverageIf));
    registry.register_excel(Box::new(FnSumIfs));
    registry.register_excel(Box::new(FnCountIfs));
    registry.register_excel(Box::new(FnAverageIfs));
    registry.register_excel(Box::new(FnMaxIfs));
    registry.register_excel(Box::new(FnMinIfs));
}
