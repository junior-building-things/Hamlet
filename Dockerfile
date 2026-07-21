FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app

# Every LLM call in the app shells out to this binary (lib/llm.ts). It
# authenticates with CLAUDE_CODE_OAUTH_TOKEN, injected at deploy time from
# Secret Manager — never with ANTHROPIC_API_KEY, which would silently switch
# the CLI to per-token API billing instead of the subscription.
# ripgrep is a runtime dependency of the CLI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @anthropic-ai/claude-code \
    && claude --version

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# The CLI writes session/config state under $HOME on every invocation. Cloud
# Run's root filesystem is an in-memory overlay, so point it at a directory
# that definitely exists and is writable.
ENV HOME=/home/hamlet
RUN mkdir -p /home/hamlet && chmod 777 /home/hamlet

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
