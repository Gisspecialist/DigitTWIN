from __future__ import annotations

import time
import urllib.parse
from typing import Dict, Tuple, Optional

import httpx
from fastapi import FastAPI, Query, Response, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Cuba Ops Digital Twin", version="1.0")

# Serve frontend
app.mount("/", StaticFiles(directory="public", html=True), name="static")

# Very small in-memory cache for proxy responses
CACHE_TTL_SEC = 60
_cache: Dict[str, Tuple[float, bytes, str]] = {}  # url -> (expires_ts, content, content_type)

ALLOWLIST_PREFIXES = (
    "https://services.arcgis.com/",
    "https://services9.arcgis.com/",
    "https://maps.nccs.nasa.gov/",
    "https://flood-api.open-meteo.com/",
    "https://overpass-api.de/",
)

def _validate_url(url: str) -> str:
    url = url.strip()
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="Invalid url")
    if not url.startswith(ALLOWLIST_PREFIXES):
        raise HTTPException(status_code=400, detail="URL not allowed by proxy allowlist")
    return url

@app.get("/proxy")
async def proxy(url: str = Query(..., description="URL to fetch")):
    target = _validate_url(url)

    now = time.time()
    cached = _cache.get(target)
    if cached and cached[0] > now:
        expires_ts, content, ctype = cached
        return Response(content=content, media_type=ctype, headers={
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=60",
        })

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        r = await client.get(target, headers={"User-Agent": "CubaOpsTwin/1.0"})
        r.raise_for_status()
        content = r.content
        ctype = r.headers.get("content-type", "application/json")

    _cache[target] = (now + CACHE_TTL_SEC, content, ctype)
    return Response(content=content, media_type=ctype, headers={
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
    })

@app.options("/proxy")
async def proxy_options():
    return Response(status_code=204, headers={
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "*",
    })
