```bash
pip install uv
```

```bash
cd lc0-bot-extension/bridge
```

```bash
uv sync
```

```bash
uv run uvicorn app.main:app --host 127.0.0.1 --port 3187 --workers 1
```