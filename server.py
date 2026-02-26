from __future__ import annotations

import time
from typing import Dict, Tuple

import httpx
from fastapi import FastAPI, Query, Response, HTTPException
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Cuba Ops Digital Twin", version="1.1")

# Proxy allowlist (prevents open-proxy abuse)
ALLOWLIST_PREFIXES = (
    "https://services.arcgis.com/",
    "https://services9.arcgis.com/",
    "https://maps.nccs.nasa.gov/",
    "https://flood-api.open-meteo.com/",
    "https://overpass-api.de/",
)

# Tiny cache to speed repeat requests
CACHE_TTL_SEC = 60
_cache: Dict[str, Tuple[float, bytes, str]] = {}


def _validate_url(url: str) -> str:
    url = url.strip()
    if not (url.startswith("https://") or url.startswith("http://")):
        raise HTTPException(status_code=400, detail="Invalid url")
    if not url.startswith(ALLOWLIST_PREFIXES):
        raise HTTPException(status_code=400, detail="URL not allowed by proxy allowlist")
    return url


@app.get("/proxy")
async def proxy(url: str = Query(..., description="Full URL to fetch via server-side proxy")):
    """CORS-safe proxy endpoint: /proxy?url=<encoded-external-url>"""
    target = _validate_url(url)
    now = time.time()

    cached = _cache.get(target)
    if cached and cached[0] > now:
        _, content, ctype = cached
        return Response(
            content=content,
            media_type=ctype,
            headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60"},
        )

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        r = await client.get(target, headers={"User-Agent": "CubaOpsTwin/1.1"})
        r.raise_for_status()
        content = r.content
        ctype = r.headers.get("content-type", "application/json")

    _cache[target] = (now + CACHE_TTL_SEC, content, ctype)
    return Response(
        content=content,
        media_type=ctype,
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60"},
    )


@app.options("/proxy")
async def proxy_options():
    return Response(
        status_code=204,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,OPTIONS",
            "Access-Control-Allow-Headers": "*",
        },
    )


# IMPORTANT: mount StaticFiles AFTER defining /proxy routes,
# otherwise the '/' mount can swallow '/proxy' and return 404.
app.mount("/", StaticFiles(directory="public", html=True), name="static")
