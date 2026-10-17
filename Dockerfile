FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS unit-tests
WORKDIR /app
COPY package.json ./
COPY extension ./extension
COPY tests ./tests
USER node
CMD ["node", "--test", "tests/*.test.mjs"]

FROM mcr.microsoft.com/playwright/python:v1.58.0-noble@sha256:678457c4c323b981d8b4befc57b95366bb1bb6aa30057b1269f6b171e8d9975a AS browser-tests
WORKDIR /app
RUN pip install --no-cache-dir playwright==1.58.0 pytest==8.3.5
COPY extension ./extension
COPY scripts/build.py ./scripts/build.py
COPY LICENSE PRIVACY.md ./
RUN python scripts/build.py
COPY tests/browser ./tests/browser
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/browser"]
