local bool = function(val)
    if val == "true" then
        return true
    else
        return false
    end
end

local id = ARGV[1]
local user = bool(ARGV[2])
local ip = bool(ARGV[3])
local room = bool(ARGV[4])

if not user and not room and not ip then
    return
end

local data = redis.call("GET", "message:" .. id)
if not data then
    return
end
data = cjson.decode(data)
if not data then
    return
end
local results = {}

local iterate = function(prefix, space, r)
    local cursor = '0'
    local massoc = "massoc:" .. prefix .. ":" .. space .. ":*"
    if room then
        massoc = "massoc:" .. prefix .. ":" .. space .. ":" .. r .. ":*"
    end
    repeat
        local result = redis.call(
            "SCAN", cursor,
            "MATCH", massoc,
            "COUNT", 25)
        cursor = result[1]
        local keys = result[2]
        for _, key in ipairs(keys) do
            repeat
                local mr, mid = string.match(
                    key, "massoc:.*:(.*):(.*)")
                if room and r ~= mr then
                    do break end
                end
                if not results[mr] then
                    results[mr] = {mid}
                else
                    local rt = results[mr]
                    rt[#rt+1] = mid
                end
            until true
        end
    until cursor == "0"
end

if user then
    iterate("a", data["a"], data["r"])
end

if ip then
    iterate("i", data["i"], data["r"])
end

for cur, rresults in pairs(results) do
    local known = {}
    local unique = {}
    for _, v in ipairs(rresults) do
        if not known[v] then
            known[v] = true
            unique[#unique+1] = v
        end
    end
    if #unique > 0 then
        redis.call(
            "PUBLISH",
            "removeMessages:" .. cur,
            cjson.encode({unique}))
    end
end