"""설치형 프로그램에서 FastAPI를 자동 시작하는 진입점."""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, log_level="warning")
