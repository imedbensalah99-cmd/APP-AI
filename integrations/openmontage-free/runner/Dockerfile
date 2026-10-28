FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000 \
    OMDA_DOC_WORK_ROOT=/tmp/omda-documentaries \
    PYTHONPATH=/app/openmontage-free/runner
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY integrations/openmontage-free/runner/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY integrations/openmontage-free/ /app/openmontage-free/
RUN groupadd --gid 10001 omda && useradd --uid 10001 --gid 10001 --system omda \
    && mkdir -p /tmp/omda-documentaries && chown -R 10001:10001 /tmp/omda-documentaries
USER 10001:10001
EXPOSE 10000
CMD ["sh","-c","uvicorn api:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
