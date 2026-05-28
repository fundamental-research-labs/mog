use compute_core::storage::engine::YrsComputeEngine;

use crate::edit::{op_inverse_pair, sheet_id};
use crate::runner::{EDIT_DELTA, FamilyResult};
use crate::topologies::mixed_type_snapshot;

#[test]
fn class_iii_mixed_type() {
    let mut result = FamilyResult::new("mixed_type");
    let sid = sheet_id();
    let float_seeds: &[(f64, &str)] = &[
        (0.1, "p0_1"),
        (0.4, "p0_4"),
        (0.7, "p0_7"),
        (1.0 / 3.0, "one_third"),
        (0.1 + 0.2, "sum0_1_0_2"),
    ];
    let int_seeds: &[(f64, &str)] = &[
        (1.0, "i1"),
        (2.0, "i2"),
        (42.0, "i42"),
        (0.0, "i0"),
        (-7.0, "i_neg7"),
    ];

    for (f_seed, f_slug) in float_seeds {
        let (snapshot, dependent) = mixed_type_snapshot(1.0, *f_seed);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 0, 0, 1.0, 1.0, dependent);
        result.record(format!("edit_int_with_float_{}", f_slug), outcome);
    }

    for (i_seed, i_slug) in int_seeds {
        let (snapshot, dependent) = mixed_type_snapshot(*i_seed, 0.4);
        let (mut engine, _init) = YrsComputeEngine::from_snapshot(snapshot).expect("from_snapshot");
        let outcome = op_inverse_pair(&mut engine, &sid, 1, 0, 0.4, EDIT_DELTA, dependent);
        result.record(format!("edit_float_with_int_{}", i_slug), outcome);
    }
    result.report();
}
