--!strict
-- A server Script: required modules reached through services, aliases and strings.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")

local VehicleHandling = require(Shared.VehicleHandling)
local Units = require(game:GetService("ReplicatedStorage").Shared.Units)
local Legacy = require(Shared.Legacy)
local Strings = require("./Strings")
local Promise = require(ReplicatedStorage.Packages.Promise)

local function start(): ()
	local handling = VehicleHandling.new("DEMO_TRUCK")
	local limit = handling:steer(1, Units.toMeters(10))
	print(Strings.format(limit), Legacy.ping())
	Promise.new(function() end)
end

start()
