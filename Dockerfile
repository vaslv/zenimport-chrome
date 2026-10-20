FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS unit-tests
COPY extension ./extension
COPY contracts ./contracts
COPY tests ./tests
COPY src ./src
COPY scripts/bundle-contracts.mjs scripts/run-business-contracts.mjs scripts/build-storage-schema.mjs scripts/portable-format-interop.mjs ./scripts/
COPY scripts/portable-values-budget.mjs ./scripts/
RUN node scripts/build-storage-schema.mjs --check && node scripts/bundle-contracts.mjs
USER node
CMD ["node", "--test", "tests/*.test.mjs"]

FROM dependencies AS compiled
COPY extension ./extension
COPY src ./src
COPY tsconfig.json ./
COPY scripts/bundle.mjs ./scripts/
RUN npm run typecheck && npm run build:bundle

FROM mcr.microsoft.com/playwright/python:v1.58.0-noble@sha256:678457c4c323b981d8b4befc57b95366bb1bb6aa30057b1269f6b171e8d9975a AS browser-base
WORKDIR /app
RUN pip install --no-cache-dir playwright==1.58.0 pytest==8.3.5

FROM browser-base AS chrome140-binary
RUN curl -fsSL https://storage.googleapis.com/chrome-for-testing-public/140.0.7339.80/linux64/chrome-linux64.zip -o /tmp/chrome.zip \
    && echo '7184052e2155f270dd49503b1c9c7163204f3a7bc0fba9bd9e746dde04eb0546  /tmp/chrome.zip' | sha256sum -c - \
    && python -m zipfile -e /tmp/chrome.zip /opt/chrome140 \
    && chmod +x /opt/chrome140/chrome-linux64/chrome /opt/chrome140/chrome-linux64/chrome_crashpad_handler /opt/chrome140/chrome-linux64/chrome_sandbox \
    && rm /tmp/chrome.zip

FROM browser-base AS browser-tests
COPY extension ./extension
COPY contracts ./contracts
COPY scripts/build.py ./scripts/build.py
COPY --from=compiled /app/.local/bundle ./.local/bundle
COPY --from=compiled /app/.local/probes ./.local/probes
COPY LICENSE PRIVACY.md THIRD_PARTY_NOTICES.md ./
RUN python scripts/build.py --compiled .local/bundle
COPY tests/browser ./tests/browser
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/browser"]

FROM browser-tests AS local-runtime-tests
ENV XDG_CONFIG_HOME=/tmp/chrome-config XDG_CACHE_HOME=/tmp/chrome-cache
RUN apt-get update && apt-get install -y --no-install-recommends xdotool && rm -rf /var/lib/apt/lists/*
COPY tests/local ./tests/local
COPY scripts/local-runtime-live.py ./scripts/
CMD ["xvfb-run", "-a", "python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/local"]

FROM local-runtime-tests AS local-chrome140
COPY --from=chrome140-binary /opt/chrome140 /opt/chrome140
ENV CHROME_EXECUTABLE=/opt/chrome140/chrome-linux64/chrome

FROM scratch AS release-artifacts
COPY --from=browser-tests /app/dist/ /
