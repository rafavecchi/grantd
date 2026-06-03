from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Union

import httpx

from .errors import AgentAuthError, AuthorizationRequiredError
from .models import Connection, ConnectResult, ProviderInfo, TokenResult

_AUTH_ERROR_TYPES = {"not_found", "not_connected", "expired", "revoked"}
_DEFAULT_BASE = "http://localhost:8787"

Body = Union[Mapping[str, Any], list, str, bytes, None]


def _err_type(r: httpx.Response) -> Optional[str]:
    try:
        body = r.json()
    except Exception:
        return None
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return err.get("type")
    return None


def _result(r: httpx.Response) -> Any:
    if "application/json" in r.headers.get("content-type", ""):
        try:
            return r.json()
        except Exception:
            return r.text
    return r.text


def _payload(method: str, body: Body):
    """Returns (json, content) — only one is ever set."""
    if body is None or method == "GET":
        return None, None
    if isinstance(body, (dict, list)):
        return body, None
    return None, body


def _proxy_path(provider: str, user_id: str, path: str) -> str:
    p = path if path.startswith("/") else "/" + path
    return f"/v1/proxy/{provider}/{user_id}{p}"


def _connect_payload(user_id, provider, scopes, connection_config, redirect_uri) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"end_user_id": user_id, "provider": provider}
    if scopes is not None:
        payload["scopes"] = scopes
    if connection_config is not None:
        payload["connection_config"] = connection_config
    if redirect_uri is not None:
        payload["redirect_uri"] = redirect_uri
    return payload


def _err(label: str, r: httpx.Response) -> AgentAuthError:
    return AgentAuthError(f"{label} failed ({r.status_code})", r.status_code, _err_type(r), _result(r))


class AgentAuth:
    """Synchronous AgentAuth client."""

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE,
        timeout: float = 30.0,
        client: Optional[httpx.Client] = None,
    ):
        if not api_key:
            raise ValueError("AgentAuth: api_key is required")
        self._base_url = base_url.rstrip("/")
        self._auth = {"authorization": f"Bearer {api_key}"}
        self._client = client or httpx.Client(timeout=timeout)

    def __enter__(self) -> "AgentAuth":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _req(self, method, path, *, params=None, json=None, content=None, headers=None) -> httpx.Response:
        h = dict(self._auth)
        if headers:
            h.update(headers)
        return self._client.request(
            method, f"{self._base_url}{path}", params=params, json=json, content=content, headers=h
        )

    def _check_auth(self, r: httpx.Response, provider: str, user_id: str) -> None:
        if r.status_code in (404, 409) and _err_type(r) in _AUTH_ERROR_TYPES:
            url = None
            try:
                url = self.connect(user_id, provider).url
            except Exception:
                pass
            raise AuthorizationRequiredError(provider, user_id, url, _err_type(r) or "not_connected")

    def list_providers(self) -> List[ProviderInfo]:
        r = self._req("GET", "/v1/providers")
        if r.status_code >= 400:
            raise _err("list_providers", r)
        return [ProviderInfo(p["slug"], p["display_name"], p["auth_mode"]) for p in r.json().get("data", [])]

    def configure_integration(self, provider, client_id, client_secret, scopes=None) -> None:
        r = self._req(
            "PUT",
            f"/v1/integrations/{provider}",
            json={"client_id": client_id, "client_secret": client_secret, "scopes": scopes or []},
            headers={"content-type": "application/json"},
        )
        if r.status_code >= 400:
            raise _err("configure_integration", r)

    def connect(self, user_id, provider, scopes=None, connection_config=None, redirect_uri=None) -> ConnectResult:
        r = self._req(
            "POST",
            "/v1/connect_sessions",
            json=_connect_payload(user_id, provider, scopes, connection_config, redirect_uri),
            headers={"content-type": "application/json"},
        )
        if r.status_code >= 400:
            raise _err("connect", r)
        d = r.json()["data"]
        return ConnectResult(d["url"], d["provider"], d["end_user_id"], d["expires_at"])

    def list_connections(self) -> List[Connection]:
        r = self._req("GET", "/v1/connections")
        if r.status_code >= 400:
            raise _err("list_connections", r)
        return [
            Connection(
                c["provider"], c["end_user_id"], c["status"], c["granted_scopes"],
                c["expires_at"], c["last_active_at"], c["created_at"],
            )
            for c in r.json().get("data", [])
        ]

    def get_token(self, user_id, provider, force_refresh: bool = False) -> TokenResult:
        params = {"force_refresh": "true"} if force_refresh else None
        r = self._req("POST", f"/v1/connections/{provider}/{user_id}/token", params=params)
        self._check_auth(r, provider, user_id)
        if r.status_code >= 400:
            raise _err("get_token", r)
        d = r.json()["data"]
        return TokenResult(d["access_token"], d["expires_at"])

    def revoke(self, user_id, provider) -> None:
        r = self._req("DELETE", f"/v1/connections/{provider}/{user_id}")
        if r.status_code >= 400 and r.status_code != 404:
            raise _err("revoke", r)

    def proxy(self, user_id, provider, path, method="GET", body: Body = None, headers=None, query=None) -> Any:
        json_body, content = _payload(method, body)
        r = self._req(
            method, _proxy_path(provider, user_id, path), params=query, json=json_body, content=content, headers=headers
        )
        self._check_auth(r, provider, user_id)
        if r.status_code >= 400:
            raise _err("proxy", r)
        return _result(r)


class AsyncAgentAuth:
    """Asynchronous AgentAuth client."""

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE,
        timeout: float = 30.0,
        client: Optional[httpx.AsyncClient] = None,
    ):
        if not api_key:
            raise ValueError("AgentAuth: api_key is required")
        self._base_url = base_url.rstrip("/")
        self._auth = {"authorization": f"Bearer {api_key}"}
        self._client = client or httpx.AsyncClient(timeout=timeout)

    async def __aenter__(self) -> "AsyncAgentAuth":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def _req(self, method, path, *, params=None, json=None, content=None, headers=None) -> httpx.Response:
        h = dict(self._auth)
        if headers:
            h.update(headers)
        return await self._client.request(
            method, f"{self._base_url}{path}", params=params, json=json, content=content, headers=h
        )

    async def _check_auth(self, r: httpx.Response, provider: str, user_id: str) -> None:
        if r.status_code in (404, 409) and _err_type(r) in _AUTH_ERROR_TYPES:
            url = None
            try:
                url = (await self.connect(user_id, provider)).url
            except Exception:
                pass
            raise AuthorizationRequiredError(provider, user_id, url, _err_type(r) or "not_connected")

    async def list_providers(self) -> List[ProviderInfo]:
        r = await self._req("GET", "/v1/providers")
        if r.status_code >= 400:
            raise _err("list_providers", r)
        return [ProviderInfo(p["slug"], p["display_name"], p["auth_mode"]) for p in r.json().get("data", [])]

    async def configure_integration(self, provider, client_id, client_secret, scopes=None) -> None:
        r = await self._req(
            "PUT",
            f"/v1/integrations/{provider}",
            json={"client_id": client_id, "client_secret": client_secret, "scopes": scopes or []},
            headers={"content-type": "application/json"},
        )
        if r.status_code >= 400:
            raise _err("configure_integration", r)

    async def connect(self, user_id, provider, scopes=None, connection_config=None, redirect_uri=None) -> ConnectResult:
        r = await self._req(
            "POST",
            "/v1/connect_sessions",
            json=_connect_payload(user_id, provider, scopes, connection_config, redirect_uri),
            headers={"content-type": "application/json"},
        )
        if r.status_code >= 400:
            raise _err("connect", r)
        d = r.json()["data"]
        return ConnectResult(d["url"], d["provider"], d["end_user_id"], d["expires_at"])

    async def list_connections(self) -> List[Connection]:
        r = await self._req("GET", "/v1/connections")
        if r.status_code >= 400:
            raise _err("list_connections", r)
        return [
            Connection(
                c["provider"], c["end_user_id"], c["status"], c["granted_scopes"],
                c["expires_at"], c["last_active_at"], c["created_at"],
            )
            for c in r.json().get("data", [])
        ]

    async def get_token(self, user_id, provider, force_refresh: bool = False) -> TokenResult:
        params = {"force_refresh": "true"} if force_refresh else None
        r = await self._req("POST", f"/v1/connections/{provider}/{user_id}/token", params=params)
        await self._check_auth(r, provider, user_id)
        if r.status_code >= 400:
            raise _err("get_token", r)
        d = r.json()["data"]
        return TokenResult(d["access_token"], d["expires_at"])

    async def revoke(self, user_id, provider) -> None:
        r = await self._req("DELETE", f"/v1/connections/{provider}/{user_id}")
        if r.status_code >= 400 and r.status_code != 404:
            raise _err("revoke", r)

    async def proxy(self, user_id, provider, path, method="GET", body: Body = None, headers=None, query=None) -> Any:
        json_body, content = _payload(method, body)
        r = await self._req(
            method, _proxy_path(provider, user_id, path), params=query, json=json_body, content=content, headers=headers
        )
        await self._check_auth(r, provider, user_id)
        if r.status_code >= 400:
            raise _err("proxy", r)
        return _result(r)
