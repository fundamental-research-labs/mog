"""Unsupported API helpers for the public Python SDK contract."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping, Optional

from mog.errors import UnsupportedApiError


OWNER_PACKAGE = "compute/pyo3"


@dataclass(frozen=True)
class UnsupportedDisposition:
    api_path: str
    python_path: str
    reason_code: str = "release_deferred"
    owner_package: str = OWNER_PACKAGE
    replacement: Optional[str] = None
    docs_key: Optional[str] = None


def unsupported_api(
    api_path: str,
    python_path: str,
    reason_code: str = "release_deferred",
    owner_package: str = OWNER_PACKAGE,
    replacement: Optional[str] = None,
    docs_key: Optional[str] = None,
) -> None:
    raise UnsupportedApiError(
        api_path=api_path,
        python_path=python_path,
        reason_code=reason_code,
        owner_package=owner_package,
        replacement=replacement,
        docs_key=docs_key,
    )


def unsupported_callable(disposition: UnsupportedDisposition) -> Callable[..., Any]:
    def _raise(*_args: Any, **_kwargs: Any) -> Any:
        unsupported_api(
            disposition.api_path,
            disposition.python_path,
            disposition.reason_code,
            disposition.owner_package,
            disposition.replacement,
            disposition.docs_key,
        )

    _raise.__name__ = disposition.python_path.rsplit(".", 1)[-1]
    _raise.__doc__ = f"Unsupported Mog Python SDK API: {disposition.api_path}."
    return _raise


class UnsupportedApiProxy:
    """Proxy returned by implemented accessors whose children are unsupported."""

    def __init__(
        self,
        accessor_api_path: str,
        accessor_python_path: str,
        dispositions: Iterable[Mapping[str, Any]],
    ) -> None:
        self._accessor_api_path = accessor_api_path
        self._accessor_python_path = accessor_python_path
        self._methods: dict[str, UnsupportedDisposition] = {}
        for item in dispositions:
            python_path = str(item["pythonPath"])
            member_name = python_path.rsplit(".", 1)[-1]
            self._methods[member_name] = UnsupportedDisposition(
                api_path=str(item["apiPath"]),
                python_path=python_path,
                reason_code=str(item.get("reason") or "release_deferred"),
                owner_package=str(item.get("ownerPackage") or OWNER_PACKAGE),
                replacement=item.get("replacement"),
                docs_key=item.get("docsKey"),
            )

    def __getattr__(self, name: str) -> Any:
        disposition = self._methods.get(name)
        if disposition is None:
            raise AttributeError(
                f"{self._accessor_python_path!r} has no unsupported member {name!r}"
            )
        return unsupported_callable(disposition)

    def __dir__(self) -> list[str]:
        return sorted(set(super().__dir__()) | set(self._methods))


def unsupported_proxy_from_surface(
    accessor_api_path: str,
    accessor_python_path: str,
) -> UnsupportedApiProxy:
    from mog._generated.api_surface import API_SURFACE

    prefix = accessor_api_path + "."
    dispositions = [
        entry
        for entry in API_SURFACE["dispositions"]
        if entry.get("status") == "unsupported"
        and str(entry.get("apiPath", "")).startswith(prefix)
    ]
    return UnsupportedApiProxy(accessor_api_path, accessor_python_path, dispositions)
