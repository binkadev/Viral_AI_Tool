FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    VIRAL_AI_ENV=production \
    VIRAL_AI_STATE_DRIVER=sqlite \
    VIRAL_AI_BIND_HOST=0.0.0.0 \
    VIRAL_AI_DEV_PORT=3000 \
    VIRAL_AI_DEV_DATA_DIR=/var/lib/viral-ai-tool \
    VIRAL_AI_BACKUP_DIR=/var/backups/viral-ai-tool

RUN mkdir -p /var/lib/viral-ai-tool /var/backups/viral-ai-tool \
    && chown -R node:node /app /var/lib/viral-ai-tool /var/backups/viral-ai-tool

COPY --chown=node:node dev-backend ./dev-backend

USER node

EXPOSE 3000

VOLUME ["/var/lib/viral-ai-tool", "/var/backups/viral-ai-tool"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dev-backend/server.js"]
