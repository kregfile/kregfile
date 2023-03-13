local key = KEYS[1]
local pid = ARGV[1]
local op = ARGV[2]
local item

if op == "add" then
  item = ARGV[3]
  redis.call("SADD", key, item)
  redis.call("PUBLISH", key, cjson.encode({{pid=pid, t="a", v=cjson.decode(item)}}))
elseif op == "delete" then
  item = ARGV[3]
  redis.call("SREM", key, item)
  redis.call("PUBLISH", key, cjson.encode({{pid=pid, t="d", v=cjson.decode(item)}}))
elseif op == "clear" then
  redis.call("DEL", key)
  redis.call("PUBLISH", key, cjson.encode({{pid=pid, t="c"}}))
else
  return redis.error_reply("Invalid dset operation")
end
