# The real, pinned MoneyPrinterTurbo engine is installed in this Render container.
# This is not a reverse proxy to another machine.
FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000 \
    MPT_HOME=/tmp/omda-mpt-direct PYTHONPATH=/opt/MoneyPrinterTurbo \
    OMDA_MPT_ENABLE_JOBS=0
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates ffmpeg fonts-noto-core libharfbuzz0b libfribidi0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.12 /uv /usr/local/bin/uv
WORKDIR /opt/MoneyPrinterTurbo
ARG MPT_PIN=27843a994bfa29c43c02150861d51490a6ca4bd2
RUN git init -q && git remote add origin https://github.com/harry0703/MoneyPrinterTurbo.git \
    && git -c protocol.version=2 fetch --depth=1 origin "$MPT_PIN" \
    && git checkout -q --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "$MPT_PIN" \
    && test -f LICENSE && test -f cli.py && test -f requirements-security.txt \
    && printf '%s' "$MPT_PIN" > /opt/omda-mpt-version
RUN uv pip install --system --no-cache \
    --overrides requirements-security.txt -r requirements.txt \
    'setuptools>=82.0.1' 'wheel>=0.46.2' 'pytest==8.3.5'
COPY integrations/moneyprinter-direct/direct.py /opt/omda-direct/direct.py
COPY integrations/moneyprinter-direct/test_direct.py /opt/omda-direct/test_direct.py
COPY integrations/moneyprinter-direct/staging_once.py /opt/omda-direct/staging_once.py
COPY integrations/moneyprinter-direct/trial03.py /opt/omda-direct/trial03.py
RUN cd /opt/omda-direct && python -m pytest -q test_direct.py \
    && python -m py_compile staging_once.py trial03.py \
    && python /opt/MoneyPrinterTurbo/cli.py --help >/dev/null
RUN groupadd -g 10001 omda && useradd -u 10001 -g 10001 --system omda \
    && mkdir -p /tmp/omda-mpt-direct /opt/omda-direct \
    && chown 10001:10001 /tmp/omda-mpt-direct \
    && chmod 700 /tmp/omda-mpt-direct
USER 10001:10001
WORKDIR /opt/omda-direct
EXPOSE 10000
CMD ["sh","-c","python -u /opt/omda-direct/trial03.py & exec uvicorn direct:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]
