import audio from "material-icon-theme/icons/audio.svg";
import c from "material-icon-theme/icons/c.svg";
import certificate from "material-icon-theme/icons/certificate.svg";
import consoleIcon from "material-icon-theme/icons/console.svg";
import cpp from "material-icon-theme/icons/cpp.svg";
import csharp from "material-icon-theme/icons/csharp.svg";
import css from "material-icon-theme/icons/css.svg";
import database from "material-icon-theme/icons/database.svg";
import docker from "material-icon-theme/icons/docker.svg";
import documentIcon from "material-icon-theme/icons/document.svg";
import eslint from "material-icon-theme/icons/eslint.svg";
import file from "material-icon-theme/icons/file.svg";
import folder from "material-icon-theme/icons/folder.svg";
import folderOpen from "material-icon-theme/icons/folder-open.svg";
import font from "material-icon-theme/icons/font.svg";
import git from "material-icon-theme/icons/git.svg";
import go from "material-icon-theme/icons/go.svg";
import html from "material-icon-theme/icons/html.svg";
import image from "material-icon-theme/icons/image.svg";
import java from "material-icon-theme/icons/java.svg";
import javascript from "material-icon-theme/icons/javascript.svg";
import json from "material-icon-theme/icons/json.svg";
import key from "material-icon-theme/icons/key.svg";
import kotlin from "material-icon-theme/icons/kotlin.svg";
import license from "material-icon-theme/icons/license.svg";
import lock from "material-icon-theme/icons/lock.svg";
import log from "material-icon-theme/icons/log.svg";
import markdown from "material-icon-theme/icons/markdown.svg";
import nodejs from "material-icon-theme/icons/nodejs.svg";
import pdf from "material-icon-theme/icons/pdf.svg";
import php from "material-icon-theme/icons/php.svg";
import playwright from "material-icon-theme/icons/playwright.svg";
import powerpoint from "material-icon-theme/icons/powerpoint.svg";
import prettier from "material-icon-theme/icons/prettier.svg";
import python from "material-icon-theme/icons/python.svg";
import react from "material-icon-theme/icons/react.svg";
import reactTs from "material-icon-theme/icons/react_ts.svg";
import readme from "material-icon-theme/icons/readme.svg";
import ruby from "material-icon-theme/icons/ruby.svg";
import rust from "material-icon-theme/icons/rust.svg";
import sass from "material-icon-theme/icons/sass.svg";
import settings from "material-icon-theme/icons/settings.svg";
import svg from "material-icon-theme/icons/svg.svg";
import swift from "material-icon-theme/icons/swift.svg";
import table from "material-icon-theme/icons/table.svg";
import tailwind from "material-icon-theme/icons/tailwindcss.svg";
import testJs from "material-icon-theme/icons/test-js.svg";
import testJsx from "material-icon-theme/icons/test-jsx.svg";
import testTs from "material-icon-theme/icons/test-ts.svg";
import toml from "material-icon-theme/icons/toml.svg";
import typescript from "material-icon-theme/icons/typescript.svg";
import video from "material-icon-theme/icons/video.svg";
import vite from "material-icon-theme/icons/vite.svg";
import vue from "material-icon-theme/icons/vue.svg";
import word from "material-icon-theme/icons/word.svg";
import xml from "material-icon-theme/icons/xml.svg";
import yaml from "material-icon-theme/icons/yaml.svg";
import zip from "material-icon-theme/icons/zip.svg";
import { cn } from "@/lib/utils";

/** Whole-filename matches win over extensions (lower-cased). */
const BY_NAME: Record<string, string> = {
  "package.json": nodejs,
  "package-lock.json": nodejs,
  dockerfile: docker,
  "docker-compose.yml": docker,
  "docker-compose.yaml": docker,
  ".dockerignore": docker,
  ".gitignore": git,
  ".gitattributes": git,
  "readme.md": readme,
  license: license,
  "license.md": license,
  ".prettierrc": prettier,
  ".eslintrc": eslint,
  ".eslintrc.json": eslint,
  ".env": settings,
};

/** Prefix matches for config files that come in several extensions. */
const BY_PREFIX: [string, string][] = [
  ["vite.config.", vite],
  ["vitest.config.", vite],
  ["tailwind.config.", tailwind],
  ["eslint.config.", eslint],
  ["playwright.config.", playwright],
  [".env.", settings],
];

const BY_EXTENSION: Record<string, string> = {
  tsx: reactTs,
  jsx: react,
  ts: typescript,
  mts: typescript,
  cts: typescript,
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  py: python,
  go: go,
  rs: rust,
  java: java,
  kt: kotlin,
  swift: swift,
  cs: csharp,
  c: c,
  h: c,
  cpp: cpp,
  hpp: cpp,
  php: php,
  rb: ruby,
  vue: vue,
  html: html,
  htm: html,
  css: css,
  scss: sass,
  sass: sass,
  json: json,
  jsonc: json,
  yml: yaml,
  yaml: yaml,
  toml: toml,
  xml: xml,
  md: markdown,
  mdx: markdown,
  txt: documentIcon,
  rst: documentIcon,
  feature: documentIcon,
  pdf: pdf,
  doc: word,
  docx: word,
  xls: table,
  xlsx: table,
  csv: table,
  tsv: table,
  ppt: powerpoint,
  pptx: powerpoint,
  sql: database,
  db: database,
  sh: consoleIcon,
  bash: consoleIcon,
  ps1: consoleIcon,
  bat: consoleIcon,
  log: log,
  lock: lock,
  svg: svg,
  png: image,
  jpg: image,
  jpeg: image,
  gif: image,
  webp: image,
  ico: image,
  mp4: video,
  webm: video,
  mov: video,
  mp3: audio,
  wav: audio,
  woff: font,
  woff2: font,
  ttf: font,
  otf: font,
  zip: zip,
  gz: zip,
  tar: zip,
  pem: certificate,
  crt: certificate,
  key: key,
  ini: settings,
  cfg: settings,
  conf: settings,
};

const TEST_FILE = /\.(test|spec)\.(tsx?|jsx?|mts|mjs)$/;

export function fileIconSrc(path: string): string {
  const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const prefixed = BY_PREFIX.find(([prefix]) => name.startsWith(prefix));
  if (prefixed) return prefixed[1];

  const test = TEST_FILE.exec(name);
  if (test) return test[2] === "jsx" ? testJsx : test[2].startsWith("t") || test[2] === "mts" ? testTs : testJs;

  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return BY_EXTENSION[extension] ?? file;
}

/**
 * File-type icon chosen from the file name (TSX, Python, Excel, PDF, ...).
 * These are the one place colour identifies a type rather than a status.
 * Icons: Material Icon Theme (MIT).
 */
export function FileIcon({
  name,
  size = 16,
  className,
}: {
  /** File name or path; only the last segment is inspected. */
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={fileIconSrc(name)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      className={cn("shrink-0 select-none", className)}
    />
  );
}

export function FolderIcon({ open = false, size = 16, className }: { open?: boolean; size?: number; className?: string }) {
  return (
    <img
      src={open ? folderOpen : folder}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      className={cn("shrink-0 select-none", className)}
    />
  );
}
