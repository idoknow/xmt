# 站点静态产物 + Memories 服务（Node 原生 http + node:sqlite，无第三方依赖）
FROM node:24-alpine

LABEL org.opencontainers.image.title="xmt" \
      org.opencontainers.image.description="桂林中学新媒体 · 站点与 Memories 图片库" \
      org.opencontainers.image.source="https://github.com/idoknow/xmt"

WORKDIR /app
ENV NODE_ENV=production \
    PORT=1145 \
    DATA_DIR=/data \
    DIST_DIR=/app/dist

COPY server ./server
COPY scripts ./scripts
COPY dist ./dist
COPY package.json ./

RUN mkdir -p /data/files && chown -R node:node /data /app

USER node
EXPOSE 1145
VOLUME ["/data"]
CMD ["node", "server/index.mjs"]
