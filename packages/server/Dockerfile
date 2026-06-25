FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/sabi/package.json packages/sabi/
COPY packages/server/package.json packages/server/
COPY packages/server/tsconfig.json packages/server/
COPY tsconfig.json .

RUN bun install --frozen-lockfile --production

COPY packages/sabi/src packages/sabi/src
COPY packages/server/src packages/server/src

ENV SABI_PORT=3000
EXPOSE 3000

CMD ["bun", "run", "packages/server/src/start.ts"]
