use yrs::undo::UndoManager;

/// Close any in-progress UndoManager capture window so the next mutation
/// starts a fresh stack item.
///
/// **Audit note (yrs 0.21).** The yrs JS docs and tests in older versions
/// reference `UndoManager::stop_capturing`, but yrs 0.21 renamed the
/// equivalent operation to `UndoManager::reset()`. There is no
/// "in-progress capture frame" to commit; yrs pushes a `StackItem` into
/// `undo_stack` synchronously at every transaction commit. The merge window
/// (`capture_timeout_millis`) instead causes consecutive commits within
/// that window to extend the prior stack item rather than create a new one.
/// Calling `reset()` sets `last_change = 0`, which forces the next commit
/// to start a fresh `StackItem` rather than merge.
///
/// In practice, this is the closest analog to the JS `stopCapturing`
/// semantic: a stable boundary that callers can call at every persist
/// checkpoint so the in-flight journal entry is sealed and will not
/// silently absorb the next user edit. The wrapper exists in `compute-collab`
/// so the semantic name matches the provider protocol's clean transaction
/// boundary contract and so one place can be updated if a future yrs version
/// introduces a true `stop_capturing` or changes the underlying semantics.
///
/// Note: `flush_undo_capture` does not clear the undo stack. To clear,
/// use `UndoManager::clear()`. To pop entries, use undo/redo.
pub fn flush_undo_capture<M>(undo: &mut UndoManager<M>)
where
    M: yrs::undo::Meta + 'static,
{
    undo.reset();
}
