import { describe, expect, it } from "vitest";
import { buildPreviewDocument, previewPayload } from "./AiIdePreview";
import { pendingPreviewFiles, type AiIdeState } from "@/context/AiIdeContext";

const base: AiIdeState = {
  workspaceId: "ws",
  files: {},
  filePaths: [],
  dirPaths: [],
  fileStatuses: {},
  openTabs: [],
  activeFile: null,
  status: "generating",
  statusMessage: "",
  generationLog: [],
  failedFiles: [],
  plannedFiles: [],
  streamingFile: null,
  generatedFiles: [],
  plan: null,
};

describe("previewPayload", () => {
  it("leaves pending files out and keys on the rest", () => {
    const files = { "src/App.tsx": "a", "src/pages/Home.tsx": "partial" };
    const a = previewPayload(files, ["src/pages/Home.tsx"]);
    expect(Object.keys(a.files)).toEqual(["src/App.tsx"]);
    expect(a.pending).toEqual(["src/pages/Home.tsx"]);

    // Tokens streaming into the pending file do not change the key...
    const b = previewPayload({ ...files, "src/pages/Home.tsx": "partial + more" }, ["src/pages/Home.tsx"]);
    expect(b.key).toBe(a.key);
    // ...but an edit to a compiled file, or the file landing, does.
    expect(previewPayload({ ...files, "src/App.tsx": "b" }, ["src/pages/Home.tsx"]).key).not.toBe(a.key);
    expect(previewPayload(files, []).key).not.toBe(a.key);
  });

  it("tells apart contents of equal length", () => {
    const x = previewPayload({ "src/App.tsx": "abc" }, []);
    const y = previewPayload({ "src/App.tsx": "abd" }, []);
    expect(x.key).not.toBe(y.key);
  });
});

describe("buildPreviewDocument", () => {
  it("is a sandboxed document that carries the runtime and Tailwind", () => {
    const html = buildPreviewDocument();
    expect(html).toContain("https://cdn.tailwindcss.com");
    expect(html).toContain('<div id="root"></div>');
    expect(html).toContain("chakram-preview");
    // The runtime is inlined as text, so it must not be able to end the script tag early.
    const body = html.slice(html.indexOf('<script type="module">'));
    expect(body.match(/<\/script>/g)?.length).toBe(1);
  });
});

describe("pendingPreviewFiles", () => {
  it("lists planned files until they are generated or fail, plus the streaming one", () => {
    const state: AiIdeState = {
      ...base,
      plannedFiles: ["src/components/Navbar.tsx", "src/pages/Home.tsx", "src/pages/About.tsx"],
      generatedFiles: ["src/components/Navbar.tsx"],
      streamingFile: "src/pages/Home.tsx",
      failedFiles: [{ path: "src/pages/About.tsx", message: "timed out" }],
      fileStatuses: { "src/pages/Extra.tsx": "P" },
    };
    expect(pendingPreviewFiles(state)).toEqual(["src/pages/Extra.tsx", "src/pages/Home.tsx"]);
  });

  it("is empty once a run is over", () => {
    expect(pendingPreviewFiles({ ...base, status: "done" })).toEqual([]);
  });
});
