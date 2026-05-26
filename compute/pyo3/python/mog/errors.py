"""Exception hierarchy for the Mog Python SDK.

All exceptions raised by the SDK inherit from ``MogError``, making it easy
to catch any Mog-related failure with a single handler::

    try:
        ws.set_cell("A1", 42)
    except mog.MogError:
        ...

Rust-side errors (PyRuntimeError from PyO3) are caught and re-raised as
the most specific subclass possible.
"""
from __future__ import annotations


class MogError(Exception):
    """Base class for all Mog SDK exceptions."""


class ComputeError(MogError):
    """An error originating from the Rust compute engine."""


class AddressError(MogError):
    """Invalid A1 address or range string."""


class SheetNotFoundError(MogError):
    """Requested sheet does not exist in the workbook."""


class EngineShutdownError(MogError):
    """The engine thread has been shut down."""


def _wrap_native_error(exc: Exception) -> MogError:
    """Convert a native (PyO3) exception into the appropriate MogError subclass.

    The Rust layer raises ``RuntimeError`` for most failures.  We inspect
    the message string to pick the best Python-side type.
    """
    msg = str(exc)
    if "sheet not found" in msg.lower():
        return SheetNotFoundError(msg)
    if "invalid address" in msg.lower() or "invalid range" in msg.lower():
        return AddressError(msg)
    if "engine shut down" in msg.lower():
        return EngineShutdownError(msg)
    return ComputeError(msg)
