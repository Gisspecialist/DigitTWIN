# Cuba Ops Digital Twin (Online Package)

This package is designed to be deployed online as a single web app:
- Frontend: Leaflet map + live hazard feeds + schools/hospitals (OSM) with clustering
- Backend: FastAPI server that serves the static site and provides a **CORS-enabled proxy** at `/proxy?url=...`

## Run locally
```bash
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```
Open: http://localhost:8000

## Deploy online (recommended options)

### Option A — Render (simple)
Render supports free web services (with limits / possible cold starts). See Render docs. citeturn0search0turn0search4

1. Push this folder to GitHub
2. In Render: New > Blueprint, point to your repo
3. Render will read `render.yaml` and deploy

### Option B — Cloudflare Pages + Worker proxy
If you prefer static hosting + a tiny proxy, Cloudflare Workers provides an official CORS proxy example. citeturn0search3turn0search7

## Notes on “free tiers”
- Railway’s “free” is a trial then $1/mo baseline (per their pricing page). citeturn0search1
- Fly.io does not offer a perpetual free tier; it’s trial/usage based. citeturn0search2turn0search10

## Security
The proxy uses an **allowlist** to prevent becoming an open proxy.
