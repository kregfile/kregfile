local EXPIRE = 20

local key = KEYS[1]
local op = ARGV[1]
local pid = ARGV[2]

local tokey = function (pid)
  return key .. ":" .. pid
end

local pidkey = tokey(pid)
local setskey = key .. ":sets"


local expire = function(force)
  local res = {}
  if force == 0 then
    local ct = redis.call("TTL", key)
    if ct > 0 then
      return res
    end
  end
  redis.call("DEL", key)
  for i,k in ipairs(redis.call("SMEMBERS", setskey)) do
    local pkey = tokey(k)
    if redis.call("TTL", pkey) <= 0 then
      redis.call("SREM", setskey, k)
      redis.call("DEL", pkey)
    else
      local arr = redis.call("ZRANGE", pkey, 0, -1, "WITHSCORES")
      for i = 1, table.getn(arr), 2 do
        local itemkey = arr[i]
        local itemvalue = tonumber(arr[i + 1])
        redis.call("ZINCRBY", key, itemvalue, itemkey)
        local cvalue = res[itemkey]
        if cvalue ~= nil then
          res[itemkey] = cvalue + itemvalue
        else
          res[itemkey] = itemvalue
        end
      end
    end
  end
  redis.call("EXPIRE", key, EXPIRE)
  local rv = {}
  for k, v in pairs(res) do
    if v > 0 then
      table.insert(rv, {k, v})
    end
  end
  redis.call("PUBLISH", key, cjson.encode({{op="exp", v=rv}}))
  return rv
end


local refresh = function()
  redis.call("SADD", setskey, pid)
  redis.call("EXPIRE", pidkey, EXPIRE)
end

local item
local cvalue

if op == "refresh" then
  refresh()
  expire(0)
  return

elseif op == "incr" then
  expire(0)
  item = ARGV[3]
  redis.call("ZINCRBY", pidkey, 1, item)
  refresh()
  cvalue = tonumber(redis.call("ZINCRBY", key, 1, item))
  redis.call("PUBLISH", key, cjson.encode({{op="s", k=item, v=cvalue}}))
  return cvalue

elseif op == "decr" then
  expire(0)
  item = ARGV[3]
  redis.call("ZINCRBY", pidkey, -1, item)
  refresh()
  cvalue = tonumber(redis.call("ZINCRBY", key, -1, item))
  redis.call("PUBLISH", key, cjson.encode({{op="s", k=item, v=cvalue}}))
  return cvalue

elseif op == "del" then
  expire(0)
  item = ARGV[3]
  for i, k in ipairs(redis.call("SMEMBERS", setskey)) do
    redis.call("ZREM", tokey(k), item)
  end
  redis.call("ZREM", key, item)
  redis.call("PUBLISH", key, cjson.encode({{op="del", k=item}}))
  return

elseif op == "clear" then
  for i, k in ipairs(redis.call("SMEMBERS", setskey)) do
    redis.call("DEL", k)
  end
  redis.call("DEL", key)
  redis.call("DEL", setskey)
  redis.call("PUBLISH", key, cjson.encode({{op="c"}}))
  return

elseif op == "getall" then
  local res = expire(1)
  return cjson.encode(res)

else
  return redis.error_reply("Invalid tracking operation")
end
