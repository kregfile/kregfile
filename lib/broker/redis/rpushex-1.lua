local key = KEYS[1]
local val = ARGV[1]
local exp = ARGV[2]

local rv = redis.call("rpush", key, val)
redis.call("expire", key, exp)
return rv
