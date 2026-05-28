/// Precision-fragile seeds named in the Class III plan. Each carries a
/// short slug for stable test naming.
pub(crate) struct Seed {
    pub(crate) slug: &'static str,
    pub(crate) value: f64,
}

pub(crate) fn seeds() -> Vec<Seed> {
    vec![
        Seed {
            slug: "p0_1",
            value: 0.1,
        },
        Seed {
            slug: "p0_2",
            value: 0.2,
        },
        Seed {
            slug: "p0_3",
            value: 0.3,
        },
        Seed {
            slug: "p0_4",
            value: 0.4,
        },
        Seed {
            slug: "p0_7",
            value: 0.7,
        },
        Seed {
            slug: "one_third",
            value: 1.0 / 3.0,
        },
        Seed {
            slug: "p0_1_plus_p0_2",
            value: 0.1 + 0.2,
        },
        Seed {
            slug: "eps",
            value: f64::EPSILON,
        },
        // `FiniteF64` normalizes -0.0 to +0.0 on construction, so the
        // engine never observes a raw -0.0 bit pattern. The dependent
        // formula still must be identical before and after the inverse.
        Seed {
            slug: "neg_zero",
            value: -0.0,
        },
        Seed {
            slug: "subnormal",
            value: f64::MIN_POSITIVE / 2.0,
        },
        Seed {
            slug: "e_neg_300",
            value: 1e-300,
        },
        Seed {
            slug: "e_300",
            value: 1e300,
        },
        Seed {
            slug: "f64_max",
            value: f64::MAX,
        },
        Seed {
            slug: "f64_min_positive",
            value: f64::MIN_POSITIVE,
        },
    ]
}
