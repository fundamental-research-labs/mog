use std::cell::Cell;

pub struct NotSyncService {
    value: Cell<u8>,
}

impl NotSyncService {
    pub fn new() -> Self {
        Self {
            value: Cell::new(7),
        }
    }

    pub fn get(&self) -> u32 {
        self.value.get().into()
    }
}

#[macro_export]
macro_rules! __bridge_descriptor_NotSyncService_ops {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = ops;
            service = NotSyncService;
            key_type = str;
            key_param = "service_id";
            lifecycle create new {
                params {}
                return_type = Self;
            }
            method read get {
                params {}
                return_type = u32;
            }
        }
    };
}

bridge_tauri::generate!(crate::__bridge_descriptor_NotSyncService_ops);

fn assert_send_sync<T: Send + Sync>() {}

fn main() {
    assert_send_sync::<NotSyncServiceRegistry>();
}
