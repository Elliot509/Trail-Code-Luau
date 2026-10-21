--!strict
-- init.luau: the folder IS the module, so script.Parent is src/shared and
-- script.Profiles is the child module beside this file.

local Types = require(script.Parent.Types)
local Units = require(script.Parent.Units)
local Profiles = require(script.Profiles)

export type Handling = {
	grip: number,
	profile: Profiles.Profile,
	heading: Types.Vector,
}

local VehicleHandling = {}
VehicleHandling.__index = VehicleHandling

function VehicleHandling.new(profileName: string): Handling
	local profile = Profiles.get(profileName)
	local grip = (profile.grip :: number) * 1.0
	grip += 0.5
	local heading: Types.Vector = { x = 0, y = 1 }
	return setmetatable({ grip = grip, profile = profile, heading = heading }, VehicleHandling) :: any
end

function VehicleHandling:steer<T>(input: T, speed: number): number
	local limit = Units.toStuds(speed)
	for step = 1, 3 do
		if step == 2 then
			continue
		end
		limit -= step
	end
	local label = if limit > 0 then `steer {limit} at {speed}` else "idle"
	print(label)
	return limit
end

return VehicleHandling
