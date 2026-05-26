//! Modern lookup functions: XLOOKUP, XMATCH.

use value_types::{CellError, CellValue};

use super::helpers::{
    SearchMode, binary_search_exact, binary_search_skip_errors, cell_value_cmp, cell_value_eq,
    get_return_value,
};
use crate::helpers::coercion::{check_error, flatten_values};
use crate::helpers::criteria::WildcardPattern;
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// XLOOKUP
// ---------------------------------------------------------------------------

pub(super) struct FnXlookup;
impl PureFunction for FnXlookup {
    fn name(&self) -> &'static str {
        "XLOOKUP"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(6)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match index {
            3 => Some(CellValue::Error(CellError::Na, None)), // if_not_found
            4 => Some(CellValue::number(0.0)),                // match_mode (exact)
            5 => Some(CellValue::number(1.0)),                // search_mode (first-to-last)
            _ => None,
        }
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])
        let lookup = &args[0];
        if let Some(e) = check_error(lookup) {
            return e;
        }

        let lookup_arr = flatten_values(&[args[1].clone()]);
        let return_arr = &args[2];

        let if_not_found = args.get(3);
        let match_mode = if args.len() > 4 {
            match args[4].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0 // exact match
        };
        let search_mode = if args.len() > 5 {
            match args[5].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1 // first to last
        };

        // Validate search_mode early
        let reverse = match search_mode {
            1 | 2 | -2 => false,
            -1 => true,
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!(
                        "XLOOKUP: invalid search_mode ({search_mode}), must be 1, -1, 2, or -2"
                    ),
                );
            }
        };

        let len = lookup_arr.len();

        // Find match in lookup_arr using iterators instead of collecting indices
        let match_idx = match match_mode {
            0 => {
                // Exact match
                if search_mode == 2 {
                    binary_search_exact(&lookup_arr, lookup, true)
                } else if search_mode == -2 {
                    binary_search_exact(&lookup_arr, lookup, false)
                } else if reverse {
                    (0..len)
                        .rev()
                        .find(|&i| cell_value_eq(lookup, &lookup_arr[i]))
                } else {
                    (0..len).find(|&i| cell_value_eq(lookup, &lookup_arr[i]))
                }
            }
            -1 => {
                // Exact match or next smaller
                if search_mode == 2 || search_mode == -2 {
                    let ascending = search_mode == 2;
                    binary_search_skip_errors(
                        &lookup_arr,
                        lookup,
                        ascending,
                        SearchMode::NextSmaller,
                    )
                } else {
                    let iter: Box<dyn Iterator<Item = usize>> = if reverse {
                        Box::new((0..len).rev())
                    } else {
                        Box::new(0..len)
                    };
                    let mut best: Option<(usize, &CellValue)> = None;
                    for i in iter {
                        let v = &lookup_arr[i];
                        if cell_value_eq(lookup, v) {
                            return get_return_value(return_arr, i);
                        }
                        if cell_value_cmp(v, lookup) < 0 {
                            match best {
                                None => best = Some((i, v)),
                                Some((_, bv)) if cell_value_cmp(v, bv) > 0 => {
                                    best = Some((i, v));
                                }
                                _ => {}
                            }
                        }
                    }
                    best.map(|(i, _)| i)
                }
            }
            1 => {
                // Exact match or next larger
                if search_mode == 2 || search_mode == -2 {
                    let ascending = search_mode == 2;
                    binary_search_skip_errors(
                        &lookup_arr,
                        lookup,
                        ascending,
                        SearchMode::NextLarger,
                    )
                } else {
                    let iter: Box<dyn Iterator<Item = usize>> = if reverse {
                        Box::new((0..len).rev())
                    } else {
                        Box::new(0..len)
                    };
                    let mut best: Option<(usize, &CellValue)> = None;
                    for i in iter {
                        let v = &lookup_arr[i];
                        if cell_value_eq(lookup, v) {
                            return get_return_value(return_arr, i);
                        }
                        if cell_value_cmp(v, lookup) > 0 {
                            match best {
                                None => best = Some((i, v)),
                                Some((_, bv)) if cell_value_cmp(v, bv) < 0 => {
                                    best = Some((i, v));
                                }
                                _ => {}
                            }
                        }
                    }
                    best.map(|(i, _)| i)
                }
            }
            2 => {
                // Wildcard match
                let pattern = match lookup.coerce_to_string() {
                    Ok(s) => WildcardPattern::new(&s),
                    Err(e) => return CellValue::Error(e, None),
                };
                if reverse {
                    (0..len)
                        .rev()
                        .find(|&i| match lookup_arr[i].coerce_to_string() {
                            Ok(s) => pattern.matches(&s),
                            Err(_) => false,
                        })
                } else {
                    (0..len).find(|&i| match lookup_arr[i].coerce_to_string() {
                        Ok(s) => pattern.matches(&s),
                        Err(_) => false,
                    })
                }
            }
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("XLOOKUP: invalid match_mode ({match_mode}), must be 0, -1, 1, or 2"),
                );
            }
        };

        match match_idx {
            Some(idx) => get_return_value(return_arr, idx),
            None => {
                if let Some(nf) = if_not_found {
                    nf.clone()
                } else {
                    CellValue::error_with_message(
                        CellError::Na,
                        "XLOOKUP: lookup value not found".to_string(),
                    )
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// XMATCH
// ---------------------------------------------------------------------------

pub(super) struct FnXmatch;
impl PureFunction for FnXmatch {
    fn name(&self) -> &'static str {
        "XMATCH"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(4)
    }
    fn returns_array(&self) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        // XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])
        let lookup = &args[0];
        if let Some(e) = check_error(lookup) {
            return e;
        }

        let lookup_arr = flatten_values(&[args[1].clone()]);

        let match_mode = if args.len() > 2 {
            match args[2].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            0
        };

        let search_mode = if args.len() > 3 {
            match args[3].coerce_to_number() {
                Ok(n) => n as i32,
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            1
        };

        // Validate search_mode early
        let reverse = match search_mode {
            1 | 2 | -2 => false,
            -1 => true,
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("XMATCH: invalid search_mode ({search_mode}), must be 1, -1, 2, or -2"),
                );
            }
        };

        let len = lookup_arr.len();

        let match_idx = match match_mode {
            0 => {
                // Exact match
                if search_mode == 2 {
                    binary_search_exact(&lookup_arr, lookup, true)
                } else if search_mode == -2 {
                    binary_search_exact(&lookup_arr, lookup, false)
                } else if reverse {
                    (0..len)
                        .rev()
                        .find(|&i| cell_value_eq(lookup, &lookup_arr[i]))
                } else {
                    (0..len).find(|&i| cell_value_eq(lookup, &lookup_arr[i]))
                }
            }
            -1 => {
                // Next smaller
                if search_mode == 2 || search_mode == -2 {
                    let ascending = search_mode == 2;
                    binary_search_skip_errors(
                        &lookup_arr,
                        lookup,
                        ascending,
                        SearchMode::NextSmaller,
                    )
                } else {
                    let iter: Box<dyn Iterator<Item = usize>> = if reverse {
                        Box::new((0..len).rev())
                    } else {
                        Box::new(0..len)
                    };
                    let mut best: Option<(usize, &CellValue)> = None;
                    for i in iter {
                        let v = &lookup_arr[i];
                        if cell_value_eq(lookup, v) {
                            return CellValue::number((i + 1) as f64);
                        }
                        if cell_value_cmp(v, lookup) < 0 {
                            match best {
                                None => best = Some((i, v)),
                                Some((_, bv)) if cell_value_cmp(v, bv) > 0 => {
                                    best = Some((i, v));
                                }
                                _ => {}
                            }
                        }
                    }
                    best.map(|(i, _)| i)
                }
            }
            1 => {
                // Next larger
                if search_mode == 2 || search_mode == -2 {
                    let ascending = search_mode == 2;
                    binary_search_skip_errors(
                        &lookup_arr,
                        lookup,
                        ascending,
                        SearchMode::NextLarger,
                    )
                } else {
                    let iter: Box<dyn Iterator<Item = usize>> = if reverse {
                        Box::new((0..len).rev())
                    } else {
                        Box::new(0..len)
                    };
                    let mut best: Option<(usize, &CellValue)> = None;
                    for i in iter {
                        let v = &lookup_arr[i];
                        if cell_value_eq(lookup, v) {
                            return CellValue::number((i + 1) as f64);
                        }
                        if cell_value_cmp(v, lookup) > 0 {
                            match best {
                                None => best = Some((i, v)),
                                Some((_, bv)) if cell_value_cmp(v, bv) < 0 => {
                                    best = Some((i, v));
                                }
                                _ => {}
                            }
                        }
                    }
                    best.map(|(i, _)| i)
                }
            }
            2 => {
                // Wildcard
                let pattern = match lookup.coerce_to_string() {
                    Ok(s) => WildcardPattern::new(&s),
                    Err(e) => return CellValue::Error(e, None),
                };
                if reverse {
                    (0..len)
                        .rev()
                        .find(|&i| match lookup_arr[i].coerce_to_string() {
                            Ok(s) => pattern.matches(&s),
                            Err(_) => false,
                        })
                } else {
                    (0..len).find(|&i| match lookup_arr[i].coerce_to_string() {
                        Ok(s) => pattern.matches(&s),
                        Err(_) => false,
                    })
                }
            }
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("XMATCH: invalid match_mode ({match_mode}), must be 0, -1, 1, or 2"),
                );
            }
        };

        match match_idx {
            Some(i) => CellValue::number((i + 1) as f64),
            None => CellValue::error_with_message(
                CellError::Na,
                "XMATCH: lookup value not found".to_string(),
            ),
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnXlookup));
    registry.register(Box::new(FnXmatch));
}
