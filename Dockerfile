# 静态产物 + nginx。构建在镜像之外完成（CI 跑 scripts/build.mjs），镜像只负责发文件。
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="xmt" \
      org.opencontainers.image.description="桂林中学新媒体 · 静态站点" \
      org.opencontainers.image.source="https://github.com/idoknow/xmt"

COPY nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/

RUN nginx -t

EXPOSE 80
