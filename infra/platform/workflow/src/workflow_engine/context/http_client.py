"""
HttpClient - External HTTP client with automatic idempotency for workflows.

This module provides the HttpClient for making external API calls from
workflows. Key features:
- Automatic idempotency keys based on workflow context
- Request/response logging (without sensitive data)
- Timeout handling
- Response helpers
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Union

import httpx


logger = logging.getLogger(__name__)


# Headers that should be redacted in logs
SENSITIVE_HEADERS = {
    "authorization",
    "x-api-key",
    "api-key",
    "apikey",
    "x-auth-token",
    "x-access-token",
    "cookie",
    "set-cookie",
}


class HttpError(Exception):
    """
    Error from an HTTP request.

    Attributes:
        message: Error message
        status_code: HTTP status code (0 if request failed before response)
        response: The HttpResponse (if available)
        url: Request URL
        method: HTTP method
    """

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        response: Optional["HttpResponse"] = None,
        url: str = "",
        method: str = "",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.response = response
        self.url = url
        self.method = method


@dataclass
class HttpResponse:
    """
    HTTP response wrapper.

    Provides convenient access to response data with helpers for
    common formats (JSON, text).

    Attributes:
        status_code: HTTP status code
        headers: Response headers
        content: Raw response content as bytes
    """

    status_code: int
    headers: Dict[str, str]
    content: bytes
    _json_cache: Any = field(default=None, repr=False)

    @property
    def ok(self) -> bool:
        """
        Check if response status is success (2xx).

        Returns:
            True if status is 200-299
        """
        return 200 <= self.status_code < 300

    def json(self) -> Any:
        """
        Parse response body as JSON.

        Returns:
            Parsed JSON data

        Raises:
            ValueError: If response is not valid JSON
        """
        if self._json_cache is None:
            import json
            self._json_cache = json.loads(self.content)
        return self._json_cache

    def text(self) -> str:
        """
        Get response body as text.

        Returns:
            Response body decoded as UTF-8
        """
        return self.content.decode("utf-8")

    def raise_for_status(self) -> None:
        """
        Raise HttpError if response status indicates failure.

        Raises:
            HttpError: If status code >= 400
        """
        if not self.ok:
            raise HttpError(
                message=f"HTTP {self.status_code}",
                status_code=self.status_code,
                response=self,
            )


def _redact_headers(headers: Dict[str, str] | None) -> Dict[str, str]:
    """Redact sensitive headers for logging."""
    if not headers:
        return {}

    redacted = {}
    for key, value in headers.items():
        if key.lower() in SENSITIVE_HEADERS:
            redacted[key] = "[REDACTED]"
        else:
            redacted[key] = value
    return redacted


class HttpClient:
    """
    HTTP client for external API calls.

    This client is designed for making external HTTP requests from workflows.
    It automatically adds idempotency keys to requests, ensuring that
    retried workflows don't cause duplicate operations.

    Idempotency Key Format:
    {instance_id}-{step_name}-{attempt_number}-{operation}

    The idempotency key is added as the X-Idempotency-Key header.

    Example:
        response = ctx.http.post(
            "https://api.stripe.com/v1/charges",
            headers={"Authorization": f"Bearer {ctx.secrets.get('STRIPE_KEY')}"},
            json={"amount": 1000, "currency": "usd"}
        )

        if response.ok:
            charge = response.json()
            print(f"Charge created: {charge['id']}")
        else:
            print(f"Error: {response.status_code}")
    """

    def __init__(
        self,
        base_idempotency_key: str = "",
        timeout: float = 30.0,
        http_client: httpx.Client | None = None,
        default_headers: Dict[str, str] | None = None,
    ) -> None:
        """
        Initialize the HTTP client.

        Args:
            base_idempotency_key: Base key for idempotency (instance-step-attempt)
            timeout: Default timeout in seconds
            http_client: Optional pre-configured httpx.Client
            default_headers: Default headers for all requests
        """
        self._base_idempotency_key = base_idempotency_key
        self._timeout = timeout
        self._http_client = http_client
        self._default_headers = default_headers or {}
        self._operation_counter = 0

    def _get_client(self) -> httpx.Client:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.Client(timeout=self._timeout)
        return self._http_client

    def _get_idempotency_key(self, operation: str = "") -> str:
        """
        Generate an idempotency key for this request.

        Args:
            operation: Optional operation identifier

        Returns:
            Unique idempotency key
        """
        if not self._base_idempotency_key:
            return ""

        self._operation_counter += 1
        key = f"{self._base_idempotency_key}-{self._operation_counter}"
        if operation:
            key = f"{key}-{operation}"
        return key

    def _build_headers(
        self,
        extra_headers: Dict[str, str] | None = None,
        idempotency_key: str = "",
    ) -> Dict[str, str]:
        """Build request headers with idempotency key."""
        headers = {**self._default_headers}

        if idempotency_key:
            headers["X-Idempotency-Key"] = idempotency_key

        if extra_headers:
            headers.update(extra_headers)

        return headers

    def _log_request(
        self,
        method: str,
        url: str,
        headers: Dict[str, str] | None = None,
        json_body: Dict[str, Any] | None = None,
        data: Any = None,
    ) -> None:
        """Log request details (without sensitive data)."""
        logger.info(
            "HTTP request",
            extra={
                "method": method,
                "url": url,
                "headers": _redact_headers(headers),
                "has_json_body": json_body is not None,
                "has_data_body": data is not None,
            }
        )

    def _log_response(
        self,
        method: str,
        url: str,
        response: HttpResponse,
    ) -> None:
        """Log response details."""
        logger.info(
            "HTTP response",
            extra={
                "method": method,
                "url": url,
                "status_code": response.status_code,
                "content_length": len(response.content),
            }
        )

    def _make_request(
        self,
        method: str,
        url: str,
        headers: Dict[str, str] | None = None,
        params: Dict[str, Any] | None = None,
        json: Dict[str, Any] | None = None,
        data: Any = None,
        timeout: float | None = None,
        idempotency_key: str = "",
    ) -> HttpResponse:
        """
        Make an HTTP request.

        Args:
            method: HTTP method
            url: Request URL
            headers: Request headers
            params: Query parameters
            json: JSON body
            data: Form data or raw body
            timeout: Request timeout
            idempotency_key: Idempotency key for the request

        Returns:
            HttpResponse

        Raises:
            HttpError: If request fails
        """
        client = self._get_client()

        # Build headers
        final_headers = self._build_headers(headers, idempotency_key)

        self._log_request(method, url, final_headers, json, data)

        try:
            response = client.request(
                method,
                url,
                headers=final_headers,
                params=params,
                json=json,
                data=data,
                timeout=timeout or self._timeout,
            )

            http_response = HttpResponse(
                status_code=response.status_code,
                headers=dict(response.headers),
                content=response.content,
            )

            self._log_response(method, url, http_response)

            return http_response

        except httpx.TimeoutException as e:
            logger.error(f"HTTP timeout: {method} {url}")
            raise HttpError(
                message=f"Request timed out: {e}",
                url=url,
                method=method,
            ) from e
        except httpx.RequestError as e:
            logger.error(f"HTTP error: {method} {url} - {e}")
            raise HttpError(
                message=f"Request failed: {e}",
                url=url,
                method=method,
            ) from e

    def get(
        self,
        url: str,
        headers: Dict[str, str] | None = None,
        params: Dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> HttpResponse:
        """
        Make a GET request.

        Args:
            url: Request URL
            headers: Request headers
            params: Query parameters
            timeout: Request timeout

        Returns:
            HttpResponse

        Example:
            response = ctx.http.get(
                "https://api.github.com/repos/owner/repo",
                headers={"Accept": "application/vnd.github.v3+json"}
            )
            repo = response.json()
        """
        return self._make_request(
            "GET",
            url,
            headers=headers,
            params=params,
            timeout=timeout,
            idempotency_key=self._get_idempotency_key("get"),
        )

    def post(
        self,
        url: str,
        headers: Dict[str, str] | None = None,
        params: Dict[str, Any] | None = None,
        json: Dict[str, Any] | None = None,
        data: Any = None,
        timeout: float | None = None,
    ) -> HttpResponse:
        """
        Make a POST request.

        Args:
            url: Request URL
            headers: Request headers
            params: Query parameters
            json: JSON body (sets Content-Type: application/json)
            data: Form data or raw body
            timeout: Request timeout

        Returns:
            HttpResponse

        Example:
            response = ctx.http.post(
                "https://api.openai.com/v1/completions",
                headers={"Authorization": f"Bearer {ctx.secrets.get('OPENAI_KEY')}"},
                json={"model": "gpt-4", "prompt": "Hello!"}
            )
        """
        return self._make_request(
            "POST",
            url,
            headers=headers,
            params=params,
            json=json,
            data=data,
            timeout=timeout,
            idempotency_key=self._get_idempotency_key("post"),
        )

    def put(
        self,
        url: str,
        headers: Dict[str, str] | None = None,
        params: Dict[str, Any] | None = None,
        json: Dict[str, Any] | None = None,
        data: Any = None,
        timeout: float | None = None,
    ) -> HttpResponse:
        """
        Make a PUT request.

        Args:
            url: Request URL
            headers: Request headers
            params: Query parameters
            json: JSON body
            data: Form data or raw body
            timeout: Request timeout

        Returns:
            HttpResponse
        """
        return self._make_request(
            "PUT",
            url,
            headers=headers,
            params=params,
            json=json,
            data=data,
            timeout=timeout,
            idempotency_key=self._get_idempotency_key("put"),
        )

    def patch(
        self,
        url: str,
        headers: Dict[str, str] | None = None,
        params: Dict[str, Any] | None = None,
        json: Dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> HttpResponse:
        """
        Make a PATCH request.

        Args:
            url: Request URL
            headers: Request headers
            params: Query parameters
            json: JSON body
            timeout: Request timeout

        Returns:
            HttpResponse
        """
        return self._make_request(
            "PATCH",
            url,
            headers=headers,
            params=params,
            json=json,
            timeout=timeout,
            idempotency_key=self._get_idempotency_key("patch"),
        )

    def delete(
        self,
        url: str,
        headers: Dict[str, str] | None = None,
        params: Dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> HttpResponse:
        """
        Make a DELETE request.

        Args:
            url: Request URL
            headers: Request headers
            params: Query parameters
            timeout: Request timeout

        Returns:
            HttpResponse
        """
        return self._make_request(
            "DELETE",
            url,
            headers=headers,
            params=params,
            timeout=timeout,
            idempotency_key=self._get_idempotency_key("delete"),
        )

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
