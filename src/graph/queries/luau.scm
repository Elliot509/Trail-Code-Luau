; Luau tags matched to tree-sitter-luau 1.2.0. Keep this separate from Lua:
; Luau types and syntax extensions must never depend on Lua error recovery.

; `type T = …` / `export type T<A> = …`. The `.` anchor takes the alias's own
; name: a generic_type's later identifiers are its parameters (`A`), not names.
(type_definition
  name: [
    (identifier) @name
    (generic_type
      .
      (identifier) @name)
  ]) @definition.type

(function_declaration
  name: [
    (identifier) @name
    (dot_index_expression
      field: (identifier) @name)
  ]) @definition.function

(function_declaration
  name: (method_index_expression
    method: (identifier) @name)) @definition.method

(assignment_statement
  (variable_list
    .
    name: [
      (identifier) @name
      (dot_index_expression
        field: (identifier) @name)
    ])
  (expression_list
    .
    value: (function_definition))) @definition.function

; The definition is the field, not the whole table: one span per function, so
; `{ a = function() end, b = function() end }` yields both, each with its own body.
(table_constructor
  (field
    name: (identifier) @name
    value: (function_definition)) @definition.function)

(function_call
  name: [
    (identifier) @name
    (dot_index_expression
      field: (identifier) @name)
    (method_index_expression
      method: (identifier) @name)
  ]) @reference.call
