//! Conversion: EFFECT, NOMINAL, DOLLARDE, DOLLARFR, PDURATION, RRI, EUROCONVERT

use value_types::{CellError, CellValue};

use super::helpers::{err_val, num_or_err_msg, req_num};
use crate::helpers::coercion::check_error;
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// EFFECT
// ===========================================================================

pub(super) struct FnEffect;
impl PureFunction for FnEffect {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "EFFECT"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let nominal_rate = req_num(args, 0).map_err(err_val)?;
            let npery = req_num(args, 1).map_err(err_val)?;
            if nominal_rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("EFFECT: nominal_rate must be > 0, got {nominal_rate}"),
                ));
            }
            if npery < 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("EFFECT: npery must be >= 1, got {npery}"),
                ));
            }
            let npery = npery.floor();
            Ok((1.0 + nominal_rate / npery).powf(npery) - 1.0)
        })())
    }
}

// ===========================================================================
// NOMINAL
// ===========================================================================

pub(super) struct FnNominal;
impl PureFunction for FnNominal {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "NOMINAL"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let effect_rate = req_num(args, 0).map_err(err_val)?;
            let npery = req_num(args, 1).map_err(err_val)?;
            if effect_rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("NOMINAL: effect_rate must be > 0, got {effect_rate}"),
                ));
            }
            if npery < 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("NOMINAL: npery must be >= 1, got {npery}"),
                ));
            }
            let npery = npery.floor();
            Ok(npery * ((1.0 + effect_rate).powf(1.0 / npery) - 1.0))
        })())
    }
}

// ===========================================================================
// DOLLARDE
// ===========================================================================

pub(super) struct FnDollarde;
impl PureFunction for FnDollarde {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DOLLARDE"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let fractional_dollar = req_num(args, 0).map_err(err_val)?;
            let fraction = req_num(args, 1).map_err(err_val)?;
            if fraction < 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DOLLARDE: fraction must be >= 1, got {fraction}"),
                ));
            }
            let fraction_int = fraction.floor();
            let int_part = fractional_dollar.abs().floor();
            let frac_part = fractional_dollar.abs() - int_part;
            let sign = if fractional_dollar < 0.0 { -1.0 } else { 1.0 };
            let log_val = fraction_int.log10();
            let num_digits = if (log_val - log_val.round()).abs() < 1e-10 {
                log_val.round() as i32
            } else {
                log_val.ceil() as i32
            };
            let multiplier = 10f64.powi(num_digits);
            Ok(sign * (int_part + (frac_part * multiplier) / fraction_int))
        })())
    }
}

// ===========================================================================
// DOLLARFR
// ===========================================================================

pub(super) struct FnDollarfr;
impl PureFunction for FnDollarfr {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "DOLLARFR"
    }
    fn min_args(&self) -> usize {
        2
    }
    fn max_args(&self) -> Option<usize> {
        Some(2)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let decimal_dollar = req_num(args, 0).map_err(err_val)?;
            let fraction = req_num(args, 1).map_err(err_val)?;
            if fraction < 1.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("DOLLARFR: fraction must be >= 1, got {fraction}"),
                ));
            }
            let fraction_int = fraction.floor();
            let int_part = decimal_dollar.abs().floor();
            let dec_part = decimal_dollar.abs() - int_part;
            let log_val = fraction_int.log10();
            let num_digits = if (log_val - log_val.round()).abs() < 1e-10 {
                log_val.round() as i32
            } else {
                log_val.ceil() as i32
            };
            let divisor = 10f64.powi(num_digits);
            let frac_numerator = dec_part * fraction_int;
            let sign = if decimal_dollar < 0.0 { -1.0 } else { 1.0 };
            Ok(sign * (int_part + frac_numerator / divisor))
        })())
    }
}

// ===========================================================================
// PDURATION
// ===========================================================================

pub(super) struct FnPduration;
impl PureFunction for FnPduration {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "PDURATION"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let rate = req_num(args, 0).map_err(err_val)?;
            let pv = req_num(args, 1).map_err(err_val)?;
            let fv = req_num(args, 2).map_err(err_val)?;
            if rate <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PDURATION: rate must be > 0, got {rate}"),
                ));
            }
            if pv <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PDURATION: pv must be > 0, got {pv}"),
                ));
            }
            if fv <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("PDURATION: fv must be > 0, got {fv}"),
                ));
            }
            let periods = (fv.ln() - pv.ln()) / (1.0 + rate).ln();
            if !periods.is_finite() {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    "PDURATION: result is not finite",
                ));
            }
            Ok(periods)
        })())
    }
}

// ===========================================================================
// RRI
// ===========================================================================

pub(super) struct FnRri;
impl PureFunction for FnRri {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "RRI"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        num_or_err_msg((|| {
            let nper = req_num(args, 0).map_err(err_val)?;
            let pv = req_num(args, 1).map_err(err_val)?;
            let fv = req_num(args, 2).map_err(err_val)?;
            if nper <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("RRI: nper must be > 0, got {nper}"),
                ));
            }
            if pv <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("RRI: pv must be > 0, got {pv}"),
                ));
            }
            if fv <= 0.0 {
                return Err(CellValue::error_with_message(
                    CellError::Num,
                    format!("RRI: fv must be > 0, got {fv}"),
                ));
            }
            Ok((fv / pv).powf(1.0 / nper) - 1.0)
        })())
    }
}

// ===========================================================================
// EUROCONVERT
// ===========================================================================

/// Official irrevocable Euro conversion rates.
fn euro_rate(currency: &str) -> Option<f64> {
    match currency {
        "EUR" => Some(1.0),
        "ATS" => Some(13.7603),
        "BEF" => Some(40.3399),
        "DEM" => Some(1.95583),
        "ESP" => Some(166.386),
        "FIM" => Some(5.94573),
        "FRF" => Some(6.55957),
        "GRD" => Some(340.75),
        "IEP" => Some(0.787564),
        "ITL" => Some(1936.27),
        "LUF" => Some(40.3399),
        "NLG" => Some(2.20371),
        "PTE" => Some(200.482),
        "SIT" => Some(239.640),
        "CYP" => Some(0.585274),
        "MTL" => Some(0.4293),
        "SKK" => Some(30.1260),
        "EEK" => Some(15.6466),
        "LVL" => Some(0.702804),
        "LTL" => Some(3.45280),
        _ => None,
    }
}

fn is_zero_decimal_currency(currency: &str) -> bool {
    matches!(currency, "ITL" | "GRD" | "ESP" | "PTE")
}

pub(super) struct FnEuroconvert;
impl PureFunction for FnEuroconvert {
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn name(&self) -> &'static str {
        "EUROCONVERT"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(5)
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        if let Some(e) = check_error(&args[0]) {
            return e;
        }
        let amount = match args[0].coerce_to_number() {
            Ok(n) => n,
            Err(e) => return CellValue::Error(e, None),
        };

        let source = match &args[1] {
            CellValue::Text(s) => s.to_uppercase(),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "EUROCONVERT: source_currency must be text",
                );
            }
        };
        let target = match &args[2] {
            CellValue::Text(s) => s.to_uppercase(),
            CellValue::Error(e, _) => return CellValue::Error(*e, None),
            _ => {
                return CellValue::error_with_message(
                    CellError::Value,
                    "EUROCONVERT: target_currency must be text",
                );
            }
        };

        let source_rate = match euro_rate(&source) {
            Some(r) => r,
            None => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("EUROCONVERT: unknown source currency '{source}'"),
                );
            }
        };
        let target_rate = match euro_rate(&target) {
            Some(r) => r,
            None => {
                return CellValue::error_with_message(
                    CellError::Value,
                    format!("EUROCONVERT: unknown target currency '{target}'"),
                );
            }
        };

        let full_precision = if args.len() >= 4 {
            match &args[3] {
                CellValue::Boolean(b) => *b,
                CellValue::Number(n) => n.get() != 0.0,
                CellValue::Null => false,
                CellValue::Error(e, _) => return CellValue::Error(*e, None),
                _ => false,
            }
        } else {
            false
        };

        let tri_precision = if args.len() >= 5 {
            match args[4].coerce_to_number() {
                Ok(n) => {
                    let p = n.floor() as i32;
                    if !(0..=15).contains(&p) {
                        return CellValue::error_with_message(
                            CellError::Num,
                            format!("EUROCONVERT: precision must be 0..15, got {p}"),
                        );
                    }
                    p
                }
                Err(e) => return CellValue::Error(e, None),
            }
        } else {
            3
        };

        if source == target {
            return CellValue::number(amount);
        }

        // Convert to EUR
        let euro_amount = if source == "EUR" {
            amount
        } else {
            let e = amount / source_rate;
            if full_precision {
                e
            } else {
                let factor = 10f64.powi(tri_precision);
                (e * factor).round() / factor
            }
        };

        // Convert from EUR to target
        let mut result = if target == "EUR" {
            euro_amount
        } else {
            euro_amount * target_rate
        };

        if !full_precision {
            let decimals = if is_zero_decimal_currency(&target) {
                0
            } else {
                2
            };
            let factor = 10f64.powi(decimals);
            result = (result * factor).round() / factor;
        }

        CellValue::number(result)
    }
}

pub(super) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnDollarde));
    registry.register(Box::new(FnDollarfr));
    registry.register(Box::new(FnEffect));
    registry.register(Box::new(FnNominal));
    registry.register(Box::new(FnPduration));
    registry.register(Box::new(FnRri));
    registry.register(Box::new(FnEuroconvert));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PureFunction;
    use value_types::{CellError, CellValue};

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn err(e: CellError) -> CellValue {
        CellValue::Error(e, None)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    fn approx(a: &CellValue, expected: f64, tol: f64) -> bool {
        match a {
            CellValue::Number(n) => (n.get() - expected).abs() < tol,
            _ => false,
        }
    }

    #[test]
    fn test_effect() {
        let r = FnEffect.call(&[num(0.12), num(12.0)]);
        assert!(approx(&r, 0.126825, 0.0001));
    }

    #[test]
    fn test_nominal() {
        let r = FnNominal.call(&[num(0.126825), num(12.0)]);
        assert!(approx(&r, 0.12, 0.001));
    }

    #[test]
    fn test_rri() {
        let r = FnRri.call(&[num(10.0), num(1000.0), num(2000.0)]);
        // (2000/1000)^(1/10) - 1 = 0.07177
        assert!(approx(&r, 0.07177, 0.001));
    }

    #[test]
    fn test_pduration() {
        let r = FnPduration.call(&[num(0.10), num(1000.0), num(2000.0)]);
        // log(2000/1000) / log(1.10) = 7.27
        assert!(approx(&r, 7.27, 0.01));
    }

    #[test]
    fn test_dollarde_fraction_10() {
        // DOLLARDE(1.1, 10) should return 1.1 (1 + 0.1*10/10 = 1.1)
        // fraction_int=10, log10(10)=1.0, num_digits=1, multiplier=10
        // frac_part = 0.1, result = 1 + (0.1 * 10) / 10 = 1.1
        let r = FnDollarde.call(&[num(1.1), num(10.0)]);
        match &r {
            CellValue::Number(n) => assert!(
                (n.get() - 1.1).abs() < 0.001,
                "DOLLARDE(1.1, 10) = {}, expected 1.1",
                n.get()
            ),
            _ => panic!("Expected number, got {:?}", r),
        }
    }

    #[test]
    fn test_euroconvert_same() {
        let r = FnEuroconvert.call(&[num(100.0), text("EUR"), text("EUR")]);
        assert_eq!(r, num(100.0));
    }

    #[test]
    fn test_euroconvert_dem_to_eur() {
        // 100 DEM -> EUR: 100 / 1.95583 = 51.13
        let r = FnEuroconvert.call(&[num(100.0), text("DEM"), text("EUR")]);
        assert!(approx(&r, 51.13, 0.01));
    }

    #[test]
    fn test_euroconvert_invalid_currency() {
        let r = FnEuroconvert.call(&[num(100.0), text("USD"), text("EUR")]);
        assert_eq!(r, err(CellError::Value));
    }

    #[test]
    fn test_euroconvert_new_currencies() {
        // SIT -> EUR: 100 / 239.640
        let r = FnEuroconvert.call(&[num(100.0), text("SIT"), text("EUR")]);
        match &r {
            CellValue::Number(n) => assert!(
                n.get() > 0.0,
                "SIT conversion should produce positive number"
            ),
            _ => panic!("Expected number for SIT, got {:?}", r),
        }
        // LTL -> EUR: 100 / 3.45280
        let r2 = FnEuroconvert.call(&[num(100.0), text("LTL"), text("EUR")]);
        match &r2 {
            CellValue::Number(n) => assert!(
                n.get() > 0.0,
                "LTL conversion should produce positive number"
            ),
            _ => panic!("Expected number for LTL, got {:?}", r2),
        }
    }
}
