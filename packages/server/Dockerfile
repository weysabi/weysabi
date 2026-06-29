FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/weysabi/package.json packages/weysabi/
COPY packages/server/package.json packages/server/
COPY packages/server/tsconfig.json packages/server/
COPY tsconfig.json .

RUN bun install --frozen-lockfile --production

COPY packages/weysabi/src packages/weysabi/src
COPY packages/server/src packages/server/src
COPY packages/server/drizzle packages/server/drizzle

ENV WEYSABI_PORT=3000
EXPOSE 3000

CMD ["bun", "run", "packages/server/src/start.ts"]
