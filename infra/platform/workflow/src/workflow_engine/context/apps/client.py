"""
AppClient - HTTP client for communicating with app APIs via the gateway.

This module provides the shared HTTP client that all app APIs use to
communicate with the unified gateway. It handles common concerns like:
- Request/response serialization
- Error handling
- Logging
- Authentication (when configured)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, TypeVar, Generic

import httpx


logger = logging.getLogger(__name__)


T = TypeVar("T")


class AppAPIError(Exception):
    """
    Error from an app API call.

    Attributes:
        message: Error message
        status_code: HTTP status code
        app: App name
        operation: Operation that failed
        details: Additional error details
    """

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        app: str = "",
        operation: str = "",
        details: Dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.app = app
        self.operation = operation
        self.details = details or {}


class AppNotFoundError(AppAPIError):
    """App not found."""
    pass


class ResourceNotFoundError(AppAPIError):
    """Requested resource not found."""
    pass


class ValidationError(AppAPIError):
    """Validation failed for request data."""
    pass


class AuthorizationError(AppAPIError):
    """Authorization failed."""
    pass


@dataclass
class APIResponse(Generic[T]):
    """
    Response from an app API call.

    Attributes:
        data: Response data
        status_code: HTTP status code
        headers: Response headers
    """

    data: T
    status_code: int
    headers: Dict[str, str]


class AppClient:
    """
    HTTP client for app API calls.

    This is the underlying HTTP client used by all app-specific APIs.
    It handles communication with the unified gateway at /api/apps/*.

    Example:
        client = AppClient(gateway_url="http://localhost:8000")

        # Make app API calls
        response = client.get("crm", "/deals/deal123")
        response = client.post("finance", "/invoices", json={...})
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        http_client: httpx.Client | None = None,
        auth_token: str | None = None,
        default_headers: Dict[str, str] | None = None,
    ) -> None:
        """
        Initialize the app client.

        Args:
            gateway_url: URL of the unified gateway
            http_client: Optional pre-configured HTTP client
            auth_token: Optional authentication token
            default_headers: Optional default headers for all requests
        """
        self._gateway_url = gateway_url.rstrip("/")
        self._http_client = http_client
        self._auth_token = auth_token
        self._default_headers = default_headers or {}

    def _get_client(self) -> httpx.Client:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.Client(timeout=30.0)
        return self._http_client

    def _build_headers(self, extra_headers: Dict[str, str] | None = None) -> Dict[str, str]:
        """Build request headers."""
        headers = {**self._default_headers}

        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"

        if extra_headers:
            headers.update(extra_headers)

        return headers

    def _handle_error(
        self,
        response: httpx.Response,
        app: str,
        operation: str,
    ) -> None:
        """Handle error responses."""
        status = response.status_code

        try:
            error_data = response.json()
            message = error_data.get("message", response.text)
            details = error_data.get("details", {})
        except Exception:
            message = response.text or f"HTTP {status}"
            details = {}

        if status == 404:
            if "app" in message.lower() or "not found" in message.lower() and app in message.lower():
                raise AppNotFoundError(
                    message=f"App '{app}' not found",
                    status_code=status,
                    app=app,
                    operation=operation,
                )
            raise ResourceNotFoundError(
                message=message,
                status_code=status,
                app=app,
                operation=operation,
                details=details,
            )
        elif status == 400:
            raise ValidationError(
                message=message,
                status_code=status,
                app=app,
                operation=operation,
                details=details,
            )
        elif status in (401, 403):
            raise AuthorizationError(
                message=message,
                status_code=status,
                app=app,
                operation=operation,
                details=details,
            )
        else:
            raise AppAPIError(
                message=message,
                status_code=status,
                app=app,
                operation=operation,
                details=details,
            )

    def request(
        self,
        method: str,
        app: str,
        endpoint: str,
        params: Dict[str, Any] | None = None,
        json: Dict[str, Any] | None = None,
        headers: Dict[str, str] | None = None,
    ) -> APIResponse[Dict[str, Any]]:
        """
        Make a request to an app API.

        Args:
            method: HTTP method
            app: App name (crm, finance, spreadsheet, etc.)
            endpoint: API endpoint (e.g., /deals, /invoices)
            params: Query parameters
            json: JSON body
            headers: Additional headers

        Returns:
            APIResponse with response data

        Raises:
            AppAPIError: If the request fails
        """
        client = self._get_client()
        url = f"{self._gateway_url}/api/apps/{app}{endpoint}"

        logger.debug(f"App API request: {method} {url}")

        try:
            response = client.request(
                method,
                url,
                params=params,
                json=json,
                headers=self._build_headers(headers),
            )

            if not response.is_success:
                self._handle_error(response, app, f"{method} {endpoint}")

            data = response.json() if response.content else {}

            return APIResponse(
                data=data,
                status_code=response.status_code,
                headers=dict(response.headers),
            )

        except httpx.RequestError as e:
            logger.error(f"Request error: {e}")
            raise AppAPIError(
                message=f"Request failed: {e}",
                app=app,
                operation=f"{method} {endpoint}",
            ) from e

    def get(
        self,
        app: str,
        endpoint: str,
        params: Dict[str, Any] | None = None,
        headers: Dict[str, str] | None = None,
    ) -> APIResponse[Dict[str, Any]]:
        """Make a GET request."""
        return self.request("GET", app, endpoint, params=params, headers=headers)

    def post(
        self,
        app: str,
        endpoint: str,
        json: Dict[str, Any] | None = None,
        params: Dict[str, Any] | None = None,
        headers: Dict[str, str] | None = None,
    ) -> APIResponse[Dict[str, Any]]:
        """Make a POST request."""
        return self.request("POST", app, endpoint, params=params, json=json, headers=headers)

    def put(
        self,
        app: str,
        endpoint: str,
        json: Dict[str, Any] | None = None,
        params: Dict[str, Any] | None = None,
        headers: Dict[str, str] | None = None,
    ) -> APIResponse[Dict[str, Any]]:
        """Make a PUT request."""
        return self.request("PUT", app, endpoint, params=params, json=json, headers=headers)

    def patch(
        self,
        app: str,
        endpoint: str,
        json: Dict[str, Any] | None = None,
        params: Dict[str, Any] | None = None,
        headers: Dict[str, str] | None = None,
    ) -> APIResponse[Dict[str, Any]]:
        """Make a PATCH request."""
        return self.request("PATCH", app, endpoint, params=params, json=json, headers=headers)

    def delete(
        self,
        app: str,
        endpoint: str,
        params: Dict[str, Any] | None = None,
        headers: Dict[str, str] | None = None,
    ) -> APIResponse[Dict[str, Any]]:
        """Make a DELETE request."""
        return self.request("DELETE", app, endpoint, params=params, headers=headers)

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
