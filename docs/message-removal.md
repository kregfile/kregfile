Message Removal
===

Goals
---

Kregfile moderators want to remove spam messages retroactively.

They get a message removal tool that allows them to:

1. Remove a single message
2. Remove every message by a session/account in the room
3. Remove every message by an IP in a room
4. Remove every message by a session/account globally
5. Remove every message by an IP globally


Non-Goals
---

Make this idiot proof. kregfile is "volatile" in that chat history
is stored in browsers but not on the server. This shouldn't be violated. If some messages are missed in some browsers, that's a valid trade-off.

Prerequisites
---

- Every message must be identifable by an id (for a period of time), without violating privacy rules (message itself cannot be stored). For that, a uuid-style token should suffice.
- Every message must be traceable back to a user's session/account and IP.
- It must be possible to find other messages associated with that user/ip.

To achieve this goal, each message will be inserted into redis in this way:

1. `message:<id>` with the below data structure
    ```json
    {
        "a": "account or session id"
        "i": "ip"
        "r": "roomid"
    }
    ```
2. `massoc:a:<a>:<roomid>:<id>` with no associated data
3. `massoc:i:<i>:<roomid>:<id>` with no associated data

THese redis keys will have a configurable TTL.


Moderators are a protected group, and will not insert the keys.


Single Message Removal
---

This is the easy part, just message connected clients about the removal.

- Moderator opts to remove message
- Client resolves the message id and emits a `removeMessage(id)` message
- Connected server process checks permissions and initiates a broker broadcast via a per-room channel to all users in the room (messages are 1:1 mapped to rooms)
- All server processes receive the broadcast and pass it along to clients as a `messagesRemoved([id])" message
- Clients receive message and
  1. Remove the message from the history
  2. Replace the DOM of the message with a "Message Removed" notice (except role=mod, that just mark the message as removed)

There are no requirements for persistent storage.

Multi Message Removal
---

In order to remove all messages (per room) associated with a user/ip, we need to track all message ids.

Redis keys are inserted for ever message id containing this structure:


1. Moderator opts to remove all user/ip messages (from a room)
2. Client sends a `removeMessages(id, options)` where options can contain `ip`, `user` and `room` flags or any combination thereof.
3. Server receives message, checks permissions and calls into a redis routine receiving the `id` and `options ` to handle the resolution and association.
4. Redis function looks up the message from the `message:<id>` key and retrieves `a` and `i` and `r`.
5. For each of `a` and `i` (depending on the options) redis `SCAN`s the `massoc:` key space for associated messages.
6. For each found message:
  1. Redis checks if the rooms are the same in case the `room` flag was specified.
  2. Send a broker broadcast on per room channels according to the single-message-removal protocol
7. Server processes and clients handle according to the single-message-removal protocol


Security/Privacy considerations
---

- The server has to verify the client is privileged to remove messages.