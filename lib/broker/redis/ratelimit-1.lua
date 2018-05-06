local key = KEYS[1]
local exp = ARGV[1]

local value = tonumber(redis.call("incr", key))
local ttl
if value == 1 then
  redis.call("pexpire", key, exp)
  ttl = exp
else
  ttl = redis.call("pttl", key)
end
return {value, ttl}
