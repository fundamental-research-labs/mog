use yrs::{Doc, Subscription};

/// Handle to a `subscribe_update_v1` registration.
///
/// Dropping this handle unsubscribes the callback; keeping it alive keeps
/// the callback active. The wrapper exists so callers can name the type
/// without depending on the exact yrs `Subscription` shape.
pub struct UpdateSubscriptionHandle {
    _inner: Subscription,
}

/// Subscribe to v1-encoded post-commit updates on `doc`.
///
/// `callback` is invoked exactly once per `txn.commit()` with the v1-encoded
/// update bytes for that transaction. Volume is bounded by transaction count,
/// not by mutation count: a bulk transaction that touches 10K cells inside one
/// transaction fires the callback once with one concatenated update payload.
///
/// Read-only protocol operations do not fire the callback; they open read
/// transactions only.
///
/// The callback runs synchronously inside the yrs commit path. Per the Provider
/// protocol contract, the callback should enqueue quickly and must not perform
/// another yrs transaction on the same doc, block on I/O, or otherwise delay
/// returning.
///
/// Returns an [`UpdateSubscriptionHandle`]. Dropping the handle removes the
/// callback.
///
/// # Panics
///
/// Panics if a yrs write transaction is already in progress on `doc`.
pub fn subscribe_update_v1<F>(doc: &Doc, callback: F) -> UpdateSubscriptionHandle
where
    F: Fn(&[u8]) + Send + Sync + 'static,
{
    let inner = doc
        .observe_update_v1(move |_txn, event| {
            callback(&event.update);
        })
        .expect(
            "subscribe_update_v1 must be called outside any active yrs transaction \
             (typically from engine construction)",
        );
    UpdateSubscriptionHandle { _inner: inner }
}
