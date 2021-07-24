kregfile - somewhat like volafile
===

kregfile is like volafile, except open source and you can host it yourself.
In fact, you have to host it yourself, because I won't be doing it for you.


Prerequisites
---

- node (14+)
- yarn
- A working C++ compiler, to compile node extension modules
- Previews
  - exiftool
  - ffmpeg
  - imagemagick and graphicsmagick (optional, for PDF previews)
  - firejail (optional, but highly recommended, see 'jail' in the config to disable)


Instructions
---

- Start a redis
- `yarn`
- Fiddle with `.config.json` if you must, use `defaults.js` as a reference.
- Then run `yarn start` for maximum cancer
- Navigate to `127.0.0.1:8080` and enjoy.

If everything works, you may consider putting things into production, get TLS certificates on so on.

Force-making specific rooms
---

Just use the redis-cli to set `rooms:<alias>` to some number (usually the timestamp), e.g. `redis-cli set rooms:gentoomen 1`.

Making moderators
---

Use the `./setRole.js` script to set the `mod` role for a user (and make the user refresh the tab).


Code structure
---

- `common` has code commonly shared between the frontend and backend
- `client` has most client-side code
- `entries` contains the entry points for client side code (for webppack)
- `lib` contains most server-side code
- `static` contains static assets (and webpack generated bundles)
- `uploads` contains the uploaded files (unless specified differently in the config)
- `views` contains the ejs templates (not many)

How to devel?
---

- Run `yarn run pack` in a shell. This will start webpack in watch mode and rebundle once the sources change automatically
- Run `nodemon` in another shell. This will trigger server restarts automatically when you change things.

The clients (browser tabs) should automatically reconnect and pull any new client code version automatically.

Troubleshooting FAQ
---

1. *My previews do not work!*
   
   Make sure you have all the prerequites installed.
   Then it might be firejail that is broken, e.g. it refuses to run in another "sandbox" (which might be the VPS/linux container/docker your kregfile is running in).
   If that's the case, then consider turning off the "jail" config option and check if it then works for you.