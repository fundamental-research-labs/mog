//! Trailing `&Principal` param without the `needs_principal` flag must fail.

pub struct StubService;
pub type FakeEngine = ();
pub struct Principal;

#[macro_export]
macro_rules! __desc_trailing_principal_no_flag {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write leaky {
                params { [prim] x: u32, [serde] caller: &Principal, }
                return_type = ();
                scope = "workbook";
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write leaky {
                params { [prim] x: u32, [serde] caller: &Principal, }
                return_type = ();
                scope = "workbook";
            }
        }
    };
}

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__desc_trailing_principal_no_flag,
);

fn main() {}
