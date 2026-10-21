/**
 * Luau: its own grammar (tree-sitter-luau, vendored), and the module graph Lua's
 * breadth-tier treatment can't see — `require(...)` by instance path or string, Rojo
 * projects that place files in the DataModel, and calls made through a require-bound
 * name (`Units.toStuds()`), which resolve in the required module and nowhere else.
 *
 * The fixture under test/fixtures/luau-project is a small Rojo place covering the
 * syntax Luau adds over Lua: `--!strict`, `export type`, generics, typed functions and
 * methods, `::` casts, compound assignment, `continue`, if-expressions and string
 * interpolation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractGeneric, loadWasmLanguage, parseWasm, warmGenericGrammars } from "../src/graph/generic.js";
import { resolveEdges, type RojoMount } from "../src/graph/resolve.js";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { checkGraph } from "../src/graph/check.js";
import { contextDirFor } from "../src/context/node-file.js";
import { skeleton } from "../src/ask/ask.js";
import type { EdgeV1, NodeV1 } from "../src/graph/types.js";
import type { RawEdge } from "../src/graph/extract.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "luau-project");

function fixtureCopy(opts: { withProject?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-luau-"));
  cpSync(FIXTURE, dir, { recursive: true });
  if (opts.withProject === false) rmSync(join(dir, "default.project.json"));
  return dir;
}

function luauFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...luauFiles(p, base));
    else if (/\.luau?$/.test(f)) out.push(p.slice(base.length + 1).replace(/\\/g, "/"));
  }
  return out.sort();
}

/** Extract + resolve a set of in-memory files, the way buildGraph does. */
async function graphOf(files: Record<string, string>, rojoMounts: RojoMount[] = []): Promise<{ nodes: NodeV1[]; edges: EdgeV1[]; raw: RawEdge[] }> {
  await warmGenericGrammars(["luau", "lua"]);
  const nodes: NodeV1[] = [];
  const raw: RawEdge[] = [];
  for (const [rel, src] of Object.entries(files)) {
    const r = extractGeneric(rel, src, rel.endsWith(".luau") ? "luau" : "lua");
    nodes.push(...r.nodes);
    raw.push(...r.rawEdges);
  }
  return { nodes, edges: resolveEdges(nodes, raw, { rojoMounts }), raw };
}

const imports = (edges: EdgeV1[], from: string) =>
  edges.filter((e) => e.relation === "imports" && e.source === from).map((e) => e.target).sort();
const calls = (edges: EdgeV1[]) => edges.filter((e) => e.relation === "calls").map((e) => `${e.source} -> ${e.target}`);

test("every fixture file parses with the Luau grammar and no ERROR node", async () => {
  const language = await loadWasmLanguage("luau");
  assert.ok(language, "the vendored tree-sitter-luau.wasm loads");
  const files = luauFiles(FIXTURE).filter((f) => f.endsWith(".luau"));
  assert.ok(files.length >= 8, `fixture has its .luau files (got ${files.length})`);
  for (const f of files) {
    const root = parseWasm(language, readFileSync(join(FIXTURE, f), "utf8"));
    assert.equal(root?.hasError, false, `${f} parses cleanly`);
  }
});

test("Luau symbols: functions, methods, generic and exported types, table fields", async () => {
  await warmGenericGrammars(["luau"]);
  const src = readFileSync(join(FIXTURE, "src/shared/VehicleHandling/init.luau"), "utf8");
  const { nodes } = extractGeneric("src/shared/VehicleHandling/init.luau", src, "luau");
  const defs = nodes.filter((n) => n.kind !== "file").map((n) => `${n.kind}:${n.name}`).sort();
  assert.deepEqual(defs, ["function:new", "method:steer", "type:Handling"]);
  const steer = nodes.find((n) => n.name === "steer")!;
  assert.equal(steer.span, "L26-L37", "a method's span covers its whole body");
  assert.match(steer.signature ?? "", /^function VehicleHandling:steer<T>\(input: T, speed: number\): number$/);

  const types = extractGeneric("src/shared/Types.luau", readFileSync(join(FIXTURE, "src/shared/Types.luau"), "utf8"), "luau");
  assert.deepEqual(
    types.nodes.filter((n) => n.kind !== "file").map((n) => `${n.kind}:${n.name}`).sort(),
    ["type:Callback", "type:Internal", "type:Result", "type:Vector"],
    "generic aliases are named by the alias, never by a type parameter (T, E)",
  );

  // Two functions in one table constructor are two definitions, each with its own span.
  const table = extractGeneric("t.luau", `local M = {\n  a = function() return 1 end,\n  b = function() return 2 end,\n}\n`, "luau");
  assert.deepEqual(table.nodes.filter((n) => n.kind !== "file").map((n) => `${n.name}@${n.span}`), ["a@L2-L2", "b@L3-L3"]);
});

test("require specifiers: instance paths, services, aliases, strings; computed ones skipped", async () => {
  await warmGenericGrammars(["luau"]);
  const src = [
    `local RS = game:GetService("ReplicatedStorage")`,
    `local Shared = RS:WaitForChild("Shared")`,
    `local A = require(script.Parent.A)`,
    `local B = require(Shared.Sub["B"])`,
    `local C = require(game.ReplicatedStorage.Shared:FindFirstChild("C"))`,
    `local D = require("./D")`,
    `local E = require(param.E)`,
    `local F = require((script.Parent.F :: any))`,
    `local G = require(workspace.Lib.G)`,
    `local x = require(12345)`,
    `local y = require(getModule())`,
    `local z = require(\`./{name}\`)`,
    `require(script.Parent.A)`,
    `require(script.Parent.H).run()`,
  ].join("\n");
  const { rawEdges } = extractGeneric("src/m.luau", src, "luau");
  const specs = rawEdges.filter((e) => e.relation === "imports").map((e) => e.specifier);
  assert.deepEqual(specs, [
    "script.Parent.A",
    "game.ReplicatedStorage.Shared.Sub.B",
    "game.ReplicatedStorage.Shared.C",
    "./D",
    "param.E",
    "script.Parent.F",
    "game.Workspace.Lib.G",
    "script.Parent.H",
  ], "one import per distinct module; an asset id, a call or an interpolated string is not guessed");
  const run = rawEdges.find((e) => e.relation === "calls" && e.name === "run");
  assert.equal(run?.specifier, "script.Parent.H", "a call straight off a require carries its module");
});

test("a call through a require-bound name carries the module; a rebound name does not", async () => {
  await warmGenericGrammars(["luau"]);
  const src = [
    `local Units = require(script.Parent.Units)`,
    `local function a() return Units.toStuds(1) end`,
    `local function b() return Units:describe() end`,
    `Units = {}`,
    `local function c() return Units.toStuds(2) end`,
    `local toString = 1`,
  ].join("\n");
  const { rawEdges } = extractGeneric("src/m.luau", src, "luau");
  const qualified = rawEdges
    .filter((e) => e.relation === "calls" && e.name !== "require")
    .map((e) => `${e.source.split("#")[1]}:${e.name}:${e.specifier ?? "-"}`);
  assert.deepEqual(qualified, ["a:toStuds:script.Parent.Units", "b:describe:script.Parent.Units", "c:toStuds:-"]);
});

test("build: Rojo-placed requires resolve to files, and calls land in the required module", async () => {
  const dir = fixtureCopy();
  try {
    const r = await buildGraph(dir, { reuse: false });
    assert.deepEqual(r.errors, []);
    assert.ok(r.languages.includes("luau"), `luau is a build language (got ${r.languages.join(", ")})`);
    const g = readGraph(wiringPath(contextDirFor(dir)))!;

    assert.deepEqual(imports(g.edges, "src/server/Boot.server.luau"), [
      "game.ReplicatedStorage.Packages.Promise", // not in the repo: kept as written
      "src/server/Strings.luau", // require("./Strings")
      "src/shared/Legacy.lua", // a .lua ModuleScript
      "src/shared/Units.luau", // game:GetService("ReplicatedStorage").Shared.Units
      "src/shared/VehicleHandling/init.luau", // Shared alias → ReplicatedStorage.Shared
    ]);
    // init.luau IS the folder: script.Parent is src/shared, script.Profiles its child.
    assert.deepEqual(imports(g.edges, "src/shared/VehicleHandling/init.luau"), [
      "src/shared/Types.luau",
      "src/shared/Units.luau",
      "src/shared/VehicleHandling/Profiles.luau",
    ]);
    assert.deepEqual(imports(g.edges, "src/client/Hud.client.luau"), ["src/shared/Units.luau"], "a bracketed child is a child");

    const c = calls(g.edges);
    for (const want of [
      "src/server/Boot.server.luau#start -> src/shared/VehicleHandling/init.luau#new",
      "src/server/Boot.server.luau#start -> src/shared/Units.luau#toMeters",
      "src/server/Boot.server.luau#start -> src/server/Strings.luau#format",
      "src/server/Boot.server.luau#start -> src/shared/Legacy.lua#ping",
      "src/shared/VehicleHandling/init.luau#new -> src/shared/VehicleHandling/Profiles.luau#get",
      "src/shared/VehicleHandling/init.luau#steer -> src/shared/Units.luau#toStuds",
      "src/client/Hud.client.luau#refresh -> src/shared/Units.luau#toStuds",
      "src/shared/VehicleHandling/Profiles.luau#get -> src/shared/VehicleHandling/Profiles.luau#default",
      "src/server/Boot.server.luau#start -> src/shared/VehicleHandling/init.luau#steer", // handling:steer(), by name
    ]) assert.ok(c.includes(want), `call ${want} (got:\n  ${c.join("\n  ")})`);
    assert.ok(!c.some((e) => e.endsWith("Physics/Units.luau#toStuds")), "the same-named toStuds of another module is never the target");

    const certain = g.edges.find((e) => e.relation === "calls" && e.target === "src/shared/Units.luau#toStuds" && e.source.endsWith("#steer"));
    assert.equal(certain?.confidence, "extracted", "a call through its module is certain, not inferred");

    const chk = await checkGraph(dir);
    assert.equal(chk.ok, true, `check agrees with build (added=${chk.added}, removed=${chk.removed})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build without a Rojo project: unique path suffixes resolve, ambiguous ones stay strings", async () => {
  const dir = fixtureCopy({ withProject: false });
  try {
    await buildGraph(dir, { reuse: false });
    const g = readGraph(wiringPath(contextDirFor(dir)))!;
    const boot = imports(g.edges, "src/server/Boot.server.luau");
    assert.ok(boot.includes("src/shared/VehicleHandling/init.luau"), "VehicleHandling is one module wherever it is");
    // Units.luau and Physics/Units.luau both answer `…Shared.Units`; no project says which.
    assert.ok(boot.includes("game.ReplicatedStorage.Shared.Units"), `ambiguous Units stays a string (got ${boot.join(", ")})`);
    assert.ok(!boot.includes("src/shared/Physics/Units.luau"));
    // The relative requires don't need a project at all.
    assert.ok(imports(g.edges, "src/shared/VehicleHandling/init.luau").includes("src/shared/Units.luau"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Rojo places: a file's own place decides, and a file in two places links both", async () => {
  // Like a repo with a general place and per-map places: `World` is World/ in one
  // place and WorldV2/ in another, and Bootstrap runs in both map places.
  const files: Record<string, string> = {
    "src/shared/World/Route.luau": `local M = {}\nfunction M.frame() end\nreturn M\n`,
    "src/shared/WorldV2/Route.luau": `local M = {}\nfunction M.frame() end\nreturn M\n`,
    "src/shared/WorldV3/Route.luau": `local M = {}\nfunction M.frame() end\nreturn M\n`,
    "src/server/MapV2/Runtime.luau": `local Route = require(game.ReplicatedStorage.Shared.World.Route)\nlocal function go() Route.frame() end\n`,
    "src/server/Bootstrap.server.luau": `local Route = require(game.ReplicatedStorage.Shared.World.Route)\nRoute.frame()\n`,
    "tests/Probe.luau": `local Route = require(game.ReplicatedStorage.Shared.World.Route)\n`,
  };
  const general: RojoMount[] = [
    { project: "general.project.json", instance: ["ReplicatedStorage", "Shared"], path: "src/shared" },
    { project: "general.project.json", instance: ["ServerScriptService", "Server"], path: "src/server" },
  ];
  const v2: RojoMount[] = [
    { project: "v2.project.json", instance: ["ReplicatedStorage", "Shared", "World"], path: "src/shared/WorldV2" },
    { project: "v2.project.json", instance: ["ServerScriptService", "Map"], path: "src/server/MapV2" },
    { project: "v2.project.json", instance: ["ServerScriptService", "Boot"], path: "src/server/Bootstrap.server.luau" },
  ];
  const v3: RojoMount[] = [
    { project: "v3.project.json", instance: ["ReplicatedStorage", "Shared", "World"], path: "src/shared/WorldV3" },
    { project: "v3.project.json", instance: ["ServerScriptService", "Boot"], path: "src/server/Bootstrap.server.luau" },
  ];
  const { edges } = await graphOf(files, [...general, ...v2, ...v3]);
  assert.deepEqual(imports(edges, "src/server/MapV2/Runtime.luau"), ["src/shared/WorldV2/Route.luau"], "MapV2 runs in the v2 place, which mounts it");
  assert.deepEqual(
    imports(edges, "src/server/Bootstrap.server.luau"),
    ["src/shared/WorldV2/Route.luau", "src/shared/WorldV3/Route.luau"],
    "mounted by both map places, each with its own World",
  );
  assert.deepEqual(imports(edges, "tests/Probe.luau"), ["game.ReplicatedStorage.Shared.World.Route"], "no place runs it, and the places disagree: no guess");
  assert.ok(calls(edges).includes("src/server/MapV2/Runtime.luau#go -> src/shared/WorldV2/Route.luau#frame"));
});

test("script-relative requires walk instance space when a project remaps a file", async () => {
  const files: Record<string, string> = {
    "src/server/Map/Builder.luau": `local M = {}\nfunction M.build() end\nreturn M\n`,
    "src/server/MapV2/Builder.luau": `local M = {}\nfunction M.build() end\nreturn M\n`,
    "src/server/Boot.server.luau": `require(script.Parent.Map.Builder).build()\n`,
    "src/server/Plain.server.luau": `require(script.Parent.Map.Builder).build()\n`,
  };
  const mounts: RojoMount[] = [
    { project: "v2.project.json", instance: ["ServerScriptService", "Map"], path: "src/server/MapV2" },
    { project: "v2.project.json", instance: ["ServerScriptService", "Boot"], path: "src/server/Boot.server.luau" },
  ];
  const { edges } = await graphOf(files, mounts);
  assert.deepEqual(imports(edges, "src/server/Boot.server.luau"), ["src/server/MapV2/Builder.luau"], "in its place, Map is MapV2/");
  assert.deepEqual(imports(edges, "src/server/Plain.server.luau"), ["src/server/Map/Builder.luau"], "no place: the folder next to it");
  assert.ok(calls(edges).includes("src/server/Boot.server.luau -> src/server/MapV2/Builder.luau#build"));
});

test("string requires follow Luau's rules: ./ from the module's parent, @self into it", async () => {
  const files: Record<string, string> = {
    "lib/Strings.luau": `local M = {}\nfunction M.fmt() end\nreturn M\n`,
    "lib/Pkg/init.luau": `local Child = require("@self/Child")\nlocal Sibling = require("./Strings")\nlocal Up = require("../top")\nreturn {}\n`,
    "lib/Pkg/Child.luau": `return {}\n`,
    "top.luau": `return {}\n`,
    "lib/Use.luau": `local S = require("./Strings.luau")\nlocal P = require("./Pkg")\nlocal Q = require("@pkg/thing")\nS.fmt()\n`,
  };
  const { edges } = await graphOf(files);
  assert.deepEqual(imports(edges, "lib/Pkg/init.luau"), ["lib/Pkg/Child.luau", "lib/Strings.luau", "top.luau"]);
  assert.deepEqual(imports(edges, "lib/Use.luau"), ["@pkg/thing", "lib/Pkg/init.luau", "lib/Strings.luau"]);
  assert.ok(calls(edges).includes("lib/Use.luau -> lib/Strings.luau#fmt"));
});

test("a Script is never a require target, and a module that lacks the name drops the call", async () => {
  const files: Record<string, string> = {
    "src/Boot.server.luau": `local M = {}\nfunction M.start() end\nreturn M\n`,
    "src/Other.luau": `local M = {}\nfunction M.start() end\nreturn M\n`,
    "src/Empty.luau": `return {}\n`,
    "src/Use.luau": `local B = require(script.Parent.Boot)\nlocal E = require(script.Parent.Empty)\nlocal function go() B.start() E.start() end\n`,
  };
  const { edges } = await graphOf(files);
  assert.deepEqual(imports(edges, "src/Use.luau"), ["script.Parent.Boot", "src/Empty.luau"]);
  // E is src/Empty.luau, which has no `start`: dropped, not borrowed from src/Other.luau.
  // B is unresolved (a Script), so its call falls back to the breadth tier's name rule,
  // where `start` is defined twice — ambiguous, dropped too.
  assert.deepEqual(calls(edges).filter((e) => e.startsWith("src/Use.luau")), []);
});

test("Lua and Luau share a family: a bare-name call crosses between them", async () => {
  const { edges } = await graphOf({
    "a.luau": `local function go() return legacyHelper() end\n`,
    "b.lua": `function legacyHelper() return 1 end\n`,
  });
  assert.ok(calls(edges).includes("a.luau#go -> b.lua#legacyHelper"));
});

test("skeleton lists a Luau file's API", async () => {
  const dir = fixtureCopy();
  try {
    await buildGraph(dir, { reuse: false });
    const r = skeleton(dir, "src/shared/VehicleHandling/init.luau");
    const names = r.entries.map((e) => `${e.kind}:${e.name}`).sort();
    assert.deepEqual(names, ["function:new", "method:steer", "type:Handling"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a .lua-only repo builds exactly as before: no imports, bare-name calls", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-lua-only-"));
  try {
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "a.lua"), `local b = require("lib.b")\nlocal function run() return b.helper() end\n`);
    writeFileSync(join(dir, "lib", "b.lua"), `local M = {}\nfunction M.helper() return 1 end\nreturn M\n`);
    await buildGraph(dir, { reuse: false });
    const g = readGraph(wiringPath(contextDirFor(dir)))!;
    assert.equal(g.edges.filter((e) => e.relation === "imports").length, 0, "Lua requires are not read");
    assert.ok(calls(g.edges).includes("lib/a.lua#run -> lib/b.lua#helper"), "bare-name call resolves as before");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
