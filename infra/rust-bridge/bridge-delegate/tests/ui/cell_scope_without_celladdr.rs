//! `scope = "cell"` without a `CellAddr`-typed parameter must fail to compile.

pub struct StubService;
pub type FakeEngine = ();
pub type SheetId = u32;

#[macro_export]
macro_rules! __desc_cell_no_celladdr {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method read wrong_shape {
                params { [prim] sheet: SheetId, }
                return_type = u32;
                scope = "cell";
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method read wrong_shape {
                params { [prim] sheet: SheetId, }
                return_type = u32;
                scope = "cell";
            }
        }
    };
}

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__desc_cell_no_celladdr,
);

fn main() {}
