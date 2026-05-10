FROM python:3.13-slim

# The codex CLI is required by the studio worker image (the same Dockerfile
# is used for both api and worker). Node is needed because codex ships as an
# npm package. The api itself does not invoke codex but installing it here
# keeps a single image for both services.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g @openai/codex \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

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
