--!strict
local Players = game:GetService("Players")
local Shared = game:GetService("ReplicatedStorage"):WaitForChild("Shared")

local Units = require(Shared["Units"])

local count = 0
local function refresh(meters: number)
	count += 1
	local studs = Units.toStuds(meters)
	print(`hud #{count}: {studs}`, Players.LocalPlayer)
end

refresh(5)
