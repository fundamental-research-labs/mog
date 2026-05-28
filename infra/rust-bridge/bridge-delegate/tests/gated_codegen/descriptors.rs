#[macro_export]
macro_rules! __bridge_descriptor_stub_gated {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = stub;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method read get_range {
                params { [prim] sheet: SheetId, [prim] range: CellRange, }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "range";
            }
            method read get_viewport {
                params { [prim] sheet: SheetId, [prim] bounds: u32, }
                return_type = Vec<u8>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method read list_sheets {
                params { }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
            }
            method read sheet_row_count {
                params { [prim] sheet: SheetId, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method structural insert_rows {
                params { [prim] sheet: SheetId, [prim] at: u32, [prim] n: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write add_policy {
                params { [prim] policy: u32, [serde] caller: &Principal, }
                return_type = u64;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
                needs_principal;
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = stub;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method read get_range {
                params { [prim] sheet: SheetId, [prim] range: CellRange, }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "range";
            }
            method read get_viewport {
                params { [prim] sheet: SheetId, [prim] bounds: u32, }
                return_type = Vec<u8>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method read list_sheets {
                params { }
                return_type = Vec<u32>;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
            }
            method read sheet_row_count {
                params { [prim] sheet: SheetId, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "cell";
            }
            method structural insert_rows {
                params { [prim] sheet: SheetId, [prim] at: u32, [prim] n: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
                scope = "sheet";
            }
            method write add_policy {
                params { [prim] policy: u32, [serde] caller: &Principal, }
                return_type = u64;
                error_type = compute_security::SecurityError;
                fallible;
                scope = "workbook";
                needs_principal;
            }
        }
    };
}

#[macro_export]
macro_rules! __bridge_descriptor_stub_plain {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = plain;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
            }
        }
    };
    ($gen:path, $($extra:tt)*) => {
        $gen! {
            $($extra)*
            bridge_version = 1;
            group = plain;
            type_name = FakeEngine;
            method read get_cell_value {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, }
                return_type = u32;
                error_type = compute_security::SecurityError;
                fallible;
            }
            method write set_cell {
                params { [prim] sheet: SheetId, [prim] addr: CellAddr, [prim] v: u32, }
                return_type = ();
                error_type = compute_security::SecurityError;
                fallible;
            }
        }
    };
}
