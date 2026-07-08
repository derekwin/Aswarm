# ── Build Frontend ──
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Production Image ──
FROM python:3.12-slim
WORKDIR /app

# Copy source and install
COPY pyproject.toml ./
COPY agent_swarm/ ./agent_swarm/
COPY backend/ ./backend/
COPY --from=frontend-builder /app/backend/static ./backend/static
RUN pip install --no-cache-dir ".[server]"

# Create data directories
RUN mkdir -p /app/data /app/checkpoints

ENV AGENTSWARM_LLM_BASE_URL=http://localhost:11434/v1
ENV AGENTSWARM_LLM_API_KEY=ollama
ENV AGENTSWARM_DECOMPOSER_MODEL=qwen3.5:35b
ENV AGENTSWARM_DEFAULT_MODEL=qwen3.5:35b
ENV AGENTSWARM_DATA_DIR=/app/data
ENV AGENTSWARM_CHECKPOINT_DIR=/app/checkpoints

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.server:app", "--host", "0.0.0.0", "--port", "8000"]
