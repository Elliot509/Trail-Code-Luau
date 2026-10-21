--!strict
export type Profile = { name: string, grip: number }

local Profiles = {}

local registry: { [string]: Profile } = {
	DEMO_TRUCK = { name = "DEMO_TRUCK", grip = 0.9 },
}

function Profiles.get(name: string): Profile
	return registry[name] or Profiles.default()
end

function Profiles.default(): Profile
	return { name = "default", grip = 1 }
end

return Profiles
