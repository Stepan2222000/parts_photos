FROM python:3.13-slim

# Image generation runs through the OpenAI SDK against an OpenAI-compatible
# /images/edits endpoint (see app/studio/worker.py) — no external CLI needed.
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY api/requirements.txt ./
RUN pip install -r requirements.txt

# The shared studio_core package lives in ../studio_core. Build context is
# the repo root, so we can copy it directly. Installed regular (not editable)
# inside the image — the source never changes at runtime.
COPY studio_core /studio_core
RUN pip install /studio_core

COPY api/app ./app
COPY api/sql ./sql

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
