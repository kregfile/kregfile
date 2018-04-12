redis.call("HDEL", KEYS[1], ARGV[2])

local sub = cjson.encode({{
  pid=ARGV[1],
  t="d",
  k=cjson.decode(ARGV[2])
}})
redis.call("PUBLISH", KEYS[1] , sub)
