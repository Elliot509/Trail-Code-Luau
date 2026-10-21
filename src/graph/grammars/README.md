# Vendored breadth grammars

`tree-sitter-luau.wasm` is the precompiled grammar from
[`tree-sitter-luau` 1.2.0](https://github.com/tree-sitter-grammars/tree-sitter-luau),
distributed under the adjacent MIT license.

SHA-256: `f1647052518f2bdfae8e8c0b033ffdeca1193d69d11c78ba20f84c8374fd0fe3`

The artifact is vendored because `tree-sitter-wasm` does not include Luau and
the grammar's npm package installs native dependencies that Graft does not use.

## Provenance

- Source: the `tree-sitter-luau.wasm` asset of the upstream
  [v1.2.0 release](https://github.com/tree-sitter-grammars/tree-sitter-luau/releases/tag/v1.2.0)
  (2024-12-22), byte-identical to the file here (same SHA-256, 94,204 bytes).
- Language ABI 14, which `web-tree-sitter` 0.26 loads (it accepts 13–15).
- Upstream had no commits after v1.2.0 when this was checked (2026-10-21), so this
  is the newest grammar there is.

## Known grammar gaps (1.2.0)

These parse with error recovery: the surrounding definitions are usually still
found, but an `ERROR` node can swallow the statement after it.

- generic defaults (`type T<A = number> = …`) and generic type packs (`<T...>`)
- `read` / `write` property modifiers in table types
- `typeof(…)` in a type annotation (it is accepted on the right of `type X =`)
- function attributes (`@native`, `@checked`)
- type functions (`type function F(...) … end`)

To refresh the grammar: replace the `.wasm`, update the version, the SHA-256 and
this list, and run `npm test` (test/luau.test.ts parses every Luau fixture and
fails on an `ERROR` node).
