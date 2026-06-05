import assert from "node:assert/strict";
import { test } from "node:test";
import type { Plugin } from "vite";
import { createOneTalkPageScriptIifePlugin, wrapClassicScriptInIife } from "../vite.config";

test("wrapClassicScriptInIife scopes top-level page declarations", () => {
  const wrapped = wrapClassicScriptInIife('const $ = "profile-url";\nwindow.__flag = true;');

  assert.match(wrapped, /^\(function \(\) \{\n/);
  assert.match(wrapped, /\n\}\)\(\);\n$/);
  assert.equal(wrapped.includes('const $ = "profile-url";'), true);
  assert.equal(wrapped.startsWith("const $"), false);
});

test("OneTalk page script IIFE plugin wraps only the injected page script chunk", () => {
  const plugin = createOneTalkPageScriptIifePlugin() as Plugin;
  const bundle = {
    "channels/alibaba-im/onetalk-page-script.js": {
      type: "chunk",
      fileName: "channels/alibaba-im/onetalk-page-script.js",
      code: "const $ = 1;",
      imports: [],
      dynamicImports: []
    },
    "background/index.js": {
      type: "chunk",
      fileName: "background/index.js",
      code: "const $ = 2;",
      imports: [],
      dynamicImports: []
    }
  };

  const hook = plugin.generateBundle;
  const generateBundle = typeof hook === "function" ? hook : hook?.handler;
  if (typeof generateBundle !== "function") throw new Error("missing_generate_bundle_hook");
  const invokeGenerateBundle = generateBundle as Function;
  invokeGenerateBundle.call({ error(message: string): never { throw new Error(message); } }, {}, bundle, false);

  assert.match(bundle["channels/alibaba-im/onetalk-page-script.js"].code, /^\(function \(\) \{/);
  assert.equal(bundle["background/index.js"].code, "const $ = 2;");
});
