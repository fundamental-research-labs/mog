//! Gated `write` method without `scope = "..."` must fail to compile.

pub struct StubService;
pub type FakeEngine = ();
pub type SheetId = u32;

#[macro_export]
macro_rules! __desc_missing_scope_write {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write do_it {
                params { [prim] sheet: SheetId, }
                return_type = ();
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write do_it {
                params { [prim] sheet: SheetId, }
                return_type = ();
            }
        }
    };
}

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__desc_missing_scope_write,
);

fn main() {}
