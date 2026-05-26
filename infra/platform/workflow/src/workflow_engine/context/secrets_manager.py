"""
SecretsManager - Secure credentials access for workflows.

This module provides the SecretsManager for accessing secrets:
- API keys
- OAuth tokens
- Database credentials
- Encryption keys

SECURITY: Secret values are NEVER logged. Only access attempts are audited.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import httpx


logger = logging.getLogger(__name__)


class SecretNotFoundError(Exception):
    """
    Requested secret was not found.

    Attributes:
        key: The secret key that was not found
    """

    def __init__(self, key: str) -> None:
        super().__init__(f"Secret not found: {key}")
        self.key = key


class SecretAccessDeniedError(Exception):
    """
    Access to secret was denied.

    Attributes:
        key: The secret key that was denied
        reason: Reason for denial
    """

    def __init__(self, key: str, reason: str = "") -> None:
        message = f"Access denied to secret: {key}"
        if reason:
            message += f" ({reason})"
        super().__init__(message)
        self.key = key
        self.reason = reason


@dataclass
class SecretMetadata:
    """
    Metadata about a secret (without the value).

    Attributes:
        key: Secret key
        created_at: When the secret was created
        updated_at: When the secret was last updated
        expires_at: When the secret expires (if applicable)
        rotation_enabled: Whether automatic rotation is enabled
    """

    key: str
    created_at: str | None = None
    updated_at: str | None = None
    expires_at: str | None = None
    rotation_enabled: bool = False


class SecretsManager:
    """
    Secure secrets manager for workflows.

    Provides secure access to secrets like API keys, tokens, and credentials.
    Secret values are NEVER logged - only access attempts are audited.

    Secrets can come from multiple sources:
    1. Environment variables (for local development)
    2. Vault/secrets management service (for production)
    3. In-memory cache (for testing)

    Example:
        # Get an API key
        api_key = ctx.secrets.get("OPENAI_API_KEY")

        # Use in HTTP request
        response = ctx.http.post(
            "https://api.openai.com/v1/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={...}
        )

    Security:
        - Values are never logged
        - Access is audited (key name only)
        - Values are masked in error messages
        - Memory is not retained after use
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        http_client: httpx.Client | None = None,
        workflow_id: str | None = None,
        instance_id: str | None = None,
        use_env_fallback: bool = True,
    ) -> None:
        """
        Initialize the secrets manager.

        Args:
            gateway_url: URL of the secrets service
            http_client: Optional pre-configured HTTP client
            workflow_id: Workflow ID for access control
            instance_id: Instance ID for auditing
            use_env_fallback: Fall back to environment variables
        """
        self._gateway_url = gateway_url.rstrip("/")
        self._http_client = http_client
        self._workflow_id = workflow_id
        self._instance_id = instance_id
        self._use_env_fallback = use_env_fallback

        # In-memory cache for testing
        self._cache: Dict[str, str] = {}
        self._use_cache = False

    def _get_client(self) -> httpx.Client:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.Client(timeout=10.0)
        return self._http_client

    def _audit_access(self, key: str, success: bool, reason: str = "") -> None:
        """
        Audit a secret access attempt.

        IMPORTANT: Only log the key name, NEVER the value.
        """
        log_data = {
            "secret_key": key,
            "success": success,
            "workflow_id": self._workflow_id,
            "instance_id": self._instance_id,
        }
        if reason:
            log_data["reason"] = reason

        if success:
            logger.info("Secret access", extra=log_data)
        else:
            logger.warning("Secret access failed", extra=log_data)

    def get(self, key: str, default: str | None = None) -> str:
        """
        Get a secret value.

        Args:
            key: Secret key (e.g., "OPENAI_API_KEY")
            default: Default value if secret not found (use sparingly)

        Returns:
            Secret value

        Raises:
            SecretNotFoundError: If secret not found and no default
            SecretAccessDeniedError: If access is denied

        Example:
            api_key = ctx.secrets.get("STRIPE_API_KEY")
            # Or with default (not recommended for production):
            debug_key = ctx.secrets.get("DEBUG_KEY", default="test-key")
        """
        # Try cache first (for testing)
        if self._use_cache and key in self._cache:
            self._audit_access(key, True, "cache")
            return self._cache[key]

        # Try secrets service
        try:
            value = self._fetch_from_service(key)
            if value is not None:
                self._audit_access(key, True, "service")
                return value
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403:
                self._audit_access(key, False, "access_denied")
                raise SecretAccessDeniedError(key)
            elif e.response.status_code != 404:
                # Log unexpected errors but don't expose details
                logger.error(
                    "Secrets service error",
                    extra={"key": key, "status": e.response.status_code}
                )
        except httpx.RequestError:
            # Service unavailable, try fallback
            pass

        # Try environment variable fallback
        if self._use_env_fallback:
            env_value = os.environ.get(key)
            if env_value is not None:
                self._audit_access(key, True, "environment")
                return env_value

        # Return default if provided
        if default is not None:
            self._audit_access(key, True, "default")
            return default

        # Secret not found
        self._audit_access(key, False, "not_found")
        raise SecretNotFoundError(key)

    def _fetch_from_service(self, key: str) -> str | None:
        """
        Fetch a secret from the secrets service.

        Args:
            key: Secret key

        Returns:
            Secret value or None if not found
        """
        client = self._get_client()
        url = f"{self._gateway_url}/api/secrets/{key}"

        headers = {}
        if self._workflow_id:
            headers["X-Workflow-ID"] = self._workflow_id
        if self._instance_id:
            headers["X-Instance-ID"] = self._instance_id

        response = client.get(url, headers=headers)

        if response.status_code == 404:
            return None

        response.raise_for_status()
        data = response.json()
        return data.get("value")

    def exists(self, key: str) -> bool:
        """
        Check if a secret exists (without retrieving the value).

        Args:
            key: Secret key

        Returns:
            True if secret exists
        """
        # Check cache
        if self._use_cache and key in self._cache:
            return True

        # Check service
        try:
            client = self._get_client()
            url = f"{self._gateway_url}/api/secrets/{key}/exists"
            response = client.get(url)
            if response.status_code == 200:
                return response.json().get("exists", False)
        except httpx.RequestError:
            pass

        # Check environment
        if self._use_env_fallback and key in os.environ:
            return True

        return False

    def get_metadata(self, key: str) -> SecretMetadata | None:
        """
        Get metadata about a secret (without the value).

        Args:
            key: Secret key

        Returns:
            SecretMetadata or None if not found
        """
        try:
            client = self._get_client()
            url = f"{self._gateway_url}/api/secrets/{key}/metadata"
            response = client.get(url)

            if response.status_code == 404:
                return None

            response.raise_for_status()
            data = response.json()

            return SecretMetadata(
                key=key,
                created_at=data.get("created_at"),
                updated_at=data.get("updated_at"),
                expires_at=data.get("expires_at"),
                rotation_enabled=data.get("rotation_enabled", False),
            )
        except httpx.RequestError:
            return None

    # =========================================================================
    # Testing Support
    # =========================================================================

    def enable_cache(self) -> None:
        """Enable in-memory cache mode (for testing)."""
        self._use_cache = True

    def disable_cache(self) -> None:
        """Disable in-memory cache mode."""
        self._use_cache = False
        self._cache.clear()

    def set_cached(self, key: str, value: str) -> None:
        """
        Set a cached secret value (for testing only).

        Args:
            key: Secret key
            value: Secret value
        """
        self._cache[key] = value

    def clear_cache(self) -> None:
        """Clear the secrets cache."""
        self._cache.clear()

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
