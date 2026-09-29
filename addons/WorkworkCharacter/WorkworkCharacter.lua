-- The WoW addon sandbox writes SavedVariables on logout or /reload. No network or game memory access.
local function encode(value)
  local ok, text = pcall(function() return tostring(value or "") end)
  if not ok then return "" end
  return text:gsub("([^A-Za-z0-9_.~-])", function(character)
    return string.format("%%%02X", string.byte(character))
  end)
end

local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, first, second, third, fourth = pcall(fn, ...)
  if ok then return first, second, third, fourth end
  return nil
end

local function record(parts, kind, ...)
  local fields = { kind }
  for index = 1, select("#", ...) do fields[index + 1] = encode(select(index, ...)) end
  parts[#parts + 1] = table.concat(fields, "|")
end

local attributes = { "strength", "agility", "stamina", "intellect", "spirit" }
local function capture()
  if not UnitExists("player") then return end
  local parts = { "WW1" }
  local name, realm = UnitFullName("player")
  realm = realm or GetRealmName()
  local _, class = UnitClass("player")
  local _, race = UnitRace("player")
  local specName = ""
  local spec = call(GetSpecialization)
  if spec then _, specName = call(GetSpecializationInfo, spec) end
  record(parts, "character", name, realm, UnitLevel("player"), class, race, specName,
    GetRealZoneText(), GetMoney(), call(GetServerTime) or time(), (select(1, GetBuildInfo())))

  for index, label in ipairs(attributes) do
    local base, effective = call(UnitStat, "player", index)
    if effective then record(parts, "stat", label, effective, base) end
  end
  local armorBase, armorEffective = call(UnitArmor, "player")
  if armorEffective then record(parts, "stat", "armor", armorEffective, armorBase) end
  record(parts, "stat", "health", (call(UnitHealthMax, "player")))
  record(parts, "stat", "mana", (call(UnitPowerMax, "player", 0)))
  record(parts, "stat", "attackPower", (call(UnitAttackPower, "player")))

  for slot = 1, 19 do
    local link = call(GetInventoryItemLink, "player", slot)
    if type(link) == "string" then
      local itemId = call(GetInventoryItemID, "player", slot) or link:match("item:(%d+)")
      local itemName = link:match("%[([^%]]+)%]") or ""
      local stats = {}
      local itemStats = C_Item and call(C_Item.GetItemStats, link)
      if type(itemStats) == "table" then
        for key, value in pairs(itemStats) do
          if type(key) == "string" and type(value) == "number" then
            stats[#stats + 1] = encode(key) .. "=" .. encode(value)
          end
        end
        table.sort(stats)
      end
      record(parts, "equipment", slot, itemId, itemName, link, table.concat(stats, ","))
    end
  end
  WorkworkCharacterSnapshot = table.concat(parts, ";")
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_EQUIPMENT_CHANGED", "PLAYER_LEVEL_UP",
  "ZONE_CHANGED_NEW_AREA", "PLAYER_MONEY", "PLAYER_LOGOUT" }) do
  frame:RegisterEvent(event)
end
frame:SetScript("OnEvent", function()
  pcall(capture)
end)

SLASH_WORKWORKCHARACTER1 = "/workwork"
SlashCmdList.WORKWORKCHARACTER = function()
  capture()
  print("Workwork Character: snapshot prepared. Type /reload or log out to save it for WorkWork.")
end
