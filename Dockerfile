FROM python:3.11-slim

WORKDIR /app
COPY . /app

RUN pip install --no-cache-dir -r requirements.txt

ENV PORT=8000
EXPOSE 8000

CMD ["bash","-lc","uvicorn server:app --host 0.0.0.0 --port ${PORT}"]
