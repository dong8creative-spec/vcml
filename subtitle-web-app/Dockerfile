# 자막 생성기 — 웹/서버 배포용 (CPU 기본)
FROM python:3.11-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY static ./static

# 클라우드 무료 티어 등: base/small 권장. GPU는 별도 이미지·WHISPER_DEVICE 설정 필요.
ENV WHISPER_MODEL=small
ENV WHISPER_DEVICE=cpu
ENV WHISPER_COMPUTE=int8

EXPOSE 8765

# Railway/Render/Fly 등은 PORT 제공
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8765}"]
