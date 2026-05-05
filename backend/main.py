"""
后续接入真实数据时在此启动 API（Key / LLM 仅放服务端）。

  pip install fastapi uvicorn
  uvicorn main:app --reload --port 8000

前端开发时可将 js/api.js 中的 API_BASE 指向 http://127.0.0.1:8000
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Bit Desk API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"ok": True}
