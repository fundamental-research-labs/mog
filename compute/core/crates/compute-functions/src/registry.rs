//! FunctionRegistry -- central dispatch for all Excel-compatible functions.
//!
//! Stores both PureFunction (flat args, no role semantics) and
//! ExcelFunction (declarative signatures with per-argument error
//! propagation) via the RegisteredFunction enum.

use crate::ExcelFunction;
use crate::PureFunction;
use rustc_hash::FxHashMap;
use value_types::{CellError, CellValue};

/// Wrapper enum that unifies PureFunction and ExcelFunction in one registry.
pub enum RegisteredFunction {
    /// Classic pure function.
    Pure(Box<dyn PureFunction>),
    /// Function with declarative signature.
    Excel(Box<dyn ExcelFunction>),
}

impl RegisteredFunction {
    pub fn call(&self, args: &[CellValue]) -> CellValue {
        // --- Array-lifting: auto-broadcast Scalar-role array arguments ---
        // Functions that return arrays natively (SORT, FILTER, UNIQUE, etc.)
        // handle arrays themselves — skip auto-lifting for them.
        if !self.returns_array()
            && let Some(result) = self.try_array_lift(args)
        {
            return result;
        }
        self.call_inner(args)
    }

    /// Auto-broadcast Scalar-role array arguments element-wise.
    ///
    /// When multiple arguments are arrays, broadcasts them together (zipped,
    /// not cross-product) matching Excel's implicit intersection behavior.
    /// Single-array cases are optimized with a fast path.
    fn try_array_lift(&self, args: &[CellValue]) -> Option<CellValue> {
        // Collect all liftable array argument indices.
        let lift_indices: Vec<usize> = args
            .iter()
            .enumerate()
            .filter(|(i, arg)| matches!(arg, CellValue::Array(_)) && self.is_liftable_arg(*i))
            .map(|(i, _)| i)
            .collect();

        if lift_indices.is_empty() {
            return None;
        }

        // --- Single-array fast path (most common) ---
        if lift_indices.len() == 1 {
            let lift_idx = lift_indices[0];
            let arr = match &args[lift_idx] {
                CellValue::Array(a) => a,
                _ => unreachable!(),
            };
            let cols = arr.cols();

            // 2-arg optimization: avoid args.to_vec() per element
            if args.len() == 2 {
                let other_idx = 1 - lift_idx;
                let other = &args[other_idx];
                let result: Vec<CellValue> = arr
                    .iter()
                    .map(|elem| {
                        if lift_idx == 0 {
                            self.call(&[elem.clone(), other.clone()])
                        } else {
                            self.call(&[other.clone(), elem.clone()])
                        }
                    })
                    .collect();
                return Some(CellValue::array(result, cols));
            }

            let result: Vec<CellValue> = arr
                .iter()
                .map(|elem| {
                    let mut lifted_args = args.to_vec();
                    lifted_args[lift_idx] = elem.clone();
                    self.call(&lifted_args)
                })
                .collect();
            return Some(CellValue::array(result, cols));
        }

        // --- Multi-array broadcast path ---
        // When multiple args are co-dimensional arrays (e.g. DATE(year_arr, month_arr, 1)),
        // broadcast all liftable arrays together element-wise rather than sequentially,
        // which would produce an incorrect cross-product / nested arrays.

        // Compute broadcast dimensions across all liftable arrays.
        let mut max_rows: usize = 1;
        let mut max_cols: usize = 1;
        for &idx in &lift_indices {
            if let CellValue::Array(a) = &args[idx] {
                let ar = a.rows();
                let ac = a.cols();
                if ar > 1 {
                    if max_rows == 1 {
                        max_rows = ar;
                    } else if ar != max_rows {
                        return Some(CellValue::Error(CellError::Value, None));
                    }
                }
                if ac > 1 {
                    if max_cols == 1 {
                        max_cols = ac;
                    } else if ac != max_cols {
                        return Some(CellValue::Error(CellError::Value, None));
                    }
                }
            }
        }

        let mut result = Vec::with_capacity(max_rows * max_cols);
        for r in 0..max_rows {
            for c in 0..max_cols {
                let mut lifted_args = args.to_vec();
                for &idx in &lift_indices {
                    if let CellValue::Array(a) = &args[idx] {
                        let ri = if a.rows() == 1 { 0 } else { r };
                        let ci = if a.cols() == 1 { 0 } else { c };
                        lifted_args[idx] = a
                            .get(ri, ci)
                            .cloned()
                            .unwrap_or(CellValue::Error(CellError::Na, None));
                    }
                }
                // Use call_inner: all liftable arrays are already extracted to scalars.
                // Any remaining arrays in non-liftable positions are handled natively
                // by the function itself.
                result.push(self.call_inner(&lifted_args));
            }
        }
        Some(CellValue::array(result, max_cols))
    }

    /// Whether argument at `index` should be auto-lifted when it is an array.
    ///
    /// ExcelFunctions use their declarative signature: only `ArgRole::Scalar`
    /// args are liftable. PureFunctions delegate to `is_scalar_arg()` —
    /// default `false` preserves array-native behavior (LARGE, STDEV, etc.),
    /// while scalar functions (ABS, TEXT, ROUND, etc.) override to `true`.
    fn is_liftable_arg(&self, index: usize) -> bool {
        match self {
            Self::Pure(f) => f.is_scalar_arg(index),
            Self::Excel(f) => {
                matches!(
                    f.signature().role_for_arg(index),
                    crate::signature::ArgRole::Scalar
                )
            }
        }
    }

    /// Call the function without array-lifting (the inner dispatch).
    fn call_inner(&self, args: &[CellValue]) -> CellValue {
        match self {
            Self::Pure(f) => f.call(args),
            Self::Excel(f) => {
                let sig = f.signature();
                for (i, arg) in args.iter().enumerate() {
                    if let CellValue::Error(e, _) = arg
                        && sig.propagates_error(i)
                    {
                        return CellValue::Error(*e, None);
                    }
                }
                f.call(args)
            }
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Pure(f) => f.name(),
            Self::Excel(f) => f.name(),
        }
    }

    pub fn min_args(&self) -> usize {
        match self {
            Self::Pure(f) => f.min_args(),
            Self::Excel(f) => f.signature().min_args,
        }
    }

    pub fn max_args(&self) -> Option<usize> {
        match self {
            Self::Pure(f) => f.max_args(),
            Self::Excel(f) => f.signature().max_args,
        }
    }

    pub fn is_volatile(&self) -> bool {
        match self {
            Self::Pure(f) => f.is_volatile(),
            Self::Excel(f) => f.is_volatile(),
        }
    }

    pub fn returns_array(&self) -> bool {
        match self {
            Self::Pure(f) => f.returns_array(),
            Self::Excel(f) => f.returns_array(),
        }
    }

    pub fn default_for_arg(&self, index: usize) -> Option<CellValue> {
        match self {
            Self::Pure(f) => f.default_for_arg(index),
            Self::Excel(f) => f.default_for_arg(index),
        }
    }
}

pub struct FunctionRegistry {
    functions: Vec<RegisteredFunction>,
    name_to_id: FxHashMap<String, u16>,
}

impl FunctionRegistry {
    fn normalize_lookup_name(name: &str) -> &str {
        if name.len() >= 12 && name[..12].eq_ignore_ascii_case("_xlfn._xlws.") {
            &name[12..]
        } else if name.len() >= 6 && name[..6].eq_ignore_ascii_case("_xlfn.") {
            &name[6..]
        } else {
            name
        }
    }

    pub fn new() -> Self {
        let mut reg = Self {
            functions: Vec::with_capacity(600),
            name_to_id: FxHashMap::default(),
        };
        reg.register_all();
        reg
    }
    pub fn get_by_name(&self, name: &str) -> Option<(u16, &RegisteredFunction)> {
        let name = Self::normalize_lookup_name(name);
        // Fast path: try direct lookup first (names from the parser are almost always uppercase)
        if let Some(&id) = self.name_to_id.get(name) {
            let f = self.functions.get(id as usize)?;
            return Some((id, f));
        }
        // Slow path: uppercase and retry (avoids allocation in the common case)
        let upper = name.to_uppercase();
        let id = *self.name_to_id.get(&upper)?;
        let f = self.functions.get(id as usize)?;
        Some((id, f))
    }

    pub fn get_by_id(&self, id: u16) -> Option<&RegisteredFunction> {
        self.functions.get(id as usize)
    }

    pub fn call(&self, name: &str, args: &[CellValue]) -> CellValue {
        match self.get_by_name(name) {
            Some((_id, func)) => {
                if args.len() < func.min_args() {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "{name} requires at least {} argument(s), got {}",
                            func.min_args(),
                            args.len()
                        ),
                    );
                }
                if let Some(max) = func.max_args()
                    && args.len() > max
                {
                    return CellValue::error_with_message(
                        CellError::Value,
                        format!(
                            "{name} accepts at most {max} argument(s), got {}",
                            args.len()
                        ),
                    );
                }
                func.call(args)
            }
            None => {
                CellValue::error_with_message(CellError::Name, format!("Unknown function '{name}'"))
            }
        }
    }

    pub fn len(&self) -> usize {
        self.functions.len()
    }
    pub fn is_empty(&self) -> bool {
        self.functions.is_empty()
    }

    /// Iterate over all registered function names (uppercase).
    pub fn function_names(&self) -> impl Iterator<Item = &str> {
        self.name_to_id.keys().map(|s| s.as_str())
    }

    /// Iterate over all registered functions with their IDs and names.
    pub fn iter(&self) -> impl Iterator<Item = (u16, &str, &RegisteredFunction)> {
        self.name_to_id.iter().filter_map(move |(name, &id)| {
            self.functions
                .get(id as usize)
                .map(|f| (id, name.as_str(), f))
        })
    }

    pub fn is_volatile(&self, name: &str) -> bool {
        self.get_by_name(name)
            .map(|(_, f)| f.is_volatile())
            .unwrap_or(false)
    }

    pub fn returns_array(&self, name: &str) -> bool {
        self.get_by_name(name)
            .map(|(_, f)| f.returns_array())
            .unwrap_or(false)
    }

    pub(crate) fn register(&mut self, func: Box<dyn PureFunction>) {
        let name = func.name().to_uppercase();
        let id = self.functions.len() as u16;
        self.name_to_id.insert(name, id);
        self.functions.push(RegisteredFunction::Pure(func));
    }

    pub(crate) fn register_excel(&mut self, func: Box<dyn ExcelFunction>) {
        let name = func.name().to_uppercase();
        let id = self.functions.len() as u16;
        self.name_to_id.insert(name, id);
        self.functions.push(RegisteredFunction::Excel(func));
    }

    fn register_all(&mut self) {
        crate::math::register(self);
        crate::text::register(self);
        crate::logical::register(self);
        crate::lookup::register(self);
        crate::statistical::register(self);
        crate::datetime::register(self);
        crate::financial::register(self);
        crate::engineering::register(self);
        crate::database::register(self);
        crate::information::register(self);
        crate::web::register(self);
    }
}

impl Default for FunctionRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_creation() {
        let reg = FunctionRegistry::new();
        assert!(!reg.is_empty());
        assert!(reg.len() > 50);
    }

    #[test]
    fn test_lookup_by_name_case_insensitive() {
        let reg = FunctionRegistry::new();
        assert!(reg.get_by_name("ABS").is_some());
        assert!(reg.get_by_name("abs").is_some());
        assert!(reg.get_by_name("Abs").is_some());
        assert!(reg.get_by_name("aBs").is_some());
    }

    #[test]
    fn test_lookup_by_id() {
        let reg = FunctionRegistry::new();
        let (id, _) = reg.get_by_name("ABS").unwrap();
        let func = reg.get_by_id(id).unwrap();
        assert_eq!(func.name(), "ABS");
    }

    #[test]
    fn test_unknown_function() {
        let reg = FunctionRegistry::new();
        assert!(reg.get_by_name("DOES_NOT_EXIST").is_none());
    }

    #[test]
    fn test_call_abs() {
        let reg = FunctionRegistry::new();
        let result = reg.call("ABS", &[CellValue::number(-5.0)]);
        assert_eq!(result, CellValue::number(5.0));
    }

    #[test]
    fn test_call_unknown() {
        let reg = FunctionRegistry::new();
        let result = reg.call("NONEXISTENT", &[]);
        assert_eq!(result, CellValue::Error(CellError::Name, None));
    }

    #[test]
    fn test_argument_count_validation() {
        let reg = FunctionRegistry::new();
        let result = reg.call("ABS", &[]);
        assert_eq!(result, CellValue::Error(CellError::Value, None));
        let result = reg.call("ABS", &[CellValue::number(1.0), CellValue::number(2.0)]);
        assert_eq!(result, CellValue::Error(CellError::Value, None));
    }

    #[test]
    fn test_volatile_functions() {
        let reg = FunctionRegistry::new();
        assert!(reg.is_volatile("RAND"));
        assert!(reg.is_volatile("RANDBETWEEN"));
        assert!(reg.is_volatile("RANDARRAY"));
        assert!(!reg.is_volatile("ABS"));
        assert!(!reg.is_volatile("IF"));
    }

    #[test]
    fn test_array_returning_functions() {
        let reg = FunctionRegistry::new();
        assert!(reg.returns_array("FILTER"));
        assert!(reg.returns_array("SORT"));
        assert!(reg.returns_array("UNIQUE"));
        assert!(reg.returns_array("SEQUENCE"));
        assert!(reg.returns_array("REGEXEXTRACT"));
        assert!(!reg.returns_array("ABS"));
        assert!(!reg.returns_array("REGEXREPLACE"));
        assert!(!reg.returns_array("REGEXMATCH"));
        assert!(!reg.returns_array("REGEXTEST"));
    }

    #[test]
    fn test_registry_regex_metadata() {
        let reg = FunctionRegistry::new();
        let (_, extract) = reg.get_by_name("REGEXEXTRACT").expect("REGEXEXTRACT");
        assert_eq!(extract.min_args(), 2);
        assert_eq!(extract.max_args(), Some(4));
        assert!(extract.returns_array());

        let (_, replace) = reg.get_by_name("REGEXREPLACE").expect("REGEXREPLACE");
        assert_eq!(replace.min_args(), 3);
        assert_eq!(replace.max_args(), Some(5));
        assert!(!replace.returns_array());

        let (_, regexmatch) = reg.get_by_name("REGEXMATCH").expect("REGEXMATCH");
        assert_eq!(regexmatch.min_args(), 2);
        assert_eq!(regexmatch.max_args(), Some(2));
        assert!(!regexmatch.returns_array());

        let (_, regextest) = reg.get_by_name("REGEXTEST").expect("REGEXTEST");
        assert_eq!(regextest.min_args(), 2);
        assert_eq!(regextest.max_args(), Some(3));
        assert!(!regextest.returns_array());

        assert!(reg.get_by_name("_xlfn.REGEXTEST").is_some());
        assert!(reg.get_by_name("_Xlfn._XLWS.REGEXEXTRACT").is_some());
    }

    #[test]
    fn test_registry_scalar_pure_functions_auto_lifted() {
        let reg = FunctionRegistry::new();
        // Scalar PureFunctions (is_scalar_arg → true) ARE auto-lifted.
        // ABS({-1;-2;-3}) produces {1;2;3} via element-wise lifting.
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(-1.0)],
            vec![CellValue::number(-2.0)],
            vec![CellValue::number(-3.0)],
        ]);
        let result = reg.call("ABS", &[arr]);
        let expected = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_registry_large_not_broken_by_lifting() {
        let reg = FunctionRegistry::new();
        // LARGE({100, 200, 300}, 1) should return 300 (not auto-lift)
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(100.0)],
            vec![CellValue::number(200.0)],
            vec![CellValue::number(300.0)],
        ]);
        let result = reg.call("LARGE", &[arr, CellValue::number(1.0)]);
        assert_eq!(result, CellValue::number(300.0));
    }

    #[test]
    fn test_registry_preserves_range_args() {
        let reg = FunctionRegistry::new();
        // COUNTIF(range, criteria) — Range-role arg should NOT be auto-lifted.
        // COUNTIF({1;2;3;2}, 2) should count how many 2s are in the range => 2
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
            vec![CellValue::number(2.0)],
        ]);
        let result = reg.call("COUNTIF", &[arr, CellValue::number(2.0)]);
        assert_eq!(result, CellValue::number(2.0));
    }

    #[test]
    fn test_registry_isnumber_auto_lifted() {
        let reg = FunctionRegistry::new();
        // ISNUMBER({1;"text";3}) -> {TRUE;FALSE;TRUE}
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::Text("text".into())],
            vec![CellValue::number(3.0)],
        ]);
        let result = reg.call("ISNUMBER", &[arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Boolean(true));
                assert_eq!(*arr.get(1, 0).unwrap(), CellValue::Boolean(false));
                assert_eq!(*arr.get(2, 0).unwrap(), CellValue::Boolean(true));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_registry_search_auto_lifted() {
        let reg = FunctionRegistry::new();
        // SEARCH("fox", {"the fox";"no cat";"a fox ran"}) -> {5;#VALUE!;3}
        let arr = CellValue::from_rows(vec![
            vec![CellValue::Text("the fox".into())],
            vec![CellValue::Text("no cat".into())],
            vec![CellValue::Text("a fox ran".into())],
        ]);
        let result = reg.call("SEARCH", &[CellValue::Text("fox".into()), arr]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), 3);
                assert_eq!(*arr.get(0, 0).unwrap(), CellValue::number(5.0));
                assert_eq!(
                    *arr.get(1, 0).unwrap(),
                    CellValue::Error(CellError::Value, None)
                );
                assert_eq!(*arr.get(2, 0).unwrap(), CellValue::number(3.0));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_registry_no_lift_for_array_returning_functions() {
        let reg = FunctionRegistry::new();
        // Verify that returns_array() is correct for key functions
        assert!(reg.returns_array("SORT"));
        assert!(reg.returns_array("FILTER"));
        assert!(reg.returns_array("UNIQUE"));
        assert!(!reg.returns_array("ABS"));
        assert!(!reg.returns_array("ISNUMBER"));
    }

    #[test]
    fn test_text_array_lift_1000_elements() {
        let reg = FunctionRegistry::new();
        let n = 1000;
        let numbers: Vec<Vec<CellValue>> =
            (0..n).map(|i| vec![CellValue::number(i as f64)]).collect();
        let arr = CellValue::from_rows(numbers);
        let format_arg = CellValue::Text("@".into());

        let result = reg.call("TEXT", &[arr, format_arg]);
        match result {
            CellValue::Array(arr) => {
                assert_eq!(arr.rows(), n);
                assert_eq!(arr.cols(), 1);
                assert_eq!(*arr.get(0, 0).unwrap(), CellValue::Text("0".into()));
                assert_eq!(*arr.get(42, 0).unwrap(), CellValue::Text("42".into()));
                assert_eq!(*arr.get(999, 0).unwrap(), CellValue::Text("999".into()));
                for i in 0..n {
                    match arr.get(i, 0).unwrap() {
                        CellValue::Text(_) => {}
                        other => panic!("Element {} expected Text, got {:?}", i, other),
                    }
                }
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    // =================================================================
    // EDGE-CASE TESTS: Excel function dispatch semantics from first
    // principles. Tests grouped by Excel behavioral contract.
    // =================================================================

    // -----------------------------------------------------------------
    // Argument count validation
    // -----------------------------------------------------------------

    #[test]
    fn test_too_few_args_returns_value_error() {
        let reg = FunctionRegistry::new();
        // ABS requires 1 arg, call with 0
        assert_eq!(
            reg.call("ABS", &[]),
            CellValue::Error(CellError::Value, None)
        );
        // ROUND requires at least 1 arg
        assert_eq!(
            reg.call("ROUND", &[]),
            CellValue::Error(CellError::Value, None)
        );
        // MOD requires 2 args
        assert_eq!(
            reg.call("MOD", &[CellValue::number(10.0)]),
            CellValue::Error(CellError::Value, None)
        );
        // TEXT requires 2 args
        assert_eq!(
            reg.call("TEXT", &[CellValue::number(1.0)]),
            CellValue::Error(CellError::Value, None)
        );
    }

    #[test]
    fn test_too_many_args_returns_value_error() {
        let reg = FunctionRegistry::new();
        // ABS takes exactly 1 arg
        assert_eq!(
            reg.call("ABS", &[CellValue::number(1.0), CellValue::number(2.0)]),
            CellValue::Error(CellError::Value, None)
        );
        // ROUND takes at most 2 args
        assert_eq!(
            reg.call(
                "ROUND",
                &[
                    CellValue::number(1.5),
                    CellValue::number(0.0),
                    CellValue::number(99.0)
                ]
            ),
            CellValue::Error(CellError::Value, None)
        );
        // LEN takes exactly 1 arg
        assert_eq!(
            reg.call(
                "LEN",
                &[CellValue::Text("a".into()), CellValue::Text("b".into())]
            ),
            CellValue::Error(CellError::Value, None)
        );
    }

    #[test]
    fn test_exact_min_args_works() {
        let reg = FunctionRegistry::new();
        // ABS(1) = 1 -- exactly min_args=1
        assert_eq!(
            reg.call("ABS", &[CellValue::number(-7.0)]),
            CellValue::number(7.0)
        );
        // ROUND(1.5) with only 1 arg (min_args=1, digits defaults to 0 in impl)
        assert_eq!(
            reg.call("ROUND", &[CellValue::number(1.5)]),
            CellValue::number(2.0)
        );
    }

    #[test]
    fn test_exact_max_args_works() {
        let reg = FunctionRegistry::new();
        // ROUND(1.567, 2) -- exactly max_args=2
        assert_eq!(
            reg.call("ROUND", &[CellValue::number(1.567), CellValue::number(2.0)]),
            CellValue::number(1.57)
        );
        // MOD(10, 3) -- exactly 2 args
        assert_eq!(
            reg.call("MOD", &[CellValue::number(10.0), CellValue::number(3.0)]),
            CellValue::number(1.0)
        );
    }

    #[test]
    fn test_variadic_functions_accept_many_args() {
        let reg = FunctionRegistry::new();
        // CONCATENATE is variadic (max_args = None), should accept many args
        let result = reg.call(
            "CONCATENATE",
            &[
                CellValue::Text("a".into()),
                CellValue::Text("b".into()),
                CellValue::Text("c".into()),
                CellValue::Text("d".into()),
                CellValue::Text("e".into()),
            ],
        );
        assert_eq!(result, CellValue::Text("abcde".into()));

        // SUMSQ is variadic, accepts many numeric args
        let result = reg.call(
            "SUMSQ",
            &[
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
            ],
        );
        assert_eq!(result, CellValue::number(14.0)); // 1+4+9
    }

    #[test]
    fn test_countif_too_few_args() {
        let reg = FunctionRegistry::new();
        // COUNTIF requires 2 args (min_args=2)
        let arr = CellValue::from_rows(vec![vec![CellValue::number(1.0)]]);
        assert_eq!(
            reg.call("COUNTIF", &[arr]),
            CellValue::Error(CellError::Value, None)
        );
    }

    #[test]
    fn test_countif_too_many_args() {
        let reg = FunctionRegistry::new();
        // COUNTIF takes exactly 2 args (max_args=2)
        let arr = CellValue::from_rows(vec![vec![CellValue::number(1.0)]]);
        assert_eq!(
            reg.call(
                "COUNTIF",
                &[arr, CellValue::number(1.0), CellValue::number(99.0)]
            ),
            CellValue::Error(CellError::Value, None)
        );
    }

    // -----------------------------------------------------------------
    // Error propagation -- PureFunction (all args propagate)
    // -----------------------------------------------------------------

    #[test]
    fn test_pure_abs_propagates_div0() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("ABS", &[CellValue::Error(CellError::Div0, None)]),
            CellValue::Error(CellError::Div0, None)
        );
    }

    #[test]
    fn test_pure_abs_propagates_na() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("ABS", &[CellValue::Error(CellError::Na, None)]),
            CellValue::Error(CellError::Na, None)
        );
    }

    #[test]
    fn test_pure_abs_propagates_ref() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("ABS", &[CellValue::Error(CellError::Ref, None)]),
            CellValue::Error(CellError::Ref, None)
        );
    }

    #[test]
    fn test_pure_round_propagates_first_arg_error() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call(
                "ROUND",
                &[
                    CellValue::Error(CellError::Value, None),
                    CellValue::number(2.0)
                ]
            ),
            CellValue::Error(CellError::Value, None)
        );
    }

    #[test]
    fn test_pure_round_propagates_second_arg_error() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call(
                "ROUND",
                &[
                    CellValue::number(1.5),
                    CellValue::Error(CellError::Num, None)
                ]
            ),
            CellValue::Error(CellError::Num, None)
        );
    }

    #[test]
    fn test_pure_concatenate_propagates_first_error() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call(
                "CONCATENATE",
                &[
                    CellValue::Text("a".into()),
                    CellValue::Error(CellError::Na, None),
                    CellValue::Text("c".into()),
                ]
            ),
            CellValue::Error(CellError::Na, None)
        );
    }

    #[test]
    fn test_pure_mod_propagates_error() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call(
                "MOD",
                &[
                    CellValue::Error(CellError::Ref, None),
                    CellValue::number(3.0)
                ]
            ),
            CellValue::Error(CellError::Ref, None)
        );
    }

    #[test]
    fn test_all_error_variants_propagate_through_pure_function() {
        let reg = FunctionRegistry::new();
        let errors = [
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
        ];
        for err in &errors {
            let result = reg.call("ABS", &[CellValue::Error(*err, None)]);
            assert_eq!(
                result,
                CellValue::Error(*err, None),
                "ABS should propagate {:?} unchanged",
                err
            );
        }
    }

    // -----------------------------------------------------------------
    // Error propagation -- ExcelFunction (role-based)
    // -----------------------------------------------------------------

    #[test]
    fn test_excel_countif_range_error_propagates() {
        let reg = FunctionRegistry::new();
        // COUNTIF(#REF!, ">5") -- Range arg has error, should propagate
        assert_eq!(
            reg.call(
                "COUNTIF",
                &[
                    CellValue::Error(CellError::Ref, None),
                    CellValue::Text(">5".into())
                ]
            ),
            CellValue::Error(CellError::Ref, None)
        );
    }

    #[test]
    fn test_excel_countif_criteria_error_does_not_propagate() {
        let reg = FunctionRegistry::new();
        // COUNTIF({1,2,#N/A,2}, #N/A) -- Criteria role does NOT propagate.
        // Should count cells matching #N/A.
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::Error(CellError::Na, None)],
            vec![CellValue::number(2.0)],
        ]);
        let result = reg.call("COUNTIF", &[arr, CellValue::Error(CellError::Na, None)]);
        assert_eq!(result, CellValue::number(1.0));
    }

    #[test]
    fn test_excel_countif_range_div0_propagates() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call(
                "COUNTIF",
                &[
                    CellValue::Error(CellError::Div0, None),
                    CellValue::number(1.0)
                ]
            ),
            CellValue::Error(CellError::Div0, None)
        );
    }

    #[test]
    fn test_all_error_variants_propagate_through_range_role() {
        let reg = FunctionRegistry::new();
        let errors = [
            CellError::Div0,
            CellError::Na,
            CellError::Name,
            CellError::Null,
            CellError::Num,
            CellError::Ref,
            CellError::Value,
        ];
        for err in &errors {
            let result = reg.call(
                "COUNTIF",
                &[CellValue::Error(*err, None), CellValue::number(1.0)],
            );
            assert_eq!(
                result,
                CellValue::Error(*err, None),
                "COUNTIF Range arg should propagate {:?}",
                err
            );
        }
    }

    #[test]
    fn test_excel_sumifs_sum_range_error_propagates() {
        let reg = FunctionRegistry::new();
        let criteria_range = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        assert_eq!(
            reg.call(
                "SUMIFS",
                &[
                    CellValue::Error(CellError::Ref, None),
                    criteria_range,
                    CellValue::Text(">0".into())
                ]
            ),
            CellValue::Error(CellError::Ref, None)
        );
    }

    #[test]
    fn test_excel_sumifs_criteria_range_error_propagates() {
        let reg = FunctionRegistry::new();
        let sum_range = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        assert_eq!(
            reg.call(
                "SUMIFS",
                &[
                    sum_range,
                    CellValue::Error(CellError::Ref, None),
                    CellValue::Text(">0".into())
                ]
            ),
            CellValue::Error(CellError::Ref, None)
        );
    }

    #[test]
    fn test_excel_sumifs_criteria_error_does_not_propagate() {
        let reg = FunctionRegistry::new();
        let sum_range = CellValue::from_rows(vec![
            vec![CellValue::number(10.0)],
            vec![CellValue::number(20.0)],
            vec![CellValue::number(30.0)],
        ]);
        let criteria_range = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        let result = reg.call(
            "SUMIFS",
            &[
                sum_range,
                criteria_range,
                CellValue::Error(CellError::Na, None),
            ],
        );
        // Key: criteria error does NOT propagate -- result is NOT #N/A
        assert!(
            !matches!(result, CellValue::Error(CellError::Na, _)),
            "SUMIFS criteria error should not propagate, got {:?}",
            result
        );
    }

    // -----------------------------------------------------------------
    // Array auto-lifting -- scalar functions broadcast element-wise
    // -----------------------------------------------------------------

    #[test]
    fn test_abs_array_lift_1d() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::array(
            vec![
                CellValue::number(-1.0),
                CellValue::number(-2.0),
                CellValue::number(-3.0),
            ],
            3,
        );
        let result = reg.call("ABS", &[arr]);
        let expected = CellValue::array(
            vec![
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(3.0),
            ],
            3,
        );
        assert_eq!(result, expected);
    }

    #[test]
    fn test_abs_array_lift_2d_preserves_shape() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(-1.0), CellValue::number(-2.0)],
            vec![CellValue::number(-3.0), CellValue::number(-4.0)],
        ]);
        let result = reg.call("ABS", &[arr]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 2);
                assert_eq!(a.cols(), 2);
                assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(1.0));
                assert_eq!(*a.get(0, 1).unwrap(), CellValue::number(2.0));
                assert_eq!(*a.get(1, 0).unwrap(), CellValue::number(3.0));
                assert_eq!(*a.get(1, 1).unwrap(), CellValue::number(4.0));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_round_first_arg_array_lifted() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.5)],
            vec![CellValue::number(2.5)],
            vec![CellValue::number(3.5)],
        ]);
        let result = reg.call("ROUND", &[arr, CellValue::number(0.0)]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3);
                // Each element should be a rounded number
                for r in 0..3 {
                    assert!(
                        matches!(a.get(r, 0).unwrap(), CellValue::Number(_)),
                        "Row {} expected Number, got {:?}",
                        r,
                        a.get(r, 0).unwrap()
                    );
                }
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_text_first_arg_lifted_second_stays() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        let result = reg.call("TEXT", &[arr, CellValue::Text("0.00".into())]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3);
                assert_eq!(*a.get(0, 0).unwrap(), CellValue::Text("1.00".into()));
                assert_eq!(*a.get(1, 0).unwrap(), CellValue::Text("2.00".into()));
                assert_eq!(*a.get(2, 0).unwrap(), CellValue::Text("3.00".into()));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_aggregate_does_not_auto_lift() {
        let reg = FunctionRegistry::new();
        // SUMSQ({1,4,9}) = 1+16+81 = 98 -- processes array as aggregate
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(4.0)],
            vec![CellValue::number(9.0)],
        ]);
        assert_eq!(reg.call("SUMSQ", &[arr]), CellValue::number(98.0));
    }

    #[test]
    fn test_countif_range_not_auto_lifted() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(2.0)],
        ]);
        assert_eq!(
            reg.call("COUNTIF", &[arr, CellValue::number(2.0)]),
            CellValue::number(3.0)
        );
    }

    #[test]
    fn test_sign_array_lift() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::array(
            vec![
                CellValue::number(-5.0),
                CellValue::number(0.0),
                CellValue::number(7.0),
            ],
            3,
        );
        let expected = CellValue::array(
            vec![
                CellValue::number(-1.0),
                CellValue::number(0.0),
                CellValue::number(1.0),
            ],
            3,
        );
        assert_eq!(reg.call("SIGN", &[arr]), expected);
    }

    #[test]
    fn test_len_array_lift() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::Text("hi".into())],
            vec![CellValue::Text("hello".into())],
            vec![CellValue::Text("x".into())],
        ]);
        let result = reg.call("LEN", &[arr]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3);
                assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(2.0));
                assert_eq!(*a.get(1, 0).unwrap(), CellValue::number(5.0));
                assert_eq!(*a.get(2, 0).unwrap(), CellValue::number(1.0));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_mod_first_arg_array_lifted() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::array(
            vec![
                CellValue::number(10.0),
                CellValue::number(11.0),
                CellValue::number(12.0),
            ],
            3,
        );
        let expected = CellValue::array(
            vec![
                CellValue::number(1.0),
                CellValue::number(2.0),
                CellValue::number(0.0),
            ],
            3,
        );
        assert_eq!(reg.call("MOD", &[arr, CellValue::number(3.0)]), expected);
    }

    #[test]
    fn test_abs_array_lift_with_error_element() {
        let reg = FunctionRegistry::new();
        // ABS({-1, #DIV/0!, 3}) -- error element should produce error in that position
        let arr = CellValue::array(
            vec![
                CellValue::number(-1.0),
                CellValue::Error(CellError::Div0, None),
                CellValue::number(3.0),
            ],
            3,
        );
        let result = reg.call("ABS", &[arr]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.len(), 3);
                assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(1.0));
                assert_eq!(
                    *a.get(0, 1).unwrap(),
                    CellValue::Error(CellError::Div0, None)
                );
                assert_eq!(*a.get(0, 2).unwrap(), CellValue::number(3.0));
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_abs_3x3_array_preserves_shape() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![
                CellValue::number(-1.0),
                CellValue::number(-2.0),
                CellValue::number(-3.0),
            ],
            vec![
                CellValue::number(-4.0),
                CellValue::number(-5.0),
                CellValue::number(-6.0),
            ],
            vec![
                CellValue::number(-7.0),
                CellValue::number(-8.0),
                CellValue::number(-9.0),
            ],
        ]);
        let result = reg.call("ABS", &[arr]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3);
                assert_eq!(a.cols(), 3);
                for r in 0..3 {
                    for c in 0..3 {
                        let expected = (r * 3 + c + 1) as f64;
                        assert_eq!(
                            *a.get(r, c).unwrap(),
                            CellValue::number(expected),
                            "Mismatch at ({}, {})",
                            r,
                            c
                        );
                    }
                }
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    // -----------------------------------------------------------------
    // Default arguments
    // -----------------------------------------------------------------

    #[test]
    fn test_left_default_num_chars_metadata() {
        let reg = FunctionRegistry::new();
        let (_, func) = reg.get_by_name("LEFT").unwrap();
        assert_eq!(func.default_for_arg(1), Some(CellValue::number(1.0)));
        assert_eq!(func.default_for_arg(0), None);
        assert_eq!(func.default_for_arg(2), None);
    }

    #[test]
    fn test_left_with_one_arg_uses_default() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("LEFT", &[CellValue::Text("Hello".into())]),
            CellValue::Text("H".into())
        );
    }

    #[test]
    fn test_round_with_one_arg_defaults_digits_to_zero() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("ROUND", &[CellValue::number(2.7)]),
            CellValue::number(3.0)
        );
    }

    #[test]
    fn test_functions_without_defaults_return_none() {
        let reg = FunctionRegistry::new();
        let (_, f) = reg.get_by_name("ABS").unwrap();
        assert_eq!(f.default_for_arg(0), None);
        let (_, f) = reg.get_by_name("MOD").unwrap();
        assert_eq!(f.default_for_arg(0), None);
        assert_eq!(f.default_for_arg(1), None);
    }

    // -----------------------------------------------------------------
    // Unknown function -> #NAME!
    // -----------------------------------------------------------------

    #[test]
    fn test_unknown_function_returns_name_error() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("XYZZY", &[CellValue::number(1.0)]),
            CellValue::Error(CellError::Name, None)
        );
        assert_eq!(
            reg.call("NOTAFUNCTION", &[]),
            CellValue::Error(CellError::Name, None)
        );
        assert_eq!(reg.call("", &[]), CellValue::Error(CellError::Name, None));
    }

    #[test]
    fn test_unknown_function_lookup_returns_none() {
        let reg = FunctionRegistry::new();
        assert!(reg.get_by_name("XYZZY").is_none());
        assert!(reg.get_by_name("").is_none());
    }

    #[test]
    fn test_unsupported_stubs_are_not_registered() {
        let reg = FunctionRegistry::new();
        for name in [
            "FORMULATEXT",
            "FORECAST.ETS",
            "FORECAST.ETS.CONFINT",
            "FORECAST.ETS.SEASONALITY",
            "FORECAST.ETS.STAT",
        ] {
            assert!(
                reg.get_by_name(name).is_none(),
                "{name} must not be advertised as implemented"
            );
            assert_eq!(reg.call(name, &[]), CellValue::Error(CellError::Name, None));
        }
    }

    // -----------------------------------------------------------------
    // Volatile function detection
    // -----------------------------------------------------------------

    #[test]
    fn test_volatile_rand_randbetween() {
        let reg = FunctionRegistry::new();
        assert!(reg.is_volatile("RAND"));
        assert!(reg.is_volatile("RANDBETWEEN"));
        assert!(reg.is_volatile("RANDARRAY"));
        assert!(crate::helpers::VOLATILE_FUNCTIONS.contains(&"RANDARRAY"));
    }

    #[test]
    fn test_non_volatile_standard_functions() {
        let reg = FunctionRegistry::new();
        assert!(!reg.is_volatile("ABS"));
        assert!(!reg.is_volatile("ROUND"));
        assert!(!reg.is_volatile("LEN"));
        assert!(!reg.is_volatile("CONCATENATE"));
        assert!(!reg.is_volatile("COUNTIF"));
        assert!(!reg.is_volatile("IF"));
        assert!(!reg.is_volatile("MOD"));
    }

    #[test]
    fn test_volatile_unknown_returns_false() {
        let reg = FunctionRegistry::new();
        assert!(!reg.is_volatile("DOESNOTEXIST"));
    }

    // -----------------------------------------------------------------
    // Array-returning function detection
    // -----------------------------------------------------------------

    #[test]
    fn test_array_returning_sort_filter_unique_sequence() {
        let reg = FunctionRegistry::new();
        assert!(reg.returns_array("SORT"));
        assert!(reg.returns_array("FILTER"));
        assert!(reg.returns_array("UNIQUE"));
        assert!(reg.returns_array("SEQUENCE"));
    }

    #[test]
    fn test_scalar_functions_do_not_return_array() {
        let reg = FunctionRegistry::new();
        assert!(!reg.returns_array("ABS"));
        assert!(!reg.returns_array("ROUND"));
        assert!(!reg.returns_array("TEXT"));
        assert!(!reg.returns_array("LEN"));
        assert!(!reg.returns_array("MOD"));
        assert!(!reg.returns_array("COUNTIF"));
    }

    #[test]
    fn test_returns_array_unknown_returns_false() {
        let reg = FunctionRegistry::new();
        assert!(!reg.returns_array("DOESNOTEXIST"));
    }

    // -----------------------------------------------------------------
    // Array-returning functions skip auto-lifting
    // -----------------------------------------------------------------

    #[test]
    fn test_sort_does_not_auto_lift() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(3.0)],
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
        ]);
        let result = reg.call("SORT", &[arr]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3);
                assert_eq!(*a.get(0, 0).unwrap(), CellValue::number(1.0));
                assert_eq!(*a.get(1, 0).unwrap(), CellValue::number(2.0));
                assert_eq!(*a.get(2, 0).unwrap(), CellValue::number(3.0));
            }
            other => panic!("Expected sorted Array, got {:?}", other),
        }
    }

    // -----------------------------------------------------------------
    // Case-insensitive lookup edge cases
    // -----------------------------------------------------------------

    #[test]
    fn test_case_insensitive_all_lower() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("abs", &[CellValue::number(-3.0)]),
            CellValue::number(3.0)
        );
    }

    #[test]
    fn test_case_insensitive_mixed_case() {
        let reg = FunctionRegistry::new();
        assert_eq!(
            reg.call("AbS", &[CellValue::number(-3.0)]),
            CellValue::number(3.0)
        );
    }

    #[test]
    fn test_case_insensitive_countif() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
        ]);
        assert_eq!(
            reg.call("countif", &[arr, CellValue::number(1.0)]),
            CellValue::number(1.0)
        );
    }

    // -----------------------------------------------------------------
    // Min/max args metadata consistency
    // -----------------------------------------------------------------

    #[test]
    fn test_min_max_args_metadata() {
        let reg = FunctionRegistry::new();

        let (_, f) = reg.get_by_name("ABS").unwrap();
        assert_eq!(f.min_args(), 1);
        assert_eq!(f.max_args(), Some(1));

        let (_, f) = reg.get_by_name("ROUND").unwrap();
        assert_eq!(f.min_args(), 1);
        assert_eq!(f.max_args(), Some(2));

        let (_, f) = reg.get_by_name("CONCATENATE").unwrap();
        assert_eq!(f.min_args(), 1);
        assert_eq!(f.max_args(), None);

        let (_, f) = reg.get_by_name("COUNTIF").unwrap();
        assert_eq!(f.min_args(), 2);
        assert_eq!(f.max_args(), Some(2));
    }

    // -----------------------------------------------------------------
    // Boundary: empty and null ranges
    // -----------------------------------------------------------------

    #[test]
    fn test_countblank_all_nulls() {
        let reg = FunctionRegistry::new();
        let arr = CellValue::from_rows(vec![
            vec![CellValue::Null],
            vec![CellValue::Null],
            vec![CellValue::Null],
        ]);
        assert_eq!(reg.call("COUNTBLANK", &[arr]), CellValue::number(3.0));
    }

    // -----------------------------------------------------------------
    // get_by_id round-trip
    // -----------------------------------------------------------------

    #[test]
    fn test_get_by_id_roundtrip_multiple_functions() {
        let reg = FunctionRegistry::new();
        for name in &["ABS", "ROUND", "LEN", "COUNTIF", "CONCATENATE", "MOD"] {
            let (id, _) = reg.get_by_name(name).unwrap();
            let func = reg.get_by_id(id).unwrap();
            assert_eq!(func.name(), *name, "Round-trip failed for {}", name);
        }
    }

    #[test]
    fn test_get_by_id_out_of_range() {
        let reg = FunctionRegistry::new();
        assert!(reg.get_by_id(u16::MAX).is_none());
    }

    // -----------------------------------------------------------------
    // Multi-array broadcasting in try_array_lift
    // -----------------------------------------------------------------

    #[test]
    fn test_date_multi_array_broadcast_column() {
        // DATE({2024;2024;2024}, {1;2;3}, 1) should produce element-wise results,
        // NOT a cross-product / nested array.
        let reg = FunctionRegistry::new();
        let years = CellValue::from_rows(vec![
            vec![CellValue::number(2024.0)],
            vec![CellValue::number(2024.0)],
            vec![CellValue::number(2024.0)],
        ]);
        let months = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        let result = reg.call("DATE", &[years, months, CellValue::number(1.0)]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3, "Expected 3 rows, got {}", a.rows());
                assert_eq!(a.cols(), 1, "Expected 1 col, got {}", a.cols());
                // All results should be flat Number values, not nested arrays
                for r in 0..3 {
                    assert!(
                        matches!(a.get(r, 0).unwrap(), CellValue::Number(_)),
                        "Row {} expected Number, got {:?}",
                        r,
                        a.get(r, 0).unwrap()
                    );
                }
                // Each row's date serial should be different (Jan, Feb, Mar 2024)
                let v0 = a.get(0, 0).unwrap().coerce_to_number().unwrap();
                let v1 = a.get(1, 0).unwrap().coerce_to_number().unwrap();
                let v2 = a.get(2, 0).unwrap().coerce_to_number().unwrap();
                assert!(
                    v0 < v1 && v1 < v2,
                    "Dates should be ascending: {} < {} < {}",
                    v0,
                    v1,
                    v2
                );
                // Jan-Feb difference should be 31 days
                assert_eq!(v1 - v0, 31.0);
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_date_multi_array_broadcast_row() {
        // DATE({2024, 2025}, {6, 12}, {1, 15}) — 1×2 row arrays
        let reg = FunctionRegistry::new();
        let years = CellValue::array(
            vec![CellValue::number(2024.0), CellValue::number(2025.0)],
            2,
        );
        let months = CellValue::array(vec![CellValue::number(6.0), CellValue::number(12.0)], 2);
        let days = CellValue::array(vec![CellValue::number(1.0), CellValue::number(15.0)], 2);
        let result = reg.call("DATE", &[years, months, days]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 1);
                assert_eq!(a.cols(), 2);
                // Both elements should be flat numbers
                assert!(matches!(a.get(0, 0).unwrap(), CellValue::Number(_)));
                assert!(matches!(a.get(0, 1).unwrap(), CellValue::Number(_)));
                // Second date (2025-12-15) should be after first (2024-06-01)
                let v0 = a.get(0, 0).unwrap().coerce_to_number().unwrap();
                let v1 = a.get(0, 1).unwrap().coerce_to_number().unwrap();
                assert!(v1 > v0);
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_date_mixed_array_scalar_broadcast() {
        // DATE(2024, {1;2;3}, 1) — scalar year, array months, scalar day
        // This tests the single-array fast path still works
        let reg = FunctionRegistry::new();
        let months = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        let result = reg.call(
            "DATE",
            &[CellValue::number(2024.0), months, CellValue::number(1.0)],
        );
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3);
                assert_eq!(a.cols(), 1);
                let v0 = a.get(0, 0).unwrap().coerce_to_number().unwrap();
                let v1 = a.get(1, 0).unwrap().coerce_to_number().unwrap();
                let v2 = a.get(2, 0).unwrap().coerce_to_number().unwrap();
                assert_eq!(v1 - v0, 31.0); // Jan→Feb = 31 days
                assert!(v2 > v1);
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }

    #[test]
    fn test_multi_array_dimension_mismatch_returns_error() {
        // DATE({2024;2025}, {1;2;3}, 1) — 2-row vs 3-row → #VALUE!
        let reg = FunctionRegistry::new();
        let years = CellValue::from_rows(vec![
            vec![CellValue::number(2024.0)],
            vec![CellValue::number(2025.0)],
        ]);
        let months = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        let result = reg.call("DATE", &[years, months, CellValue::number(1.0)]);
        assert_eq!(result, CellValue::Error(CellError::Value, None));
    }

    #[test]
    fn test_multi_array_broadcast_scalar_dimension() {
        // DATE({2024}, {1;2;3}, 1) — 1-row array broadcasts with 3-row array
        let reg = FunctionRegistry::new();
        let years = CellValue::from_rows(vec![vec![CellValue::number(2024.0)]]);
        let months = CellValue::from_rows(vec![
            vec![CellValue::number(1.0)],
            vec![CellValue::number(2.0)],
            vec![CellValue::number(3.0)],
        ]);
        let result = reg.call("DATE", &[years, months, CellValue::number(1.0)]);
        match &result {
            CellValue::Array(a) => {
                assert_eq!(a.rows(), 3, "1-row should broadcast to 3 rows");
                assert_eq!(a.cols(), 1);
                for r in 0..3 {
                    assert!(
                        matches!(a.get(r, 0).unwrap(), CellValue::Number(_)),
                        "Row {} expected Number, got {:?}",
                        r,
                        a.get(r, 0).unwrap()
                    );
                }
            }
            other => panic!("Expected Array, got {:?}", other),
        }
    }
}
