import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileFromFile } from "json-schema-to-typescript";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(projectDir, "..");
const schemaDir = path.join(repoRoot, "schemas", "ident");
const outputDir = path.join(projectDir, "src", "data", "generated");
const outputFile = path.join(outputDir, "identSchemas.ts");
const check = process.argv.includes("--check");

const files = (await readdir(schemaDir))
  .filter((name) => name.endsWith(".schema.json"))
  .sort();

const chunks = [
  "/* eslint-disable */",
  "// biome-ignore-all lint/suspicious/noExplicitAny: generated JSON Schema types preserve open schema objects.",
  "// Generated from schemas/ident/*.schema.json.",
  "// Run `pnpm generate-ident-schemas` from ident/ to refresh.",
  "",
];

for (const file of files) {
  const body = await compileFromFile(path.join(schemaDir, file), {
    bannerComment: "",
    cwd: schemaDir,
    style: {
      bracketSpacing: true,
      printWidth: 80,
      semi: true,
      singleQuote: false,
      tabWidth: 2,
      trailingComma: "all",
      useTabs: false,
    },
    unknownAny: false,
  });
  chunks.push(body.trim(), "");
}

async function formatTypeScript(source) {
  const child = spawn("biome", ["format", "--stdin-file-path", outputFile], {
    cwd: projectDir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.stdin.end(source);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(Buffer.concat(stderr).toString("utf8"));
  }
  return Buffer.concat(stdout).toString("utf8");
}

const generated = await formatTypeScript(`${chunks.join("\n")}\n`);

if (check) {
  const existing = await readFile(outputFile, "utf8");
  if (existing !== generated) {
    console.error(
      "ident schema types are stale; run pnpm generate-ident-schemas",
    );
    process.exit(1);
  }
} else {
  await mkdir(outputDir, { recursive: true });
  await writeFile(outputFile, generated);
}
