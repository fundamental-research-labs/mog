pub struct SendSyncService {
    value: u32,
}

impl SendSyncService {
    pub fn new() -> Self {
        Self { value: 7 }
    }

    pub fn get(&self) -> u32 {
        self.value
    }
}

#[macro_export]
macro_rules! __bridge_descriptor_SendSyncService_ops {
    ($gen:path) => {
        $gen! {
            bridge_version = 1;
            group = ops;
            service = SendSyncService;
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

bridge_tauri::generate!(crate::__bridge_descriptor_SendSyncService_ops);

fn assert_send_sync<T: Send + Sync>() {}

fn main() {
    assert_send_sync::<SendSyncServiceRegistry>();
}
