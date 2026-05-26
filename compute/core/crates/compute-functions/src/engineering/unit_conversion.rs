//! Unit conversion function: CONVERT

use value_types::{CellError, CellValue};

use super::helpers::{coerce_num, coerce_str};
use crate::{FunctionRegistry, PureFunction};

// ===========================================================================
// CONVERT Helpers
// ===========================================================================

/// Unit info: (category, multiplier_to_base).
/// Temperature units use special conversion logic.
struct UnitInfo {
    category: &'static str,
    multiplier: f64,
}

/// Metric prefix multipliers.
fn metric_prefix(prefix: &str) -> Option<f64> {
    match prefix {
        "Y" => Some(1e24),  // yotta
        "Z" => Some(1e21),  // zetta
        "E" => Some(1e18),  // exa
        "P" => Some(1e15),  // peta
        "T" => Some(1e12),  // tera
        "G" => Some(1e9),   // giga
        "M" => Some(1e6),   // mega
        "k" => Some(1e3),   // kilo
        "h" => Some(1e2),   // hecto
        "da" => Some(1e1),  // deca (note: 2-char)
        "e" => Some(1e1),   // deca alt
        "d" => Some(1e-1),  // deci
        "c" => Some(1e-2),  // centi
        "m" => Some(1e-3),  // milli
        "u" => Some(1e-6),  // micro
        "n" => Some(1e-9),  // nano
        "p" => Some(1e-12), // pico
        "f" => Some(1e-15), // femto
        "a" => Some(1e-18), // atto
        "z" => Some(1e-21), // zepto
        "y" => Some(1e-24), // yocto
        _ => None,
    }
}

/// Binary prefix multipliers (for information units).
fn binary_prefix(prefix: &str) -> Option<f64> {
    match prefix {
        "ki" => Some(1024.0),
        "Mi" => Some(1048576.0),
        "Gi" => Some(1073741824.0),
        "Ti" => Some(1099511627776.0),
        "Pi" => Some(1125899906842624.0),
        "Ei" => Some(1152921504606846976.0),
        "Zi" => Some(1180591620717411303424.0),
        "Yi" => Some(1208925819614629174706176.0),
        _ => None,
    }
}

fn get_unit(name: &str) -> Option<(UnitInfo, f64)> {
    // First try exact match in the base unit table
    if let Some(info) = base_unit(name) {
        return Some((info, 1.0));
    }

    // Try with metric prefixes (try 2-char first, then 1-char)
    if name.len() >= 3 {
        let prefix2 = &name[..2];
        let base_name = &name[2..];
        if let Some(prefix_mult) = metric_prefix(prefix2)
            && let Some(info) = base_unit(base_name)
        {
            // Only certain categories support metric prefixes
            if matches!(
                info.category,
                "mass"
                    | "distance"
                    | "force"
                    | "energy"
                    | "power"
                    | "pressure"
                    | "volume"
                    | "area"
                    | "information"
                    | "speed"
                    | "magnetism"
            ) {
                return Some((info, prefix_mult));
            }
        }
    }
    if name.len() >= 2 {
        let prefix1 = &name[..1];
        let base_name = &name[1..];
        if let Some(prefix_mult) = metric_prefix(prefix1)
            && let Some(info) = base_unit(base_name)
            && matches!(
                info.category,
                "mass"
                    | "distance"
                    | "force"
                    | "energy"
                    | "power"
                    | "pressure"
                    | "volume"
                    | "area"
                    | "information"
                    | "speed"
                    | "magnetism"
            )
        {
            return Some((info, prefix_mult));
        }
    }

    // Try binary prefixes for information units
    if name.len() >= 3 {
        let prefix2 = &name[..2];
        let base_name = &name[2..];
        if let Some(prefix_mult) = binary_prefix(prefix2)
            && let Some(info) = base_unit(base_name)
            && info.category == "information"
        {
            return Some((info, prefix_mult));
        }
    }

    None
}

fn base_unit(name: &str) -> Option<UnitInfo> {
    let (cat, mult) = match name {
        // Mass (base: gram)
        "g" => ("mass", 1.0),
        "sg" => ("mass", 6.852_176_585_679_18e-5_f64.recip()), // slug: 1 slug = 14593.9 g
        "lbm" => ("mass", 453.59237),
        "u" => ("mass", 1.6605402e-24),
        "ozm" => ("mass", 28.349523125),
        "grain" => ("mass", 0.06479891),
        "cwt" | "shweight" => ("mass", 45359.237),
        "uk_cwt" | "lcwt" => ("mass", 50802.34544),
        "stone" => ("mass", 6350.29318),
        "ton" => ("mass", 907184.74),
        "uk_ton" | "LTON" | "brton" => ("mass", 1016046.9088),

        // Distance (base: meter)
        "m" => ("distance", 1.0),
        "mi" => ("distance", 1609.344),
        "Nmi" => ("distance", 1852.0),
        "in" => ("distance", 0.0254),
        "ft" => ("distance", 0.3048),
        "yd" => ("distance", 0.9144),
        "ang" => ("distance", 1e-10),
        "ell" => ("distance", 1.143),
        "ly" => ("distance", 9.46073047258e15),
        "parsec" | "pc" => ("distance", 3.08567758e16),
        "Pica" | "pica" | "Picapt" => ("distance", 0.00423333333),
        "survey_mi" => ("distance", 1609.347219),

        // Time (base: second)
        "yr" => ("time", 31557600.0),
        "day" => ("time", 86400.0),
        "hr" => ("time", 3600.0),
        "mn" | "min" => ("time", 60.0),
        "sec" => ("time", 1.0),

        // Pressure (base: pascal)
        "Pa" | "p" => ("pressure", 1.0),
        "psi" => ("pressure", 6894.757293168),
        "mmHg" => ("pressure", 133.322387415),
        "atm" => ("pressure", 101325.0),
        "at" => ("pressure", 98066.5),
        "Torr" => ("pressure", 133.322368421),

        // Force (base: newton)
        "N" => ("force", 1.0),
        "dyn" | "dy" => ("force", 1e-5),
        "lbf" => ("force", 4.4482216152605),
        "pond" => ("force", 0.00980665),

        // Energy (base: joule)
        "J" => ("energy", 1.0),
        "e" => ("energy", 1e-7), // erg
        "c" | "cal" => ("energy", 4.1868),
        "eV" | "ev" => ("energy", 1.60217733e-19),
        "HPh" | "hh" => ("energy", 2684519.537696),
        "Wh" | "wh" => ("energy", 3600.0),
        "flb" => ("energy", 1.3558179483314),
        "BTU" | "btu" => ("energy", 1055.05585262),

        // Power (base: watt)
        "W" | "w" => ("power", 1.0),
        "HP" | "h" => ("power", 745.69987158227),
        "PS" => ("power", 735.49875),

        // Magnetism (base: tesla)
        "T" => ("magnetism", 1.0),
        "ga" => ("magnetism", 0.0001),

        // Temperature (special handling)
        "C" | "cel" => ("temperature", 1.0),
        "F" | "fah" => ("temperature", 1.0),
        "K" | "kel" => ("temperature", 1.0),
        "Rank" => ("temperature", 1.0),
        "Reau" => ("temperature", 1.0),

        // Volume (base: cubic meter)
        "tsp" => ("volume", 4.92892159375e-6),
        "tbs" => ("volume", 1.47867647812e-5),
        "oz" => ("volume", 2.95735295625e-5),
        "cup" => ("volume", 0.0002365882365),
        "pt" | "us_pt" => ("volume", 0.000473176473),
        "uk_pt" => ("volume", 0.00056826125),
        "qt" => ("volume", 0.000946352946),
        "uk_qt" => ("volume", 0.0011365225),
        "gal" => ("volume", 0.003785411784),
        "uk_gal" => ("volume", 0.00454609),
        "l" | "L" | "lt" => ("volume", 0.001),
        "ang3" | "ang^3" => ("volume", 1e-30),
        "barrel" => ("volume", 0.158987294928),
        "bushel" => ("volume", 0.03523907),
        "ft3" | "ft^3" => ("volume", 0.028316846592),
        "in3" | "in^3" => ("volume", 1.6387064e-5),
        "ly3" | "ly^3" => ("volume", 8.46786664623715e47),
        "m3" | "m^3" => ("volume", 1.0),
        "mi3" | "mi^3" => ("volume", 4_168_181_825.440_579_4),
        "yd3" | "yd^3" => ("volume", 0.764554857984),
        "Nmi3" | "Nmi^3" => ("volume", 6352182208.0),
        "Picapt3" | "Picapt^3" | "Pica3" | "Pica^3" => ("volume", 7.58660476e-11),
        "GRT" | "regton" => ("volume", 2.8316846592),
        "MTON" => ("volume", 1.13267386368),

        // Area (base: square meter)
        "uk_acre" | "us_acre" | "acre" => ("area", 4046.8564224),
        "ang2" | "ang^2" => ("area", 1e-20),
        "ar" => ("area", 100.0),
        "ft2" | "ft^2" => ("area", 0.09290304),
        "ha" => ("area", 10000.0),
        "in2" | "in^2" => ("area", 0.00064516),
        "ly2" | "ly^2" => ("area", 8.95054210631147e31),
        "m2" | "m^2" => ("area", 1.0),
        "Morgen" => ("area", 2500.0),
        "mi2" | "mi^2" => ("area", 2589988.110336),
        "Nmi2" | "Nmi^2" => ("area", 3429904.0),
        "Picapt2" | "Picapt^2" | "Pica2" | "Pica^2" => ("area", 1.79252693e-5),
        "yd2" | "yd^2" => ("area", 0.83612736),

        // Information (base: bit)
        "bit" => ("information", 1.0),
        "byte" => ("information", 8.0),

        // Speed (base: m/s)
        "admkn" => ("speed", 0.514444444),
        "kn" => ("speed", 0.514444444),
        "m/h" | "m/hr" => ("speed", 0.44704),
        "m/s" | "m/sec" => ("speed", 1.0),

        _ => return None,
    };
    Some(UnitInfo {
        category: cat,
        multiplier: mult,
    })
}

/// Resolve a temperature unit name to a canonical key for conversion.
fn temp_key(name: &str) -> Option<&'static str> {
    match name {
        "C" | "cel" => Some("C"),
        "F" | "fah" => Some("F"),
        "K" | "kel" => Some("K"),
        "Rank" => Some("Rank"),
        "Reau" => Some("Reau"),
        _ => None,
    }
}

/// Convert temperature from a source unit to Celsius.
fn to_celsius(val: f64, unit: &str) -> f64 {
    match unit {
        "C" => val,
        "F" => (val - 32.0) * 5.0 / 9.0,
        "K" => val - 273.15,
        "Rank" => (val - 491.67) * 5.0 / 9.0,
        "Reau" => val * 5.0 / 4.0,
        _ => val,
    }
}

/// Convert temperature from Celsius to a target unit.
fn from_celsius(val: f64, unit: &str) -> f64 {
    match unit {
        "C" => val,
        "F" => val * 9.0 / 5.0 + 32.0,
        "K" => val + 273.15,
        "Rank" => val * 9.0 / 5.0 + 491.67,
        "Reau" => val * 4.0 / 5.0,
        _ => val,
    }
}

// ===========================================================================
// CONVERT Function (1)
// ===========================================================================

pub(super) struct FnConvert;
impl PureFunction for FnConvert {
    fn name(&self) -> &'static str {
        "CONVERT"
    }
    fn min_args(&self) -> usize {
        3
    }
    fn max_args(&self) -> Option<usize> {
        Some(3)
    }
    fn is_scalar_arg(&self, _index: usize) -> bool {
        true
    }
    fn call(&self, args: &[CellValue]) -> CellValue {
        let number = match coerce_num(args, 0) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let from_unit = match coerce_str(args, 1) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let to_unit = match coerce_str(args, 2) {
            Ok(v) => v,
            Err(e) => return e,
        };

        // Temperature: special non-linear handling
        if let (Some(from_key), Some(to_key)) = (temp_key(&from_unit), temp_key(&to_unit)) {
            let celsius = to_celsius(number, from_key);
            return CellValue::number(from_celsius(celsius, to_key));
        }

        let (from_info, from_prefix) = match get_unit(&from_unit) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Na,
                    format!("CONVERT: unrecognized unit '{from_unit}'"),
                );
            }
        };
        let (to_info, to_prefix) = match get_unit(&to_unit) {
            Some(v) => v,
            None => {
                return CellValue::error_with_message(
                    CellError::Na,
                    format!("CONVERT: unrecognized unit '{to_unit}'"),
                );
            }
        };

        // Must be same category
        if from_info.category != to_info.category {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "CONVERT: cannot convert from '{}' ({}) to '{}' ({})",
                    from_unit, from_info.category, to_unit, to_info.category
                ),
            );
        }

        // Temperature should have been handled above
        if from_info.category == "temperature" {
            return CellValue::error_with_message(
                CellError::Na,
                format!(
                    "CONVERT: unsupported temperature unit combination '{from_unit}' to '{to_unit}'"
                ),
            );
        }

        // Convert: value * from_multiplier * from_prefix / (to_multiplier * to_prefix)
        let base_value = number * from_info.multiplier * from_prefix;
        let result = base_value / (to_info.multiplier * to_prefix);

        CellValue::number(result)
    }
}

// ===========================================================================
// Registration
// ===========================================================================

pub(crate) fn register(registry: &mut FunctionRegistry) {
    registry.register(Box::new(FnConvert));
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn num(n: f64) -> CellValue {
        CellValue::number(n)
    }
    fn text(s: &str) -> CellValue {
        CellValue::Text(s.into())
    }

    #[test]
    fn test_convert_distance() {
        let f = FnConvert;
        let result = f.call(&[num(1.0), text("mi"), text("km")]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - 1.609344).abs() < 1e-6);
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_convert_temperature() {
        let f = FnConvert;
        assert_eq!(f.call(&[num(100.0), text("C"), text("F")]), num(212.0));
        let result = f.call(&[num(32.0), text("F"), text("C")]);
        if let CellValue::Number(n) = result {
            assert!((n.get() - 0.0).abs() < 1e-10);
        } else {
            panic!("Expected number");
        }
    }

    #[test]
    fn test_convert_incompatible() {
        let f = FnConvert;
        let result = f.call(&[num(1.0), text("m"), text("g")]);
        assert!(matches!(result, CellValue::Error(CellError::Na, _)));
    }

    #[test]
    fn test_convert_technical_atmosphere() {
        // CONVERT(1, "at", "Pa") should return 98066.5 (technical atmosphere)
        let f = FnConvert;
        let result = f.call(&[num(1.0), text("at"), text("Pa")]);
        if let CellValue::Number(n) = result {
            assert!(
                (n.get() - 98066.5).abs() < 0.1,
                "CONVERT(1, at, Pa) = {} but expected 98066.5",
                n.get()
            );
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }

    #[test]
    fn test_convert_standard_atmosphere() {
        // CONVERT(1, "atm", "Pa") should return 101325.0 (standard atmosphere)
        let f = FnConvert;
        let result = f.call(&[num(1.0), text("atm"), text("Pa")]);
        if let CellValue::Number(n) = result {
            assert!(
                (n.get() - 101325.0).abs() < 0.1,
                "CONVERT(1, atm, Pa) = {} but expected 101325.0",
                n.get()
            );
        } else {
            panic!("Expected number, got {:?}", result);
        }
    }
}
