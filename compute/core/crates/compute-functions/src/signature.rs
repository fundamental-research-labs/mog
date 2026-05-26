//! Declarative function signatures with per-argument role metadata.
//!
//! Used by `ExcelFunction` implementations to declare argument semantics.
//! The dispatch framework uses this metadata for signature-driven error
//! propagation — e.g., `Criteria` arguments pass errors through while
//! `Range` arguments propagate them.

/// Role of a function argument — determines error propagation and array-lifting behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArgRole {
    /// A cell range (e.g., SUMIF range, sum_range, criteria_range).
    /// Errors in Range arguments are propagated by the framework.
    Range,
    /// A criteria value (e.g., SUMIF criteria like ">5" or #N/A).
    /// Errors in Criteria arguments pass through to the function body,
    /// because error values are valid criteria (e.g., COUNTIF(range, #N/A)
    /// should count #N/A cells, not return #N/A).
    Criteria,
    /// A scalar value (numeric, text, boolean).
    /// Errors in Scalar arguments are propagated by the framework.
    /// If an array arrives for a Scalar-role argument, the registry
    /// auto-lifts the function call element-wise over the array.
    Scalar,
    /// Function handles arrays itself for this argument (e.g., SORT, FILTER).
    /// No auto-lifting is performed; errors pass through to the function body.
    ArrayNative,
}

/// Specification for a single fixed argument.
#[derive(Debug, Clone, Copy)]
pub struct ArgSpec {
    pub name: &'static str,
    pub role: ArgRole,
    pub optional: bool,
}

/// Specification for a repeating argument group (variadic tail).
#[derive(Debug, Clone, Copy)]
pub struct VariadicSpec {
    /// Repeating pattern of argument roles.
    /// E.g., `&[ArgRole::Range, ArgRole::Criteria]` for SUMIFS-style
    /// functions that take (criteria_range, criteria) pairs.
    pub group: &'static [ArgRole],
}

/// Declarative function signature with per-argument role metadata.
///
/// All data is `Copy` with `&'static` slices — zero heap allocation.
#[derive(Debug, Clone, Copy)]
pub struct FunctionSignature {
    pub fixed_args: &'static [ArgSpec],
    pub variadic: Option<VariadicSpec>,
    pub min_args: usize,
    pub max_args: Option<usize>,
}

impl FunctionSignature {
    /// Get the role for the argument at the given index.
    ///
    /// For indices within `fixed_args`, returns the declared role.
    /// For indices beyond `fixed_args`, uses the variadic group pattern
    /// with modulo indexing. Falls back to `ArgRole::Scalar` if no
    /// variadic spec is defined and the index is out of bounds.
    pub fn role_for_arg(&self, index: usize) -> ArgRole {
        if index < self.fixed_args.len() {
            self.fixed_args[index].role
        } else if let Some(ref var) = self.variadic {
            if var.group.is_empty() {
                ArgRole::Scalar
            } else {
                let offset = index - self.fixed_args.len();
                var.group[offset % var.group.len()]
            }
        } else {
            ArgRole::Scalar
        }
    }

    /// Whether an error in the argument at `index` should be propagated
    /// by the framework (short-circuit to error return).
    ///
    /// Returns `true` for `Range` and `Scalar` roles, `false` for `Criteria`
    /// and `ArrayNative`.
    pub fn propagates_error(&self, index: usize) -> bool {
        matches!(self.role_for_arg(index), ArgRole::Range | ArgRole::Scalar)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // COUNTIF(range, criteria) — 2 fixed args, no variadic
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

    // SUMIFS(sum_range, criteria_range1, criteria1, ...) — 1 fixed + variadic pairs
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

    // COUNTIFS(criteria_range1, criteria1, ...) — 0 fixed + variadic pairs
    static COUNTIFS_SIG: FunctionSignature = FunctionSignature {
        fixed_args: &[],
        variadic: Some(VariadicSpec {
            group: &[ArgRole::Range, ArgRole::Criteria],
        }),
        min_args: 2,
        max_args: None,
    };

    #[test]
    fn test_countif_fixed_roles() {
        assert_eq!(COUNTIF_SIG.role_for_arg(0), ArgRole::Range);
        assert_eq!(COUNTIF_SIG.role_for_arg(1), ArgRole::Criteria);
    }

    #[test]
    fn test_countif_propagation() {
        assert!(COUNTIF_SIG.propagates_error(0)); // Range propagates
        assert!(!COUNTIF_SIG.propagates_error(1)); // Criteria does NOT propagate
    }

    #[test]
    fn test_sumifs_variadic_roles() {
        // arg 0 = sum_range (fixed Range)
        assert_eq!(SUMIFS_SIG.role_for_arg(0), ArgRole::Range);
        // arg 1 = criteria_range1 (variadic[0] = Range)
        assert_eq!(SUMIFS_SIG.role_for_arg(1), ArgRole::Range);
        // arg 2 = criteria1 (variadic[1] = Criteria)
        assert_eq!(SUMIFS_SIG.role_for_arg(2), ArgRole::Criteria);
        // arg 3 = criteria_range2 (variadic[0] = Range)
        assert_eq!(SUMIFS_SIG.role_for_arg(3), ArgRole::Range);
        // arg 4 = criteria2 (variadic[1] = Criteria)
        assert_eq!(SUMIFS_SIG.role_for_arg(4), ArgRole::Criteria);
    }

    #[test]
    fn test_sumifs_propagation() {
        assert!(SUMIFS_SIG.propagates_error(0)); // sum_range
        assert!(SUMIFS_SIG.propagates_error(1)); // criteria_range1
        assert!(!SUMIFS_SIG.propagates_error(2)); // criteria1
        assert!(SUMIFS_SIG.propagates_error(3)); // criteria_range2
        assert!(!SUMIFS_SIG.propagates_error(4)); // criteria2
    }

    #[test]
    fn test_countifs_all_variadic() {
        // COUNTIFS: no fixed args, all variadic [Range, Criteria] pairs
        assert_eq!(COUNTIFS_SIG.role_for_arg(0), ArgRole::Range);
        assert_eq!(COUNTIFS_SIG.role_for_arg(1), ArgRole::Criteria);
        assert_eq!(COUNTIFS_SIG.role_for_arg(2), ArgRole::Range);
        assert_eq!(COUNTIFS_SIG.role_for_arg(3), ArgRole::Criteria);
    }

    #[test]
    fn test_out_of_bounds_no_variadic_falls_back_to_scalar() {
        // COUNTIF has no variadic and only 2 fixed args
        // Accessing index 5 should fall back to Scalar
        assert_eq!(COUNTIF_SIG.role_for_arg(5), ArgRole::Scalar);
    }

    #[test]
    fn test_array_native_does_not_propagate_error() {
        static SIG: FunctionSignature = FunctionSignature {
            fixed_args: &[ArgSpec {
                name: "array",
                role: ArgRole::ArrayNative,
                optional: false,
            }],
            variadic: None,
            min_args: 1,
            max_args: Some(1),
        };
        assert!(!SIG.propagates_error(0)); // ArrayNative does NOT propagate
        assert_eq!(SIG.role_for_arg(0), ArgRole::ArrayNative);
    }
}
