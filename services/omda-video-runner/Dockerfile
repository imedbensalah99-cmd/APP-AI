FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000 OMDA_PIPER_MODEL=/opt/omda-voice/arabic-emirati-female-model.onnx
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core espeak-ng libharfbuzz0b libfribidi0 libgomp1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
# MIT-licensed Arabic Piper voice pinned to revision + checked against upstream SHA256.
COPY download_voice.py /app/download_voice.py
RUN python /app/download_voice.py
COPY src /app/src
COPY examples /app/examples
ENV PYTHONPATH=/app/src
RUN mkdir -p /tmp/omda && chmod 700 /tmp/omda
EXPOSE 10000
CMD ["sh","-c","uvicorn server:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]