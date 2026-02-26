# Cuba Ops Digital Twin (FastAPI + Render)

This is the FastAPI package for Render deployment.

## Run locally
```bash
py -3.10 -m pip install -r requirements.txt
py -3.10 -m uvicorn server:app --reload --port 8000
```
Open http://localhost:8000

## Deploy on Render
Use **New → Blueprint** (Render reads `render.yaml`) or create a **Python Web Service** with:
- Build: `pip install -r requirements.txt`
- Start: `uvicorn server:app --host 0.0.0.0 --port $PORT`

### CORS
The browser fetches live feeds through `/proxy?url=...` so CORS is handled server-side.
