FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KRONOS_ENV=development \
    KRONOS_ALLOWED_HOSTS=localhost,127.0.0.1

WORKDIR /srv/kronos

COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock \
    && useradd --system --uid 10001 --create-home kronos

COPY --chown=kronos:kronos app ./app
COPY --chown=kronos:kronos assets ./assets
COPY --chown=kronos:kronos config ./config
COPY --chown=kronos:kronos *.html ./

USER kronos
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/healthz', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1"]
