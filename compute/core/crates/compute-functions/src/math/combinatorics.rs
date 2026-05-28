//! Combinatorics functions: FACT, FACTDOUBLE, COMBIN, COMBINA, PERMUT,
//! PERMUTATIONA, GCD, LCM, MULTINOMIAL

use value_types::{CellError, CellValue};

use crate::helpers::coercion::{check_error, flatten_values};
use crate::{FunctionRegistry, PureFunction};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// ln(Gamma(x+1)) ~ ln(x!) using the Lanczos approximation.
fn ln_gamma(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let g = 7.0_f64;
    let c = [
        0.999_999_999_999_809_9,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];

    if x < 0.5 {
        let pi = std::f64::consts::PI;
        return (pi / (pi * x).sin()).ln() - ln_gamma(1.0 - x);
    }

    let x = x - 1.0;
    let mut sum = c[0];
    for (i, &coeff) in c.iter().enumerate().skip(1) {
        sum += coeff / (x + i as f64);
    }
    let t = x + g + 0.5;
    0.5 * (2.0 * std::f64::consts::PI).ln() + (t.ln() * (x + 0.5)) - t + sum.ln()
}

/// Binomial coefficient C(n, k)
fn binomial_coefficient(n: i64, k: i64) -> f64 {
    if k > n || k < 0 || n < 0 {
        return 0.0;
    }
    if k == 0 || k == n {
        return 1.0;
    }
    let k = k.min(n - k);

    if n <= 20 {
        let mut result = 1.0_f64;
        for i in 0..k {
            result *= (n - i) as f64 / (i + 1) as f64;
        }
        result.round()
    } else {
        (ln_gamma((n + 1) as f64) - ln_gamma((k + 1) as f64) - ln_gamma((n - k + 1) as f64))
            .exp()
            .round()
    }
}

/// GCD of two numbers using Euclidean algorithm
pub(super) fn gcd_two(mut a: i64, mut b: i64) -> i64 {
    a = a.abs();
    b = b.abs();
    while b != 0 {
        let temp = b;
        b = a % b;
        a = temp;
    }
    a
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

pub(super) struct FnFact;
impl PureFunction for FnFact {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FACT"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if n < 0.0 => CellValue::error_with_message(
                CellError::Num,
                format!("FACT: number ({n}) must be non-negative"),
            ),
            Ok(n) => {
                let n = n.floor() as u64;
                if n > 170 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("FACT: number ({n}) too large, maximum is 170"),
                    );
                }
                let mut result = 1.0_f64;
                for i in 2..=n {
                    result *= i as f64;
                }
                CellValue::number(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnFactDouble;
impl PureFunction for FnFactDouble {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "FACTDOUBLE"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        Some(1)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        match args[0].coerce_to_number() {
            Ok(n) if n < -1.0 => CellValue::error_with_message(
                CellError::Num,
                format!("FACTDOUBLE: number ({n}) must be >= -1"),
            ),
            Ok(n) => {
                let n = n as i64;
                // (-1)!! = 1 by convention (base case of double factorial)
                if n == -1 || n == 0 || n == 1 {
                    return CellValue::number(1.0);
                }
                if n > 300 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("FACTDOUBLE: number ({n}) too large, maximum is 300"),
                    );
                }
                let mut result = 1.0_f64;
                let mut i = n;
                while i > 0 {
                    result *= i as f64;
                    if result.is_infinite() {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("FACTDOUBLE: result overflow for number ({n})"),
                        );
                    }
                    i -= 2;
                }
                CellValue::number(result)
            }
            Err(e) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCombin;
impl PureFunction for FnCombin {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COMBIN"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(n), Ok(k)) => {
                let n_int = n as i64;
                let k_int = k as i64;
                if n_int < 0 || k_int < 0 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "COMBIN: number ({n_int}) and number_chosen ({k_int}) must be non-negative"
                        ),
                    );
                }
                if k_int > n_int {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("COMBIN: number ({n_int}) must be >= number_chosen ({k_int})"),
                    );
                }
                if n_int > 1030 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("COMBIN: number ({n_int}) too large, maximum is 1030"),
                    );
                }
                let result = binomial_coefficient(n_int, k_int);
                if result.is_infinite() {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("COMBIN: result overflow for C({n_int}, {k_int})"),
                    )
                } else {
                    CellValue::number(result)
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnCombinA;
impl PureFunction for FnCombinA {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "COMBINA"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(n), Ok(k)) => {
                let n_int = n as i64;
                let k_int = k as i64;
                if n_int < 1 || k_int < 0 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "COMBINA: number ({n_int}) must be >= 1 and number_chosen ({k_int}) must be non-negative"
                        ),
                    );
                }
                if n_int + k_int - 1 > 1030 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "COMBINA: number + number_chosen - 1 ({}) too large, maximum is 1030",
                            n_int + k_int - 1
                        ),
                    );
                }
                // COMBINA(n, k) = COMBIN(n + k - 1, k)
                let result = binomial_coefficient(n_int + k_int - 1, k_int);
                if result.is_infinite() {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("COMBINA: result overflow for COMBINA({n_int}, {k_int})"),
                    )
                } else {
                    CellValue::number(result)
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnPermut;
impl PureFunction for FnPermut {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PERMUT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(n), Ok(k)) => {
                let n_int = n as i64;
                let k_int = k as i64;
                if n_int < 0 || k_int < 0 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "PERMUT: number ({n_int}) and number_chosen ({k_int}) must be non-negative"
                        ),
                    );
                }
                if k_int > n_int {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("PERMUT: number ({n_int}) must be >= number_chosen ({k_int})"),
                    );
                }
                if k_int == 0 {
                    return CellValue::number(1.0);
                }
                if k_int > 170 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!("PERMUT: number_chosen ({k_int}) too large, maximum is 170"),
                    );
                }
                // n! / (n-k)! = n * (n-1) * ... * (n-k+1)
                let mut result = 1.0_f64;
                for i in 0..k_int {
                    result *= (n_int - i) as f64;
                    if result.is_infinite() {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("PERMUT: result overflow for P({n_int}, {k_int})"),
                        );
                    }
                }
                CellValue::number(result)
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnPermutationA;
impl PureFunction for FnPermutationA {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PERMUTATIONA"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        if let Some(e) = check_error(&args[1]) {
            return e;
        }
        match (args[0].coerce_to_number(), args[1].coerce_to_number()) {
            (Ok(n), Ok(k)) => {
                let n_int = n as i64;
                let k_int = k as i64;
                if n_int < 0 || k_int < 0 {
                    return CellValue::error_with_message(
                        CellError::Num,
                        format!(
                            "PERMUTATIONA: number ({n_int}) and number_chosen ({k_int}) must be non-negative"
                        ),
                    );
                }
                let result = (n_int as f64).powf(k_int as f64);
                if result.is_infinite() {
                    CellValue::error_with_message(
                        CellError::Num,
                        format!("PERMUTATIONA: result overflow for {n_int}^{k_int}"),
                    )
                } else {
                    CellValue::number(result)
                }
            }
            (Err(e), _) | (_, Err(e)) => CellValue::Error(e, None),
        }
    }
}

pub(super) struct FnGcd;
impl PureFunction for FnGcd {
    fn name(&self) -> &'static str {
        "GCD"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        let mut nums: Vec<i64> = Vec::new();
        for v in &flat {
            match v {
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                CellValue::Number(n) => {
                    if n.get() < 0.0 {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("GCD: all values must be non-negative, got {}", n.get()),
                        );
                    }
                    nums.push(n.get() as i64);
                }
                CellValue::Boolean(_)
                | CellValue::Control(_)
                | CellValue::Image(_)
                | CellValue::Null => {}
                CellValue::Text(_) => match v.coerce_to_number() {
                    Ok(n) if n < 0.0 => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("GCD: all values must be non-negative, got {n}"),
                        );
                    }
                    Ok(n) => nums.push(n as i64),
                    Err(e) => return CellValue::Error(e, None),
                },
                CellValue::Array(_) => {} // already flattened
            }
        }
        if nums.is_empty() {
            return CellValue::error_with_message(
                CellError::Num,
                "GCD: expected at least one numeric value".to_string(),
            );
        }
        let mut result = nums[0];
        for &num in nums.iter().skip(1) {
            result = gcd_two(result, num);
            if result == 1 {
                break;
            }
        }
        CellValue::number(result as f64)
    }
}

pub(super) struct FnLcm;
impl PureFunction for FnLcm {
    fn name(&self) -> &'static str {
        "LCM"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        let mut nums: Vec<i64> = Vec::new();
        for v in &flat {
            match v {
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                CellValue::Number(n) => {
                    if n.get() < 0.0 {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("LCM: all values must be non-negative, got {}", n.get()),
                        );
                    }
                    let n_int = n.get() as i64;
                    if n_int == 0 {
                        return CellValue::number(0.0);
                    }
                    nums.push(n_int);
                }
                CellValue::Boolean(_)
                | CellValue::Control(_)
                | CellValue::Image(_)
                | CellValue::Null => {}
                CellValue::Text(_) => match v.coerce_to_number() {
                    Ok(n) if n < 0.0 => {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("LCM: all values must be non-negative, got {n}"),
                        );
                    }
                    Ok(n) => {
                        let n_int = n as i64;
                        if n_int == 0 {
                            return CellValue::number(0.0);
                        }
                        nums.push(n_int);
                    }
                    Err(e) => return CellValue::Error(e, None),
                },
                CellValue::Array(_) => {}
            }
        }
        if nums.is_empty() {
            return CellValue::error_with_message(
                CellError::Num,
                "LCM: expected at least one numeric value".to_string(),
            );
        }
        let mut result = nums[0] as f64;
        for &num in nums.iter().skip(1) {
            let g = gcd_two(result as i64, num);
            result = result * num as f64 / g as f64;
            if result.is_infinite() {
                return CellValue::error_with_message(
                    CellError::Num,
                    "LCM: result overflow".to_string(),
                );
            }
        }
        CellValue::number(result)
    }
}

pub(super) struct FnMultinomial;
impl PureFunction for FnMultinomial {
    fn name(&self) -> &'static str {
        "MULTINOMIAL"
    }
    fn min_args(&self) -> usize {
        1
    }
    fn max_args(&self) -> Option<usize> {
        None
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let flat = flatten_values(args);
        let mut nums: Vec<i64> = Vec::new();
        let mut sum: i64 = 0;
        for v in &flat {
            match v {
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                CellValue::Number(n) => {
                    if n.get() < 0.0 {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!(
                                "MULTINOMIAL: all values must be non-negative, got {}",
                                n.get()
                            ),
                        );
                    }
                    let n_int = n.get() as i64;
                    nums.push(n_int);
                    sum += n_int;
                }
                CellValue::Boolean(_) | CellValue::Null => {}
                _ => {}
            }
        }
        if nums.is_empty() {
            return CellValue::error_with_message(
                CellError::Num,
                "MULTINOMIAL: expected at least one numeric value".to_string(),
            );
        }
        // (sum)! / (n1! * n2! * ...)
        let mut log_result = ln_gamma((sum + 1) as f64);
        for n in &nums {
            log_result -= ln_gamma((*n + 1) as f64);
        }
        let result = log_result.exp().round();
        if result.is_infinite() {
            CellValue::error_with_message(
                CellError::Num,
                "MULTINOMIAL: result overflow".to_string(),
            )
        } else {
            CellValue::number(result)
        }
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnFact));
    registry.register(Box::new(FnFactDouble));
    registry.register(Box::new(FnCombin));
    registry.register(Box::new(FnCombinA));
    registry.register(Box::new(FnPermut));
    registry.register(Box::new(FnPermutationA));
    registry.register(Box::new(FnGcd));
    registry.register(Box::new(FnLcm));
    registry.register(Box::new(FnMultinomial));
}
