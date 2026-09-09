use super::{num, ymd_to_serial};
use crate::{FunctionContext, FunctionRegistry};
use value_types::{CellError, CellValue};

fn evaluate(name: &str, args: &[f64]) -> f64 {
    match FunctionRegistry::new().call(name, &args.iter().copied().map(num).collect::<Vec<_>>()) {
        CellValue::Number(n) => n.get(),
        other => panic!("{name}({args:?}) returned {other:?}"),
    }
}

fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-9,
        "got {actual}, expected {expected}"
    );
}

#[test]
fn odd_coupons_excel_reference_values() {
    // Windows Excel's cached results; first two also use Microsoft's documented example dates.
    close(
        evaluate(
            "ODDFPRICE",
            &[39763., 44256., 39736., 39873., 0.0785, 0.0625, 100., 2., 1.],
        ),
        113.59771747407883,
    );
    close(
        evaluate(
            "ODDFYIELD",
            &[39763., 44256., 39736., 39873., 0.0575, 84.5, 100., 2., 0.],
        ),
        0.07724554159729888,
    );
    close(
        evaluate(
            "ODDLPRICE",
            &[39763., 44256., 39736., 0.0785, 0.0625, 100., 2., 0.],
        ),
        110.88286909824446,
    );
    close(
        evaluate(
            "ODDLYIELD",
            &[39763., 44256., 39736., 0.0575, 84.5, 100., 2., 0.],
        ),
        0.08254808631495333,
    );
}

#[test]
fn odd_coupons_price_yield_inverse_across_bases_and_schedules() {
    let date = ymd_to_serial;
    // Short and multi-year first/last coupons, with a leap-year month-end anchor.
    for frequency in [1., 2., 4.] {
        for basis in 0..=4 {
            for issue in [date(2021, 10, 15), date(2023, 12, 15)] {
                for yld in [0., 0.005, 0.07, 0.4] {
                    let mut first = [
                        date(2024, 1, 15),
                        date(2028, 2, 29),
                        issue,
                        date(2024, 2, 29),
                        0.06,
                        yld,
                        100.,
                        frequency,
                        f64::from(basis),
                    ];
                    first[5] = evaluate("ODDFPRICE", &first);
                    close(evaluate("ODDFYIELD", &first), yld);
                    let mut last = [
                        date(2024, 1, 15),
                        date(2024, 6, 17),
                        issue,
                        0.06,
                        yld,
                        100.,
                        frequency,
                        f64::from(basis),
                    ];
                    last[4] = evaluate("ODDLPRICE", &last);
                    close(evaluate("ODDLYIELD", &last), yld);
                }
            }
        }
    }
}

#[test]
fn odd_coupons_zero_coupon_cash_flows_and_zero_yield() {
    // US 30/360: settlement to first payment = 90/180 of a half-year;
    // redemption follows three regular coupons, so discount exponent = 3.5.
    let mut first = [
        ymd_to_serial(2024, 3, 15),
        ymd_to_serial(2025, 12, 15),
        ymd_to_serial(2024, 2, 15),
        ymd_to_serial(2024, 6, 15),
        0.,
        0.08,
        100.,
        2.,
        0.,
    ];
    close(evaluate("ODDFPRICE", &first), 100. / 1.04_f64.powf(3.5));
    first[5] = 0.;
    close(evaluate("ODDFPRICE", &first), 100.);
    let last = [
        ymd_to_serial(2024, 3, 15),
        ymd_to_serial(2024, 6, 15),
        ymd_to_serial(2024, 2, 15),
        0.,
        0.08,
        100.,
        2.,
        0.,
    ];
    close(evaluate("ODDLPRICE", &last), 100. / 1.02);
}

#[test]
fn odd_coupons_default_basis_truncation_and_date_system() {
    let registry = FunctionRegistry::new();
    for (name, mut args, date_count) in [
        (
            "ODDFPRICE",
            vec![39763., 44256., 39736., 39873., 0.0785, 0.0625, 100., 2., 0.],
            4,
        ),
        (
            "ODDFYIELD",
            vec![39763., 44256., 39736., 39873., 0.0575, 84.5, 100., 2., 0.],
            4,
        ),
        (
            "ODDLPRICE",
            vec![39763., 44256., 39736., 0.0785, 0.0625, 100., 2., 0.],
            3,
        ),
        (
            "ODDLYIELD",
            vec![39763., 44256., 39736., 0.0575, 84.5, 100., 2., 0.],
            3,
        ),
    ] {
        let expected = evaluate(name, &args);
        close(evaluate(name, &args[..args.len() - 1]), expected);
        for date in &mut args[..date_count] {
            *date += 0.75;
        }
        *args.last_mut().unwrap() = 0.9;
        close(evaluate(name, &args), expected);
        for date in &mut args[..date_count] {
            *date -= 1462.;
        }
        let values = args.iter().copied().map(num).collect::<Vec<_>>();
        let result = registry.get_by_name(name).unwrap().1.call_with_context(
            &values,
            &FunctionContext {
                date1904: true,
                ..FunctionContext::default()
            },
        );
        assert!(super::approx(&result, expected, 1e-9), "{name}: {result:?}");
    }
}

#[test]
fn odd_coupons_invalid_arguments_and_registration() {
    let registry = FunctionRegistry::new();
    for (name, args, first, is_yield) in [
        (
            "ODDFPRICE",
            vec![39763., 44256., 39736., 39873., 0.0785, 0.0625, 100., 2., 0.],
            true,
            false,
        ),
        (
            "ODDFYIELD",
            vec![39763., 44256., 39736., 39873., 0.0575, 84.5, 100., 2., 0.],
            true,
            true,
        ),
        (
            "ODDLPRICE",
            vec![39763., 44256., 39736., 0.0785, 0.0625, 100., 2., 0.],
            false,
            false,
        ),
        (
            "ODDLYIELD",
            vec![39763., 44256., 39736., 0.0575, 84.5, 100., 2., 0.],
            false,
            true,
        ),
    ] {
        let offset = usize::from(first);
        let mut invalid = vec![
            (0, 44256., CellError::Num),
            (2, 39763., CellError::Num),
            (3 + offset, -0.1, CellError::Num),
            (4 + offset, -1., CellError::Num),
            (5 + offset, -1., CellError::Num),
            (6 + offset, 3., CellError::Num),
            (7 + offset, 5., CellError::Num),
            (0, -1., CellError::Value),
        ];
        if first {
            invalid.extend([(3, 39763., CellError::Num), (3, 44256., CellError::Num)]);
        }
        if is_yield {
            invalid.push((4 + offset, 0., CellError::Num));
        }
        for (index, value, error) in invalid {
            let mut values = args.iter().copied().map(num).collect::<Vec<_>>();
            values[index] = num(value);
            let result = registry.call(name, &values);
            assert!(
                matches!(result, CellValue::Error(e, _) if e == error),
                "{name} at {index}: {result:?}"
            );
        }
        assert!(matches!(registry.call(name, &[]), CellValue::Error(_, _)));
        let registered = registry.get_by_name(name).unwrap().1;
        assert_eq!(registered.min_args(), 7 + offset);
        for index in 0..args.len() {
            assert!(registered.is_liftable_arg(index));
        }
    }
}

#[test]
fn odd_coupons_array_arguments_broadcast_through_registry() {
    let registry = FunctionRegistry::new();
    let mut args = vec![
        num(39763.),
        num(44256.),
        num(39736.),
        num(39873.),
        num(0.0785),
        num(0.0625),
        num(100.),
        num(2.),
        num(1.),
    ];
    args[5] = CellValue::array(vec![num(0.0625), num(0.08)], 2);
    let result = registry.call("ODDFPRICE", &args);
    let CellValue::Array(values) = result else {
        panic!("expected lifted price array");
    };
    assert_eq!(values.cols(), 2);
    assert!(super::approx(&values.data()[0], 113.59771747407883, 1e-9));
    args[5] = CellValue::Array(values);
    let result = registry.call("ODDFYIELD", &args);
    let CellValue::Array(values) = result else {
        panic!("expected lifted yield array");
    };
    assert!(super::approx(&values.data()[0], 0.0625, 1e-9));
    assert!(super::approx(&values.data()[1], 0.08, 1e-9));
}

#[test]
fn odd_coupons_long_first_coupon_reference_values_for_each_basis() {
    // Excel-recorded test data published by ExcelFinancialFunctions:
    // https://github.com/fsprojects/ExcelFinancialFunctions/blob/master/tests/ExcelFinancialFunctions.Tests/testdata/oddfprice.test
    // Issue 1998-02-28, settlement 1999-02-28, first coupon 2009-06-30,
    // maturity 2010-06-30: eleven quasi-coupon intervals before first payment.
    for (basis, expected) in [
        128.0105899192,
        127.9949332833,
        127.9031273745,
        127.9949332833,
        128.0003495968,
    ]
    .into_iter()
    .enumerate()
    {
        close(
            evaluate(
                "ODDFPRICE",
                &[
                    36219.,
                    40359.,
                    35854.,
                    39994.,
                    0.07,
                    0.03,
                    100.,
                    1.,
                    basis as f64,
                ],
            ),
            expected,
        );
    }
}

#[test]
fn odd_coupons_month_end_discount_and_february_accrual_reference_values() {
    // Public Excel-recorded examples exercise forward month-end discount
    // counting and the odd-coupon February-to-31st accrual convention.
    close(
        evaluate(
            "ODDFPRICE",
            &[28614., 36584., 28249., 36219., 0.07, 0.03, 100., 1., 1.],
        ),
        127.6437726233,
    );
    close(
        evaluate(
            "ODDFPRICE",
            &[36219., 38077., 35854., 37711., 0.07, 0.03, 100., 1., 0.],
        ),
        116.62599435,
    );
    close(
        evaluate(
            "ODDLPRICE",
            &[37346., 40359., 35854., 0.07, 0.03, 100., 1., 0.],
        ),
        120.8222889015,
    );
    close(
        evaluate(
            "ODDLYIELD",
            &[37346., 40359., 35854., 0.07, 100., 100., 1., 0.],
        ),
        0.05452258659496,
    );
}
