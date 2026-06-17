# Contributing

Thanks for considering contributing to Sabi!

## Setup

```bash
git clone https://github.com/weysabi/sabi.git
cd sabi
bun install
```

Requires [Bun](https://bun.sh) 1.3+.

## Development

```bash
bun test                    # Run all tests
bun test src/path.test.ts   # Single test file
bun run lint                # ESLint
bun run format              # Prettier
bun run typecheck           # tsc --noEmit
bun run check               # All of the above + tests
```

## Project Structure

```
src/
  index.ts          # Sabi class + createSabi() factory
  types.ts          # Zod schemas + TS types
  providers.ts      # ProviderClient — HTTP, retry, circuit breaker
  providers/
    handler.ts      # ProviderHandler interface
    openai.ts       # OpenAI-compatible handler (Groq, Nvidia, etc.)
    anthropic.ts    # Anthropic Messages API handler
    google.ts       # Google Gemini handler
  prompts.ts        # PromptRegistry — templates with {variable}
  sse.ts            # Generic SSE response adapter
  stream.ts         # Client-side readStream helper
  errors.ts         # Error classes
  utils.ts          # Utilities (parseModel, tryParseJSON)
  logger.ts         # Structured logger (via @joinremba/catalog)
  hono.ts           # Hono adapter (re-exports SSE)
  next.ts           # Next.js adapter
  express.ts        # Express adapter
  fastify.ts        # Fastify adapter
  elysia.ts         # Elysia adapter
```

Tests live next to source: `src/*.test.ts`.

## Conventions

- **No `export default`** — named exports only
- **Zod** for all runtime validation
- **Custom error classes** extend `SabiError`
- **Tests mock `globalThis.fetch`** — no real API calls
- **Sub-path exports** in `package.json` for each adapter
- **Structured logging** via `createModuleLogger("module.name")` from `@joinremba/catalog`

## Adding a Provider

1. Create `src/providers/<name>.ts` implementing `ProviderHandler`
2. Add the handler to the dispatch map in `src/providers.ts`
3. Add tests in `src/providers.test.ts`
4. Add default `baseUrl` to `DEFAULT_BASE_URLS` in `src/providers.ts`

## Adding an Adapter

1. Create `src/<name>.ts`
2. Add export entry in `package.json` `exports` field
3. Add tests

## Pull Requests

- Keep changes focused — one feature per PR
- Update tests
- Run `bun run check` before submitting
- Match existing code style (Prettier will enforce)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
