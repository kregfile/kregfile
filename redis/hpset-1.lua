redis.call("HSET", KEYS[1], ARGV[2], ARGV[3])

local sub = cjson.encode({{
  pid=ARGV[1],
  t="s",
  k=cjson.decode(ARGV[2]),
  v=cjson.decode(ARGV[3])
}})
redis.call("PUBLISH", KEYS[1] , sub)
