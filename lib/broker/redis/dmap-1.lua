local rkey = KEYS[1]
local pid = ARGV[1]
local op = ARGV[2]
local key
local val

if op == "set" then
  key = ARGV[3]
  val = ARGV[4]
  redis.call("HSET", rkey, key, val)
  redis.call("PUBLISH", rkey, cjson.encode({{pid=pid, t="s", k=cjson.decode(key), v=cjson.decode(val)}}))
elseif op == "delete" then
  key = ARGV[3]
  redis.call("HDEL", rkey, key)
  redis.call("PUBLISH", rkey, cjson.encode({{pid=pid, t="d", k=cjson.decode(key)}}))
elseif op == "clear" then
  redis.call("DEL", key)
  redis.call("PUBLISH", rkey, cjson.encode({{pid=pid, t="c"}}))
else
  return redis.error_reply("Invalid dmap operation")
end
