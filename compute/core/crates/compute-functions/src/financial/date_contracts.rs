use crate::{FunctionContext, FunctionRegistry};
use value_types::{CellError, CellValue};

fn num(value: f64) -> CellValue {
    CellValue::number(value)
}

fn ymd_to_serial(year: i32, month: i32, day: i32) -> f64 {
    super::helpers::ymd_to_serial(year, month, day)
}

fn with_fraction(
    args: &[CellValue],
    date_indices: &[usize],
    workbook_offset: f64,
    fraction: f64,
) -> Vec<CellValue> {
    let mut adjusted = args.to_vec();
    for &index in date_indices {
        let CellValue::Number(value) = &args[index] else {
            panic!("date argument {index} is not numeric")
        };
        adjusted[index] = num(value.get() - workbook_offset + fraction);
    }
    adjusted
}

fn call_named(
    registry: &FunctionRegistry,
    name: &str,
    args: &[CellValue],
    context: &FunctionContext,
) -> CellValue {
    registry
        .get_by_name(name)
        .unwrap_or_else(|| panic!("registered function {name} is missing"))
        .1
        .call_with_context(args, context)
}

fn assert_date_matrix(
    name: &str,
    args: &[CellValue],
    date_indices: &[usize],
    registry: &FunctionRegistry,
) {
    let default_context = FunctionContext::default();
    let baseline = call_named(registry, name, args, &default_context);
    assert!(
        matches!(&baseline, CellValue::Number(_)),
        "{name} matrix baseline must be numeric, got {baseline:?}"
    );
    for &index in date_indices {
        let fractional = with_fraction(args, &[index], 0.0, 0.75);
        assert_eq!(
            &baseline,
            &call_named(registry, name, &fractional, &default_context),
            "{name} must truncate date argument {index} in the 1900 system"
        );
    }
    let all_fractional = with_fraction(args, date_indices, 0.0, 0.75);
    assert_eq!(
        &baseline,
        &call_named(registry, name, &all_fractional, &default_context),
        "{name} must truncate all fractional dates in the 1900 system"
    );

    let offset = value_types::DateSystem::DATE_SYSTEM_1904_OFFSET;
    let context = FunctionContext {
        date1904: true,
        ..FunctionContext::default()
    };
    let integer_1904 = with_fraction(args, date_indices, offset, 0.0);
    let baseline_1904 = call_named(registry, name, &integer_1904, &context);
    assert!(
        matches!(&baseline_1904, CellValue::Number(_)),
        "{name} 1904 matrix baseline must be numeric, got {baseline_1904:?}"
    );
    for &index in date_indices {
        let fractional = with_fraction(&integer_1904, &[index], 0.0, 0.75);
        assert_eq!(
            &baseline_1904,
            &call_named(registry, name, &fractional, &context),
            "{name} must truncate date argument {index} in the 1904 system"
        );
    }
    let all_fractional_1904 = with_fraction(&integer_1904, date_indices, 0.0, 0.75);
    assert_eq!(
        &baseline_1904,
        &call_named(registry, name, &all_fractional_1904, &context),
        "{name} must truncate all fractional dates in the 1904 system"
    );
}

#[test]
fn all_financial_date_arguments_truncate_in_both_date_systems() {
    let settlement = ymd_to_serial(2023, 3, 15);
    let maturity = ymd_to_serial(2028, 1, 15);
    let tbill_maturity = ymd_to_serial(2023, 9, 15);
    let issue = ymd_to_serial(2022, 1, 15);
    let first_interest = ymd_to_serial(2023, 7, 15);
    let purchased = ymd_to_serial(2022, 1, 15);
    let first_period = ymd_to_serial(2023, 12, 31);
    let registry = FunctionRegistry::new();

    assert_date_matrix(
        "DISC",
        &[
            num(settlement),
            num(maturity),
            num(98.0),
            num(100.0),
            num(2.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "INTRATE",
        &[
            num(settlement),
            num(maturity),
            num(98.0),
            num(100.0),
            num(2.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "PRICEDISC",
        &[
            num(settlement),
            num(maturity),
            num(0.05),
            num(100.0),
            num(2.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "PRICEMAT",
        &[
            num(settlement),
            num(maturity),
            num(issue),
            num(0.05),
            num(0.06),
            num(2.0),
        ],
        &[0, 1, 2],
        &registry,
    );
    assert_date_matrix(
        "RECEIVED",
        &[
            num(settlement),
            num(maturity),
            num(100.0),
            num(0.05),
            num(2.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "YIELDDISC",
        &[
            num(settlement),
            num(maturity),
            num(98.0),
            num(100.0),
            num(2.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "YIELDMAT",
        &[
            num(settlement),
            num(maturity),
            num(issue),
            num(0.05),
            num(98.0),
            num(2.0),
        ],
        &[0, 1, 2],
        &registry,
    );

    assert_date_matrix(
        "TBILLPRICE",
        &[num(settlement), num(tbill_maturity), num(0.05)],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "TBILLYIELD",
        &[num(settlement), num(tbill_maturity), num(98.0)],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "TBILLEQ",
        &[num(settlement), num(tbill_maturity), num(0.05)],
        &[0, 1],
        &registry,
    );

    assert_date_matrix(
        "ACCRINT",
        &[
            num(issue),
            num(first_interest),
            num(settlement),
            num(0.10),
            num(1000.0),
            num(2.0),
            num(1.0),
        ],
        &[0, 1, 2],
        &registry,
    );
    assert_date_matrix(
        "ACCRINTM",
        &[
            num(issue),
            num(settlement),
            num(0.10),
            num(1000.0),
            num(1.0),
        ],
        &[0, 1],
        &registry,
    );

    assert_date_matrix(
        "COUPDAYS",
        &[num(settlement), num(maturity), num(2.0), num(1.0)],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "COUPDAYBS",
        &[num(settlement), num(maturity), num(2.0), num(1.0)],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "COUPDAYSNC",
        &[num(settlement), num(maturity), num(2.0), num(1.0)],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "COUPNCD",
        &[num(settlement), num(maturity), num(2.0), num(1.0)],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "COUPPCD",
        &[num(settlement), num(maturity), num(2.0), num(1.0)],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "COUPNUM",
        &[num(settlement), num(maturity), num(2.0), num(1.0)],
        &[0, 1],
        &registry,
    );

    assert_date_matrix(
        "DURATION",
        &[
            num(settlement),
            num(maturity),
            num(0.08),
            num(0.09),
            num(2.0),
            num(1.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "MDURATION",
        &[
            num(settlement),
            num(maturity),
            num(0.08),
            num(0.09),
            num(2.0),
            num(1.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "PRICE",
        &[
            num(settlement),
            num(maturity),
            num(0.05),
            num(0.05),
            num(100.0),
            num(2.0),
            num(1.0),
        ],
        &[0, 1],
        &registry,
    );
    assert_date_matrix(
        "YIELD",
        &[
            num(settlement),
            num(maturity),
            num(0.05),
            num(100.0),
            num(100.0),
            num(2.0),
            num(1.0),
        ],
        &[0, 1],
        &registry,
    );

    assert_date_matrix(
        "AMORLINC",
        &[
            num(2400.0),
            num(purchased),
            num(first_period),
            num(300.0),
            num(1.0),
            num(0.15),
            num(1.0),
        ],
        &[1, 2],
        &registry,
    );
    assert_date_matrix(
        "AMORDEGRC",
        &[
            num(2400.0),
            num(purchased),
            num(first_period),
            num(300.0),
            num(1.0),
            num(0.15),
            num(1.0),
        ],
        &[1, 2],
        &registry,
    );

    let amorlinc = |p, f, basis| {
        call_named(
            &registry,
            "AMORLINC",
            &[
                num(2400.0),
                num(p),
                num(f),
                num(300.0),
                num(1.0),
                num(0.15),
                num(basis),
            ],
            &FunctionContext::default(),
        )
    };
    assert!(matches!(
        amorlinc(39679.0, 39813.0, 2.0),
        CellValue::Error(CellError::Num, _)
    ));
    assert!(matches!(
        amorlinc(39813.0, 39679.0, 1.0),
        CellValue::Error(CellError::Num, _)
    ));
}
