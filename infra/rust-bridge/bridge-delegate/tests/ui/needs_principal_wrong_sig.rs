//! `needs_principal` on a method whose trailing arg isn't `&Principal`.

pub struct StubService;
pub type FakeEngine = ();

#[macro_export]
macro_rules! __desc_needs_principal_wrong_sig {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write add_policy {
                params { [prim] policy: u32, }
                return_type = ();
                scope = "workbook";
                needs_principal;
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write add_policy {
                params { [prim] policy: u32, }
                return_type = ();
                scope = "workbook";
                needs_principal;
            }
        }
    };
}

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__desc_needs_principal_wrong_sig,
);

fn main() {}
