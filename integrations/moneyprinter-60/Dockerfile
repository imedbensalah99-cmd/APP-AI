FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY api.py /app/api.py
RUN groupadd --gid 10001 omda && useradd --uid 10001 --gid 10001 --system omda && mkdir -p /tmp/omda-mpt-60 && chown 10001:10001 /tmp/omda-mpt-60
USER 10001:10001
EXPOSE 10000
CMD ["sh","-c","uvicorn api:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
