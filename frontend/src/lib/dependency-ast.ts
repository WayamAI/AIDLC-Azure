import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

export interface SourceFileInput {
  path: string;
  content: string;
}

export interface ParsedDependencyEdge {
  source: string;
  target: string;
  importPath: string;
}

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function dirname(filePath: string): string {
  const normalized = normalizeSlashes(filePath);
  const idx = normalized.lastIndexOf("/");
  return idx <= 0 ? "" : normalized.slice(0, idx);
}

function extname(filePath: string): string {
  const normalized = normalizeSlashes(filePath);
  const idx = normalized.lastIndexOf(".");
  if (idx < 0) return "";
  return normalized.slice(idx);
}

function resolveRelativePath(fromFile: string, relativeSpecifier: string): string {
  const fromDir = dirname(fromFile);
  const seed = normalizeSlashes(`${fromDir}/${relativeSpecifier}`);
  const parts = seed.split("/");
  const stack: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.join("/");
}

function resolveToKnownFile(candidate: string, knownFiles: Set<string>): string | null {
  if (knownFiles.has(candidate)) return candidate;

  for (const ext of SCRIPT_EXTENSIONS) {
    const withExt = `${candidate}${ext}`;
    if (knownFiles.has(withExt)) return withExt;
  }

  for (const ext of SCRIPT_EXTENSIONS) {
    const indexFile = `${candidate}/index${ext}`;
    if (knownFiles.has(indexFile)) return indexFile;
  }

  return null;
}

export function extractImportsFromCode(content: string): string[] {
  const imports: string[] = [];

  const ast = parse(content, {
    sourceType: "unambiguous",
    plugins: ["jsx", "typescript"],
    errorRecovery: true,
  });

  traverse(ast, {
    ImportDeclaration(path) {
      const value = path.node.source.value;
      if (typeof value === "string") imports.push(value);
    },
  });

  return imports;
}

export function buildDependencyEdgesFromFiles(files: SourceFileInput[]): ParsedDependencyEdge[] {
  const knownFiles = new Set(files.map((f) => normalizeSlashes(f.path)));
  const edges: ParsedDependencyEdge[] = [];

  for (const file of files) {
    const sourcePath = normalizeSlashes(file.path);
    let imports: string[] = [];

    try {
      imports = extractImportsFromCode(file.content);
    } catch {
      // Keep parser failures non-blocking to support mixed-quality repositories.
      imports = [];
    }

    for (const specifier of imports) {
      if (!specifier.startsWith(".")) continue;
      const resolvedBase = resolveRelativePath(sourcePath, specifier);
      const targetPath = resolveToKnownFile(resolvedBase, knownFiles);
      if (!targetPath) continue;

      edges.push({
        source: sourcePath,
        target: targetPath,
        importPath: specifier,
      });
    }
  }

  return edges;
}

export function inferFileExtension(filePath: string): string {
  const ext = extname(filePath).replace(".", "").toLowerCase();
  return ext || "unknown";
}
