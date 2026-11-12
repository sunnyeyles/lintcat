FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep ca-certificates coreutils \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && useradd --create-home --uid 10001 --shell /bin/sh factory \
  && mkdir -p /workspace

ENV HOME=/tmp/home \
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=true \
  HUSKY=0

USER factory
WORKDIR /workspace
CMD ["sleep", "infinity"]
