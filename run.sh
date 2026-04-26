#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

if ! command -v uv >/dev/null 2>&1; then
  echo "Missing required command: uv"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Missing required command: npm"
  exit 1
fi

if [ ! -d "$ROOT_DIR/.venv" ]; then
  echo "Python environment not found. Run 'uv sync' first."
  exit 1
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Frontend dependencies not found. Run 'cd frontend && npm install' first."
  exit 1
fi

cleanup() {
  trap - EXIT INT TERM

  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill -- -"${BACKEND_PID}" >/dev/null 2>&1 || true
  fi

  if [ -n "${FRONTEND_PID:-}" ] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill -- -"${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi

  wait "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}

handle_signal() {
  cleanup
  exit 130
}

trap cleanup EXIT
trap handle_signal INT TERM

echo "Starting backend on http://127.0.0.1:8010"
setsid bash -lc "cd \"$ROOT_DIR\" && exec uv run uvicorn main:app --host 127.0.0.1 --port 8010" &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:5173"
setsid bash -lc "cd \"$FRONTEND_DIR\" && exec npm run dev -- --host 0.0.0.0" &
FRONTEND_PID=$!

wait -n "$BACKEND_PID" "$FRONTEND_PID"
