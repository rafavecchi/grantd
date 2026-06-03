from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class ProviderInfo:
    slug: str
    display_name: str
    auth_mode: str


@dataclass
class ConnectResult:
    url: str
    provider: str
    user_id: str
    expires_at: str


@dataclass
class TokenResult:
    access_token: str
    expires_at: Optional[str]


@dataclass
class Connection:
    provider: str
    user_id: str
    status: str
    granted_scopes: List[str]
    expires_at: Optional[str]
    last_active_at: Optional[str]
    created_at: str
