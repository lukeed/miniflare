import { existsSync } from "fs";
import path from "path";
import { promisify } from "util";
import test from "ava";
import rimraf from "rimraf";
import { sync as which } from "which";
import { Miniflare } from "../../src";
import { stripUndefinedOptions } from "../../src/options";
import { getWranglerOptions } from "../../src/options/wrangler";
import { useTmp } from "../helpers";

const fixturesPath = path.resolve(__dirname, "..", "fixtures");
const webpackPath = path.join(fixturesPath, "wrangler", "webpack");
const rustPath = path.join(fixturesPath, "wrangler", "rust");

test("getWranglerOptions: selects environment's configuration", (t) => {
  const options = getWranglerOptions(
    `
    [miniflare]
    kv_persist = true
    [env.production.miniflare]
    kv_persist = "prod"
    `,
    process.cwd(),
    "production"
  );
  t.is(options.kvPersist, "prod");
});

// These tests require wrangler and rust to be installed, so skip them if not installed
const wranglerInstalled = which("wrangler", { nothrow: true });
const rustInstalled = which("rustc", { nothrow: true });

const webpackTest = wranglerInstalled ? test : test.skip;
webpackTest('getWranglerOptions: builds type "webpack" projects', async (t) => {
  await promisify(rimraf)(path.join(webpackPath, "worker"));
  const mf = new Miniflare({
    wranglerConfigPath: path.join(webpackPath, "wrangler.toml"),
  });
  await mf.getOptions(); // Resolves once worker has been built
  t.true(existsSync(path.join(webpackPath, "worker", "script.js")));

  const res = await mf.dispatchFetch("http://localhost:8787/");
  t.is(await res.text(), "webpack:http://localhost:8787/");
});

const rustTest = wranglerInstalled && rustInstalled ? test : test.skip;
rustTest('getWranglerOptions: builds type "rust" projects', async (t) => {
  await promisify(rimraf)(path.join(rustPath, "worker", "generated"));
  const mf = new Miniflare({
    wranglerConfigPath: path.join(rustPath, "wrangler.toml"),
  });
  await mf.getOptions(); // Resolves once worker has been built
  t.true(existsSync(path.join(rustPath, "worker", "generated", "script.js")));
  t.true(existsSync(path.join(rustPath, "worker", "generated", "script.wasm")));

  const res = await mf.dispatchFetch("http://localhost:8787/");
  t.is(await res.text(), "rust:http://localhost:8787/");
});

test("getWranglerOptions: maps all options", (t) => {
  const cwd = process.cwd();
  const options = getWranglerOptions(
    `
    kv_namespaces = [
      { binding = "TEST_NAMESPACE", id = "", preview_id = "" }
    ]
    
    [durable_objects]
    bindings = [
      { name = "OBJECT", class_name = "Object", script_name = "./object.mjs" }
    ]
    
    [vars]
    KEY = "value"
    
    [site]
    bucket = "./public"
    include = ["upload_dir"]
    exclude = ["ignore_dir"]
    
    [triggers]
    crons = ["30 * * * *"]
    
    [build]
    command = "npm run build"
    cwd = "build_cwd"
    watch_dir = "build_watch_dir"
    [build.upload]
    format = "modules"
    dir = "worker"
    main = "./index.mjs"
    [[build.upload.rules]]
    type = "ESModule"
    globs = ["**/*.js"]
    
    [miniflare]
    upstream = "https://miniflare.dev"
    kv_persist = true
    cache_persist = "./cache"
    disable_cache = true
    durable_objects_persist = true
    env_path = ".env.test"
    host = "127.0.0.1"
    port = 1337
    https = true
    wasm_bindings = [
      { name = "MODULE", path="module.wasm" }
    ]
    disable_updater = true
    `,
    cwd
  );
  t.deepEqual(options, {
    kvNamespaces: ["TEST_NAMESPACE"],
    durableObjects: {
      OBJECT: { className: "Object", scriptPath: "./object.mjs" },
    },
    bindings: { KEY: "value" },
    sitePath: path.join(cwd, "public"),
    siteInclude: ["upload_dir"],
    siteExclude: ["ignore_dir"],
    crons: ["30 * * * *"],
    buildCommand: "npm run build",
    buildBasePath: "build_cwd",
    buildWatchPath: "build_watch_dir",
    modules: true,
    scriptPath: path.join(cwd, "worker", "index.mjs"),
    modulesRules: [
      { type: "ESModule", include: ["**/*.js"], fallthrough: undefined },
    ],
    upstream: "https://miniflare.dev",
    kvPersist: true,
    cachePersist: "./cache",
    disableCache: true,
    durableObjectsPersist: true,
    envPath: ".env.test",
    host: "127.0.0.1",
    port: 1337,
    https: true,
    wasmBindings: { MODULE: "module.wasm" },
    disableUpdater: true,
  });
});
test("getWranglerOptions: returns empty default options with empty file", (t) => {
  const options = getWranglerOptions("", process.cwd());
  t.deepEqual(stripUndefinedOptions(options), {});
});

test("getWranglerOptions: resolves script path relative to input, default and custom upload directories", async (t) => {
  const inputDir = await useTmp(t);

  let options = getWranglerOptions(
    `
    [build.upload]
    main = "./index.mjs"
    `,
    inputDir
  );
  t.is(options.scriptPath, path.join(inputDir, "dist", "index.mjs"));

  options = getWranglerOptions(
    `
    [build.upload]
    main = "./index.mjs"
    dir = "worker"
    `,
    inputDir
  );
  t.is(options.scriptPath, path.join(inputDir, "worker", "index.mjs"));
});
test("getWranglerOptions: enables modules with format set to modules", (t) => {
  const cwd = process.cwd();

  let options = getWranglerOptions(
    `
    [build.upload]
    format = "service-worker"
    `,
    cwd
  );
  t.false(options.modules);

  options = getWranglerOptions(
    `
    [build.upload]
    format = "modules"
    `,
    cwd
  );
  t.true(options.modules);
});
test("getWranglerOptions: defaults build watch path to src if command specified", (t) => {
  const options = getWranglerOptions(
    `
    [build]
    command = "npm run build"
    `,
    process.cwd()
  );
  t.is(options.buildWatchPath, "src");
});

test("getWranglerOptions: maps https options correctly", (t) => {
  // Check boolean value mapped correctly
  let options = getWranglerOptions(
    `
    [miniflare]
    https = false
    `,
    process.cwd()
  );
  t.is(options.https, false);
  options = getWranglerOptions(
    `
    [miniflare]
    https = true
    `,
    process.cwd()
  );
  t.is(options.https, true);

  // Check object value mapped correctly
  options = getWranglerOptions(
    `
    [miniflare.https]
    key = "test_key"
    cert = "test_cert"
    ca = "test_ca"
    pfx = "test_pfx"
    passphrase = "test_passphrase"
    `,
    process.cwd()
  );
  t.deepEqual(options.https, {
    keyPath: "test_key",
    certPath: "test_cert",
    caPath: "test_ca",
    pfxPath: "test_pfx",
    passphrase: "test_passphrase",
  });
});
