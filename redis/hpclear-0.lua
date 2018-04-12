redis.call("DEL", KEYS[1])

local sub = cjson.encode({{
  pid=ARGV[1],
  t="c"
}})
redis.call("PUBLISH", KEYS[1] , sub)
