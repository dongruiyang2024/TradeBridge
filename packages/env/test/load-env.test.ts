import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWorkspaceEnv } from "../src/index.js";

test("loads .env.local before .env from the workspace root", async () => {
  const root = await createWorkspaceFixture();
  try {
    await writeFile(
      path.join(root, ".env"),
      [
        "WANGWANG_SERVER_PORT=5032",
        "SHARED_VALUE=from-env",
        'QUOTED_VALUE="hello world"',
        ""
      ].join("\n")
    );
    await writeFile(path.join(root, ".env.local"), ["WANGWANG_SERVER_PORT=7777", "LOCAL_ONLY=local", ""].join("\n"));

    const env: Record<string, string | undefined> = {};
    const loaded = loadWorkspaceEnv({
      cwd: path.join(root, "apps", "server"),
      env
    });

    assert.deepEqual(
      loaded.map((item) => path.basename(item)),
      [".env.local", ".env"]
    );
    assert.equal(env.WANGWANG_SERVER_PORT, "7777");
    assert.equal(env.LOCAL_ONLY, "local");
    assert.equal(env.SHARED_VALUE, "from-env");
    assert.equal(env.QUOTED_VALUE, "hello world");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not override variables that already exist", async () => {
  const root = await createWorkspaceFixture();
  try {
    await writeFile(path.join(root, ".env.local"), ["TOKEN=from-file", "ONLY_FILE=loaded", ""].join("\n"));

    const env: Record<string, string | undefined> = {
      TOKEN: "from-shell"
    };
    loadWorkspaceEnv({ cwd: path.join(root, "apps", "server"), env });

    assert.equal(env.TOKEN, "from-shell");
    assert.equal(env.ONLY_FILE, "loaded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns an empty list when no dotenv files exist", async () => {
  const root = await createWorkspaceFixture();
  try {
    const env: Record<string, string | undefined> = {};
    const loaded = loadWorkspaceEnv({ cwd: path.join(root, "apps", "server"), env });

    assert.deepEqual(loaded, []);
    assert.deepEqual(env, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createWorkspaceFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "wangwang-env-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ private: true, workspaces: ["apps/*", "packages/*"] }));
  await mkdir(path.join(root, "apps", "server"), { recursive: true });
  return root;
}
