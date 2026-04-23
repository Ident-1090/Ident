import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const script = join(process.cwd(), "scripts", "resolve-build-metadata.sh");

function parseOutput(text) {
  const out = {};
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    const idx = line.indexOf("=");
    assert.notEqual(idx, -1, `missing '=' in ${line}`);
    out[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return out;
}

function initRepo() {
  const dir = mkdtempSync(join(tmpdir(), "ident-metadata-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: dir,
  });
  writeFileSync(join(dir, "README.md"), "test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "init"], {
    cwd: dir,
  });
  return dir;
}

function runResolve(env, cwd) {
  return parseOutput(
    execFileSync("sh", [script], {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
    }),
  );
}

test("main builds use the commit short sha for runtime versioning", () => {
  const repo = initRepo();
  try {
    writeFileSync(join(repo, "main.txt"), "next\n");
    execFileSync("git", ["add", "main.txt"], { cwd: repo });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "next"], {
      cwd: repo,
    });

    const result = runResolve(
      {
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
        GITHUB_REF_NAME: "main",
        GITHUB_REF_TYPE: "branch",
      },
      repo,
    );

    assert.equal(result.is_release, "false");
    assert.equal(result.publish_image, "true");
    assert.match(result.commit, /^[0-9a-f]{40}$/);
    assert.match(result.commit_short, /^[0-9a-f]{12}$/);
    assert.equal(result.version, result.commit_short);
    assert.equal(result.package_version, `0.0.0~git.${result.commit_short}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("release dispatch preserves the requested version", () => {
  const repo = initRepo();
  try {
    const result = runResolve(
      {
        REQUESTED_VERSION: "v2.0.0",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF: "refs/heads/main",
        GITHUB_REF_NAME: "main",
        GITHUB_REF_TYPE: "branch",
      },
      repo,
    );

    assert.equal(result.version, "v2.0.0");
    assert.equal(result.package_version, "2.0.0");
    assert.equal(result.is_release, "true");
    assert.equal(result.publish_image, "true");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
