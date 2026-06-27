import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const config: NextConfig = {
  images: { unoptimized: true },
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
};

const withMDX = createMDX({
  configPath: fileURLToPath(new URL("./source.config.mjs", import.meta.url)),
});

export default withMDX(config);
