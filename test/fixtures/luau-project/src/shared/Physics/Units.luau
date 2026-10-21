--!strict
local Units = {}

function Units.toStuds(newtons: number): number
	return newtons * 0.5
end

return Units
