from __future__ import annotations

from typing import Any, Optional


class AgentAuthError(Exception):
    """A broker request failed."""

    def __init__(self, message: str, status: int, type: Optional[str] = None, details: Any = None):
        super().__init__(message)
        self.status = status
        self.type = type
        self.details = details


class AuthorizationRequiredError(AgentAuthError):
    """The user has no usable connection. Carries a ready-to-use ``connect_url``."""

    def __init__(self, provider: str, user_id: str, connect_url: Optional[str], type: str):
        super().__init__(f'User "{user_id}" needs to authorize {provider}', 409, type)
        self.provider = provider
        self.user_id = user_id
        self.connect_url = connect_url
