import { useMemo } from "react";

export function buildPreviewHtml(files: Record<string, string>): string {
  const css = Object.entries(files)
    .filter(([path]) => path.endsWith(".css"))
    .map(([, content]) =>
      content
        .replace(/@tailwind\s+base\s*;/g, "")
        .replace(/@tailwind\s+components\s*;/g, "")
        .replace(/@tailwind\s+utilities\s*;/g, ""),
    )
    .join("\n");

  const payload = JSON.stringify(files);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AIDLC preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    html, body, #root { height: 100%; margin: 0; }
    body { background: #0a0a0a; color: #f5f5f5; font-family: ui-sans-serif, system-ui, sans-serif; }
    ${css}
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="preview-error" style="display:none;padding:24px;font:13px/1.5 ui-monospace,monospace;color:#fca5a5;white-space:pre-wrap;"></div>
  <script type="module">
    const files = ${payload};

    function lookup(spec) {
      const candidates = [spec, spec + ".tsx", spec + ".ts", spec + ".jsx", spec + ".js", spec + "/index.tsx", spec + "/index.ts"];
      for (const c of candidates) if (files[c] != null) return c;
      return null;
    }
    function dirname(path) {
      const i = path.lastIndexOf("/");
      return i <= 0 ? "" : path.slice(0, i);
    }
    function resolvePath(from, spec) {
      const parts = (dirname(from) + "/" + spec).split("/");
      const out = [];
      for (const p of parts) {
        if (!p || p === ".") continue;
        if (p === "..") out.pop();
        else out.push(p);
      }
      return out.join("/");
    }
    function pkgUrl(spec) {
      if (spec === "react") return "https://esm.sh/react@18.3.1";
      if (spec === "react-dom") return "https://esm.sh/react-dom@18.3.1";
      if (spec === "react-dom/client") return "https://esm.sh/react-dom@18.3.1/client";
      if (spec === "react/jsx-runtime") return "https://esm.sh/react@18.3.1/jsx-runtime";
      if (spec === "react-router-dom") return "https://esm.sh/react-router-dom@6.28.0?deps=react@18.3.1,react-dom@18.3.1";
      if (spec === "lucide-react") return "https://esm.sh/lucide-react@0.460.0?deps=react@18.3.1";
      if (spec.startsWith("react/") || spec.startsWith("@")) return "https://esm.sh/" + spec + "?deps=react@18.3.1";
      return "https://esm.sh/" + spec + "?deps=react@18.3.1";
    }

    const showError = (msg) => {
      const el = document.getElementById("preview-error");
      const root = document.getElementById("root");
      if (root) root.style.display = "none";
      if (el) { el.style.display = "block"; el.textContent = msg; }
    };

    try {
      const Babel = await import("https://esm.sh/@babel/standalone@7.26.7");
      const urls = {};
      const compiling = {};

      async function compile(path) {
        if (urls[path]) return urls[path];
        if (compiling[path]) return compiling[path];
        compiling[path] = (async () => {
          let src = files[path];
          if (src == null) throw new Error("Missing file " + path);
          src = src.replace(/\\bBrowserRouter\\b/g, "HashRouter");
          src = src.replace(/import\\s+['"][^'"]+\\.css['"]\\s*;?/g, "");
          const localSpecs = [];
          src.replace(/from\\s+['"]([^'"]+)['"]/g, (_, spec) => {
            if (spec.startsWith(".") || spec.startsWith("/")) localSpecs.push(spec);
            return _;
          });
          for (const spec of localSpecs) {
            const resolved = lookup(resolvePath(path, spec));
            if (resolved) await compile(resolved);
          }
          let js = src;
          try {
            js = Babel.transform(src, {
              filename: path,
              presets: [["react", { runtime: "classic" }], "typescript"],
              retainLines: true,
            }).code;
          } catch (err) {
            throw new Error("Transform failed for " + path + "\\n" + (err && err.message ? err.message : String(err)));
          }
          js = js.replace(/from\\s+['"]([^'"]+)['"]/g, (_, spec) => {
            if (spec.startsWith(".") || spec.startsWith("/")) {
              const resolved = lookup(resolvePath(path, spec));
              if (!resolved || !urls[resolved]) {
                return "from " + JSON.stringify(pkgUrl(spec));
              }
              return "from " + JSON.stringify(urls[resolved]);
            }
            return "from " + JSON.stringify(pkgUrl(spec));
          });
          const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
          urls[path] = url;
          return url;
        })();
        return compiling[path];
      }

      const entry = files["src/main.tsx"] ? "src/main.tsx" : files["src/App.tsx"] ? "src/App.tsx" : null;
      if (!entry) {
        showError("No src/main.tsx or src/App.tsx in the generated workspace yet.");
      } else {
        const url = await compile(entry);
        await import(url);
      }
    } catch (err) {
      showError(err && err.stack ? err.stack : String(err));
    }
  </script>
</body>
</html>`;
}

export function AiIdePreview({ files }: { files: Record<string, string> }) {
  const srcDoc = useMemo(() => buildPreviewHtml(files), [files]);
  return (
    <iframe
      title="In-app preview"
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
      className="absolute inset-0 h-full w-full border-0 bg-background"
      srcDoc={srcDoc}
    />
  );
}
