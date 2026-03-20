"""
Clerk JWT authentication for FastAPI.

How it works:
  1. Frontend obtains a short-lived JWT from Clerk after sign-in.
  2. Frontend sends it as `Authorization: Bearer <token>` on every request.
  3. This module fetches Clerk's public JWKS (cached in memory), verifies the
     JWT signature, and returns the Clerk user ID (the `sub` claim).

Dev-mode bypass:
  If CLERK_PUBLISHABLE_KEY is not set (local dev without Clerk),
  auth is skipped and all requests are treated as user "dev_user".
  Set the key in .env to enable real auth.
"""

import base64
import os
from typing import Optional

import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

_security = HTTPBearer(auto_error=False)
_jwks_cache: Optional[dict] = None


def _jwks_url() -> str:
    """Derive the Clerk JWKS URL from the publishable key."""
    key = os.getenv("CLERK_PUBLISHABLE_KEY", "")
    for prefix in ("pk_test_", "pk_live_"):
        if key.startswith(prefix):
            encoded = key[len(prefix):]
            try:
                # Clerk base64-encodes the frontend API domain with a trailing "$"
                padded = encoded + "=" * (-len(encoded) % 4)
                domain = base64.b64decode(padded).decode("utf-8").rstrip("$\x00 ")
                return f"https://{domain}/.well-known/jwks.json"
            except Exception:
                pass
    # Fallback: allow explicit override
    return os.getenv("CLERK_JWKS_URL", "")


async def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    url = _jwks_url()
    if not url:
        return {}
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=10)
        resp.raise_for_status()
        _jwks_cache = resp.json()
    return _jwks_cache


async def get_current_user_id(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_security),
) -> str:
    """
    FastAPI dependency — returns the Clerk user ID for the request.

    Usage:
        @router.get("/protected")
        def endpoint(user_id: str = Depends(get_current_user_id)):
            ...
    """
    # Dev-mode bypass: no Clerk key configured
    if not os.getenv("CLERK_PUBLISHABLE_KEY"):
        return "dev_user"

    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        jwks = await _get_jwks()
        payload = jwt.decode(
            credentials.credentials,
            jwks,
            algorithms=["RS256"],
            options={"verify_aud": False},  # Clerk JWTs omit aud by default
        )
        user_id: str = payload.get("sub", "")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing sub claim")
        return user_id
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}")
