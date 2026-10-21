--!strict
-- Length conversions. Physics/Units.luau defines a same-named `toStuds`, so only
-- the require binding tells a caller's `Units.toStuds` which one it means.

local Units = {}

local STUDS_PER_METER = 1 / 0.28

function Units.toStuds(meters: number): number
	return meters * STUDS_PER_METER
end

function Units.toMeters(studs: number): number
	return studs / STUDS_PER_METER
end

return Units
