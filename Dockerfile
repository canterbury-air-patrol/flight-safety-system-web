# Stage 1: Build frontend bundle
FROM node:26-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json esbuild.config.json ./
RUN npm ci
COPY frontend/ ./frontend/
RUN npm run build-only

# Stage 2: Install Python dependencies
FROM python:3.14-slim AS python-builder
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libgdal-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/
RUN python3 -m venv /venv && \
    /venv/bin/pip install --no-cache-dir wheel && \
    /venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

# Stage 3: Runtime image
FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libgdal36 mime-support && rm -rf /var/lib/apt/lists/*
COPY --from=python-builder /venv /venv
WORKDIR /code
COPY --from=frontend /app/dist ./dist/
COPY fss/ ./fss/
COPY main/ ./main/
COPY config/ ./config/
COPY assets/ ./assets/
COPY manage.py ./
COPY docker/ ./docker/
ENV PATH="/venv/bin:$PATH"
ENTRYPOINT ["/code/docker/start.sh"]
