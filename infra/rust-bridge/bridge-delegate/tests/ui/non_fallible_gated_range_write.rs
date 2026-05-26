//! Non-fallible `scope = "range"` writes are ill-formed under
//! `gated = true` — the range iteration has no error channel to signal
//! per-cell denial on non-uniform matrices. The macro must reject at
//! compile time.

pub struct StubService;
pub type FakeEngine = ();
pub type SheetId = u32;
pub type CellRange = u32;

#[macro_export]
macro_rules! __desc_non_fallible_range_write {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write bulk_touch {
                params { [prim] sheet: SheetId, [prim] range: CellRange, }
                return_type = ();
                scope = "range";
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = bad;
            type_name = FakeEngine;
            method write bulk_touch {
                params { [prim] sheet: SheetId, [prim] range: CellRange, }
                return_type = ();
                scope = "range";
            }
        }
    };
}

bridge_delegate::delegate!(
    target = StubService,
    dispatch = dispatch,
    gated = true,
    skip_default_imports = true,
    crate::__desc_non_fallible_range_write,
);

fn main() {}
