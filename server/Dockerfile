FROM node:20-alpine

WORKDIR /app

# 云托管默认监听 80，容器端口需与服务设置里的「端口」一致
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=80 \
    HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --omit=dev

COPY src ./src

EXPOSE 80

# 健康检查：/api/health
CMD ["node", "src/server.js"]
