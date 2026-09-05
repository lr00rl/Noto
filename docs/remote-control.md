# Driving Noto from outside it

Noto can be driven by a program on the same machine: a script, a shortcut, or
an agent working alongside you. It is off until you switch it on, in
Preferences under Remote, and while it is on the status line says so.

## What it is, and what it is not

It listens on `127.0.0.1` and on no other interface, so nothing beyond this
machine can reach it. Every request carries a token, which is written to
`remote-token` beside the settings, readable by your account alone. A request
that carries an `Origin` header is refused, and so is one whose `Host` header
names anything but the loopback address: together those are what stop a page
in a browser, or a site whose name has been pointed at `127.0.0.1`, from
driving your editor.

What it can do is deliberately short. It cannot write to a path of its own
choosing, and it cannot run whatever the menus happen to carry. Opening a note
goes through the same check every other path in the app goes through, which
confines it to the folder that is open.

## The requests

Every reply is JSON. The token goes in the `Authorization` header.

```
curl -H "Authorization: Bearer TOKEN" http://127.0.0.1:37610/v1/status
```

| Request | Method | Body | What it does |
| --- | --- | --- | --- |
| `/v1/status` | GET | | The version, the folder, the note in front, and whether it has unsaved changes |
| `/v1/document` | GET | | The note in front as it is on disk, with its path |
| `/v1/open` | POST | `{"path": "..."}` | Opens that note, if it is inside the folder |
| `/v1/insert` | POST | `{"text": "..."}` | Puts the text at the caret, as one undoable step |
| `/v1/command` | POST | `{"command": "save"}` | Runs one of the commands below |

The commands are `save`, `save-as`, `find`, `search-content`, `quick-open`,
`source-code-mode`, `toggle-sidebar`, `toggle-outline`, `toggle-read-only`,
`reload-from-disk`, `new-file` and `shortcuts`.

`/v1/document` reads the file, so `dirty` in the status is the caveat that
matters: when it is true, the note on screen is ahead of what you will read.
Send `{"command": "save"}` first if you need them to agree.

## An example

Ask what is open, read it, add a line, and save:

```sh
TOKEN=$(pbpaste)              # copied from the Remote pane
BASE=http://127.0.0.1:37610
auth="Authorization: Bearer $TOKEN"

curl -s -H "$auth" $BASE/v1/status
curl -s -H "$auth" $BASE/v1/document | jq -r .markdown
curl -s -H "$auth" -H 'content-type: application/json' \
  -d '{"text":"\n\nAdded by a script.\n"}' $BASE/v1/insert
curl -s -H "$auth" -H 'content-type: application/json' \
  -d '{"command":"save"}' $BASE/v1/command
```

## If something goes wrong

A port already in use is reported in the pane rather than passed over in
silence; nothing is listening in that case. A token that has been somewhere it
should not have been is replaced with the button in the pane, which stops
everything holding the old one at once.
