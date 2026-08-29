FROM python:3.11-slim

# libgl/glib are required by opencv, which ultralytics pulls in.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# Mount or COPY your checkpoint and point MODEL_PATH at it.
ENV MODEL_PATH=/srv/models/best.pt \
    IMGSZ=640 \
    ALLOWED_ORIGINS=*

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
