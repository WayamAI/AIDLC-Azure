import { describe, expect, it } from "vitest";
import {
  applyTextEdit,
  findOpeningTag,
  readClassName,
  setClassName,
  type TagLocation,
} from "./source-edit";

/** Locates a tag in source and fails the test if it is missing. */
function locate(source: string, line: number, tag: string, domClass?: string | null): TagLocation {
  const loc = findOpeningTag(source, line, tag, domClass);
  if (!loc) throw new Error(`no <${tag} on line ${line}`);
  return loc;
}

describe("findOpeningTag", () => {
  it("returns start, end and text of a single-line opening tag", () => {
    const src = `<div>\n  <span className="a">Hi</span>\n</div>`;
    const loc = locate(src, 2, "span");
    expect(loc.tag).toBe("span");
    expect(loc.text).toBe('<span className="a">');
    expect(src[loc.start]).toBe("<");
    expect(loc.end).toBe(loc.start + loc.text.length);
    expect(src.slice(loc.start, loc.end)).toBe(loc.text);
  });

  it("finds a tag that starts on the given 1-based line", () => {
    const src = `a\nb\n<span>x</span>`;
    expect(findOpeningTag(src, 3, "span")?.start).toBe(4);
    expect(findOpeningTag(src, 1, "span")).toBeNull();
  });

  it("handles a multi-line opening tag with arrow functions and > inside braces", () => {
    const src = [
      "export function App() {",
      "  return (",
      "    <button",
      "      className=\"btn\"",
      "      onClick={() => a > b}",
      "      disabled={x >= 2}",
      "    >",
      "      Save",
      "    </button>",
      "  );",
      "}",
    ].join("\n");
    const loc = locate(src, 3, "button");
    expect(loc.text.endsWith("\n    >")).toBe(true);
    expect(loc.text).toContain("onClick={() => a > b}");
    expect(src.slice(loc.end).trimStart().startsWith("Save")).toBe(true);
    expect(readClassName(loc)).toEqual({ kind: "literal", value: "btn" });
  });

  it("ignores > inside string attributes and template literals", () => {
    const src = '<p title="a > b" data-x={`${n > 1 ? "}" : ">"}`} className="p">Text</p>';
    const loc = locate(src, 1, "p");
    expect(loc.text).toBe(
      '<p title="a > b" data-x={`${n > 1 ? "}" : ">"}`} className="p">',
    );
    expect(readClassName(loc)).toEqual({ kind: "literal", value: "p" });
  });

  it("handles a self-closing tag", () => {
    const src = '<img src="a.png" className="pic" />';
    expect(locate(src, 1, "img").text).toBe(src);
  });

  it("does not match <div inside <divider", () => {
    const src = "<divider className=\"x\" />\n<div>ok</div>";
    expect(findOpeningTag(src, 1, "div")).toBeNull();
    expect(locate(src, 2, "div").text).toBe("<div>");
  });

  it("does not match a closing tag", () => {
    const src = "<span>x</span>";
    expect(locate(src, 1, "span").text).toBe("<span>");
    expect(findOpeningTag("</span>", 1, "span")).toBeNull();
  });

  it("disambiguates two <span on one line by domClass", () => {
    const src = '<div><span className="a">One</span><span className="b c">Two</span></div>';
    const second = locate(src, 1, "span", "c b");
    expect(second.start).toBe(src.indexOf('<span className="b c">'));
    const first = locate(src, 1, "span", "a");
    expect(first.start).toBe(src.indexOf('<span className="a">'));
  });

  it("falls back to the first candidate when no class matches", () => {
    const src = '<span className="a">One</span><span className="b">Two</span>';
    expect(locate(src, 1, "span", "zzz").start).toBe(0);
    expect(locate(src, 1, "span", null).start).toBe(0);
  });

  it("returns null when the tag is absent from that line", () => {
    expect(findOpeningTag("<span>a</span>", 2, "span")).toBeNull();
    expect(findOpeningTag("<span>a</span>", 1, "p")).toBeNull();
  });
});

describe("readClassName", () => {
  const tagOf = (text: string): TagLocation => ({ start: 0, end: text.length, tag: "span", text });

  it("reads a double-quoted literal", () => {
    expect(readClassName(tagOf('<span className="a b">'))).toEqual({ kind: "literal", value: "a b" });
  });

  it("reads a single-quoted literal", () => {
    expect(readClassName(tagOf("<span className='x y'>"))).toEqual({ kind: "literal", value: "x y" });
  });

  it('reads {"..."} and {\'...\'} as literals', () => {
    expect(readClassName(tagOf('<span className={"x"}>'))).toEqual({ kind: "literal", value: "x" });
    expect(readClassName(tagOf("<span className={'x z'}>"))).toEqual({ kind: "literal", value: "x z" });
  });

  it("reports absent className as none", () => {
    expect(readClassName(tagOf('<span id="a">'))).toEqual({ kind: "none" });
  });

  it("reports other expressions as dynamic with raw inside the braces", () => {
    expect(readClassName(tagOf("<span className={cx('a', b)}>"))).toEqual({
      kind: "dynamic",
      raw: "cx('a', b)",
    });
    expect(readClassName(tagOf('<span className={"a" + b}>'))).toEqual({
      kind: "dynamic",
      raw: '"a" + b',
    });
    expect(readClassName(tagOf("<span className={`a ${b}`}>"))).toEqual({
      kind: "dynamic",
      raw: "`a ${b}`",
    });
  });

  it("ignores data-className and className inside a handler", () => {
    expect(readClassName(tagOf('<span data-className="x">'))).toEqual({ kind: "none" });
    expect(readClassName(tagOf("<span onClick={() => f(' className=\"y\"')}>"))).toEqual({ kind: "none" });
  });
});

describe("setClassName", () => {
  it("replaces a double-quoted literal and keeps the quote style", () => {
    const src = '<div>\n<span className="old" id="s">Hi</span>\n</div>';
    const tag = locate(src, 2, "span");
    expect(setClassName(src, tag, "new cls")).toBe(
      '<div>\n<span className="new cls" id="s">Hi</span>\n</div>',
    );
  });

  it("keeps single quotes", () => {
    const src = "<span className='old'>x</span>";
    expect(setClassName(src, locate(src, 1, "span"), "n")).toBe("<span className='n'>x</span>");
  });

  it("replaces the content of a {\"...\"} literal and keeps the braces", () => {
    const src = '<span className={"old"}>x</span>';
    expect(setClassName(src, locate(src, 1, "span"), "a b")).toBe('<span className={"a b"}>x</span>');
  });

  it("inserts className after the tag name when absent", () => {
    const src = "<span id=\"x\">Hi</span>";
    expect(setClassName(src, locate(src, 1, "span"), "p-2")).toBe(
      '<span className="p-2" id="x">Hi</span>',
    );
    const selfClosing = "<br/>";
    expect(setClassName(selfClosing, locate(selfClosing, 1, "br"), "m")).toBe('<br className="m"/>');
  });

  it("escapes a double quote in the new class for a JSX attribute", () => {
    const src = '<span className="a">x</span>';
    const out = setClassName(src, locate(src, 1, "span"), 'say "hi"');
    expect(out).toBe('<span className="say &quot;hi&quot;">x</span>');
    expect(readClassName(locate(out!, 1, "span"))).toEqual({ kind: "literal", value: "say &quot;hi&quot;" });
  });

  it("escapes quotes and backslashes in a {\"...\"} literal", () => {
    const src = '<span className={"a"}>x</span>';
    const out = setClassName(src, locate(src, 1, "span"), 'a"b\\c');
    expect(out).toBe('<span className={"a\\"b\\\\c"}>x</span>');
    expect(readClassName(locate(out!, 1, "span"))).toEqual({ kind: "literal", value: 'a"b\\c' });
  });

  it("returns null for a dynamic className", () => {
    const src = "<span className={cx(a)}>x</span>";
    expect(setClassName(src, locate(src, 1, "span"), "x")).toBeNull();
  });

  it("only edits the top-level className attribute", () => {
    const src = '<span title="className=\\"no\\"" className="yes">x</span>';
    const out = setClassName(src, locate(src, 1, "span"), "z");
    expect(out).toBe('<span title="className=\\"no\\"" className="z">x</span>');
  });
});

describe("applyTextEdit", () => {
  it("edits JSX text and preserves surrounding whitespace and newlines", () => {
    const src = [
      "export default function A() {",
      "  return (",
      "    <button className=\"b\">",
      "        Start   workout",
      "    </button>",
      "  );",
      "}",
    ].join("\n");
    const tag = locate(src, 3, "button");
    const res = applyTextEdit({ "src/App.tsx": src }, "src/App.tsx", tag, "Start workout", "Begin session");
    expect(res).toEqual({
      ok: true,
      path: "src/App.tsx",
      content: src.replace("        Start   workout", "        Begin session"),
    });
  });

  it("preserves newlines around single-line JSX text", () => {
    const src = '<p>\n  Hello\n</p>';
    const tag = locate(src, 1, "p");
    const res = applyTextEdit({ "a.tsx": src }, "a.tsx", tag, "Hello", "Bye");
    expect(res).toMatchObject({ ok: true, content: "<p>\n  Bye\n</p>" });
  });

  it("writes newText containing braces or angle brackets as a JSON string expression", () => {
    const src = "<p>Old</p>";
    const tag = locate(src, 1, "p");
    const res = applyTextEdit({ "a.tsx": src }, "a.tsx", tag, "Old", "Use {x} < y");
    expect(res).toMatchObject({ ok: true, content: '<p>{"Use {x} < y"}</p>' });
  });

  it("does not touch the file when oldText equals newText", () => {
    const src = "<p>Same</p>";
    const tag = locate(src, 1, "p");
    expect(applyTextEdit({ "a.tsx": src }, "a.tsx", tag, "Same", "Same")).toEqual({
      ok: true,
      path: "a.tsx",
      content: src,
    });
  });

  it("edits a string literal in the same file when the text is not JSX text", () => {
    const src = [
      "const LABEL = 'Barbell Squat';",
      "export const A = () => <h2>{LABEL}</h2>;",
    ].join("\n");
    const tag = locate(src, 2, "h2");
    const res = applyTextEdit({ "src/A.tsx": src }, "src/A.tsx", tag, "Barbell Squat", "Back Squat");
    expect(res).toEqual({
      ok: true,
      path: "src/A.tsx",
      content: "const LABEL = 'Back Squat';\nexport const A = () => <h2>{LABEL}</h2>;",
    });
  });

  it("edits text that comes from a data array in another file", () => {
    const items = "export const items = [\n  { id: 1, name: 'Barbell Squat' },\n  { id: 2, name: 'Deadlift' },\n];\n";
    const app = "import { items } from './data/items';\nexport const A = () => <li className=\"row\">{items[0].name}</li>;";
    const files = { "src/App.tsx": app, "src/data/items.ts": items };
    const tag = locate(app, 2, "li");
    const res = applyTextEdit(files, "src/App.tsx", tag, "Barbell Squat", "Back Squat");
    expect(res).toEqual({
      ok: true,
      path: "src/data/items.ts",
      content: items.replace("'Barbell Squat'", "'Back Squat'"),
    });
  });

  it("escapes the quote character and backslashes when editing a literal", () => {
    const items = `export const t = { a: "Don't stop" };\n`;
    const app = "<p>{t}</p>";
    const files = { "src/App.tsx": app, "src/data.ts": items };
    const tag = locate(app, 1, "p");
    const res = applyTextEdit(files, "src/App.tsx", tag, "Don't stop", "It's \"ok\" \\ fine");
    expect(res).toMatchObject({ ok: true, path: "src/data.ts" });
    if (res.ok) {
      expect(res.content).toBe('export const t = { a: "It\'s \\"ok\\" \\\\ fine" };\n');
    }
  });

  it("finds a literal in a single-quoted string even after an apostrophe in JSX text", () => {
    const src = "<p>Don't do this</p>\nconst X = 'Deadlift';";
    const tag = locate(src, 1, "p");
    const res = applyTextEdit({ "a.tsx": src }, "a.tsx", tag, "Deadlift", "Romanian Deadlift");
    expect(res).toMatchObject({ ok: true, content: src.replace("'Deadlift'", "'Romanian Deadlift'") });
  });

  it("does not treat a template literal with ${ as an editable literal", () => {
    const src = "<p>{`Hi ${n}`}</p>";
    const tag = locate(src, 1, "p");
    const res = applyTextEdit({ "a.tsx": src }, "a.tsx", tag, "Hi", "Hello");
    expect(res).toEqual({
      ok: false,
      reason: "This text is computed in code, so it can't be edited directly. Ask the AI to change it.",
    });
  });

  it("edits a plain template literal", () => {
    const src = "const s = `Ready`;\n<p>{s}</p>";
    const tag = locate(src, 2, "p");
    const res = applyTextEdit({ "a.tsx": src }, "a.tsx", tag, "Ready", "Set");
    expect(res).toMatchObject({ ok: true, content: "const s = `Set`;\n<p>{s}</p>" });
  });

  it("reports not computed when the text appears nowhere", () => {
    const src = "<p>{score}</p>";
    const tag = locate(src, 1, "p");
    expect(applyTextEdit({ "a.tsx": src, "b.ts": "const x = 'other';" }, "a.tsx", tag, "42 points", "43 points")).toEqual({
      ok: false,
      reason: "This text is computed in code, so it can't be edited directly. Ask the AI to change it.",
    });
  });

  it("reports ambiguity when the same literal appears twice in the same file", () => {
    const src = "const a = 'Save';\nconst b = 'Save';\n<button>Save</button>";
    const tag = locate(src, 3, "button");
    // The JSX text itself matches step 1, so use a computed label to force the literal path.
    const computed = "const a = 'Save';\nconst b = 'Save';\n<button>{x}</button>";
    expect(applyTextEdit({ "a.tsx": src }, "a.tsx", tag, "Save", "Store")).toMatchObject({ ok: true });
    expect(applyTextEdit({ "a.tsx": computed }, "a.tsx", locate(computed, 3, "button"), "Save", "Store")).toEqual({
      ok: false,
      reason: "This text appears in several places; ask the AI to change the one you mean.",
    });
  });

  it("reports ambiguity when the same literal appears in two other files", () => {
    const app = "<p>{t}</p>";
    const files = {
      "src/App.tsx": app,
      "src/a.ts": "export const a = 'Shared';",
      "src/b.tsx": "export const b = \"Shared\";",
    };
    const res = applyTextEdit(files, "src/App.tsx", locate(app, 1, "p"), "Shared", "Other");
    expect(res).toEqual({
      ok: false,
      reason: "This text appears in several places; ask the AI to change the one you mean.",
    });
  });

  it("ignores non-source files when searching for literals", () => {
    const app = "<p>{t}</p>";
    const files = {
      "src/App.tsx": app,
      "docs/notes.md": "The label is 'Hello'.",
    };
    const res = applyTextEdit(files, "src/App.tsx", locate(app, 1, "p"), "Hello", "Hi");
    expect(res).toMatchObject({ ok: false });
  });

  it("returns an error for a missing file", () => {
    const src = "<p>x</p>";
    const res = applyTextEdit({}, "missing.tsx", locate(src, 1, "p"), "x", "y");
    expect(res.ok).toBe(false);
  });
});
