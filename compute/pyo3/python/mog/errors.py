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

from typing import Optional


class MogError(Exception):
    """Base class for all Mog SDK exceptions."""


class ComputeError(MogError):
    """An error originating from the Rust compute engine."""


class NativeApiError(ComputeError):
    """A native bridge failure surfaced by ``mog._native``."""


class UnsupportedApiError(MogError):
    """Raised when a documented Python SDK path is deliberately unsupported."""

    def __init__(
        self,
        api_path: str,
        python_path: str,
        reason_code: str,
        owner_package: str,
        replacement: Optional[str] = None,
        docs_key: Optional[str] = None,
    ) -> None:
        self.api_path = api_path
        self.python_path = python_path
        self.reason_code = reason_code
        self.owner_package = owner_package
        self.replacement = replacement
        self.docs_key = docs_key
        message = (
            f"{python_path} is not supported by the Mog Python SDK "
            f"({api_path}; reason={reason_code}; owner={owner_package})"
        )
        if replacement:
            message += f"; use {replacement}"
        super().__init__(message)

    def to_dict(self) -> dict[str, Optional[str]]:
        return {
            "api_path": self.api_path,
            "python_path": self.python_path,
            "reason_code": self.reason_code,
            "owner_package": self.owner_package,
            "replacement": self.replacement,
            "docs_key": self.docs_key,
        }


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
    return NativeApiError(msg)
