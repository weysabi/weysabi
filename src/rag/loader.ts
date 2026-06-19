import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { extname, resolve, basename } from "path";

export interface LoadedFile {
  path: string;
  content: string;
  contentHash: string;
}

function hashContent(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

const SUPPORTED_EXTS = new Set([".txt", ".md", ".mdx", ".json", ".yaml", ".yml", ".csv", ".html"]);

export function isSupportedFile(path: string): boolean {
  return SUPPORTED_EXTS.has(extname(path).toLowerCase());
}

export function loadFile(filePath: string): LoadedFile {
  const resolved = resolve(filePath);

  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const content = readFileSync(resolved, "utf-8");
  return {
    path: resolved,
    content,
    contentHash: hashContent(content),
  };
}

export function loadDirectory(
  dirPath: string,
  recursive: boolean = true
): LoadedFile[] {
  const resolved = resolve(dirPath);

  if (!existsSync(resolved)) {
    throw new Error(`Directory not found: ${dirPath}`);
  }

  const results: LoadedFile[] = [];

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        if (recursive && !entry.name.startsWith(".")) {
          walk(fullPath);
        }
      } else if (entry.isFile() && isSupportedFile(fullPath)) {
        try {
          results.push(loadFile(fullPath));
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  walk(resolved);
  return results;
}

export function loadText(name: string, content: string): LoadedFile {
  return {
    path: resolve(process.cwd(), `.sabi/rag/files/${name}`),
    content,
    contentHash: hashContent(content),
  };
}
