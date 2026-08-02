import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

const distDir = resolve(process.cwd(), "dist");
const modulePaths = await collectModules(distDir);
const missingImports = [];

for (const modulePath of modulePaths) {
  const source = await readFile(modulePath, "utf8");
  for (const importPath of relativeImports(source)) {
    const targetPath = resolve(dirname(modulePath), importPath);
    try {
      await access(targetPath);
    } catch {
      missingImports.push(
        `${modulePath.slice(distDir.length + 1)} -> ${importPath}`,
      );
    }
  }
}

if (missingImports.length > 0) {
  throw new Error(`Missing build imports:\n${missingImports.join("\n")}`);
}

async function collectModules(directory) {
  const modules = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      modules.push(...(await collectModules(entryPath)));
    } else if ([".js", ".mjs"].includes(extname(entry.name))) {
      modules.push(entryPath);
    }
  }
  return modules;
}

function relativeImports(source) {
  const imports = new Set();
  const patterns = [
    /\b(?:import|export)\s*(?:[^"']*?\bfrom\s*)?["'](\.[^"']+)["']/g,
    /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.add(match[1].split(/[?#]/, 1)[0]);
    }
  }
  return imports;
}
