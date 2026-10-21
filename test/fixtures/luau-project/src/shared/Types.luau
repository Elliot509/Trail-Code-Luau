--!strict
-- Shared type aliases: exported, local, generic and intersection types.

export type Vector = { x: number, y: number }
export type Result<T, E> = { ok: true, value: T } | { ok: false, error: E }
export type Callback<T> = (value: T) -> ()
type Internal = { count: number } & { label: string }

return {}
