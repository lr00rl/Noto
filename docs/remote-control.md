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

## Finding it

While it is listening, `remote.json` sits beside the token and says where:

```sh
DIR=~/Library/Application\ Support/Noto
PORT=$(python3 -c "import json;print(json.load(open('$DIR/remote.json'))['port'])")
TOKEN=$(cat "$DIR/remote-token")
BASE=http://127.0.0.1:$PORT
```

Both files are readable by your account alone, and both go when it stops, so
a stale one never points at a port with nothing on it.

## The requests

Every reply is JSON. The token goes in the `Authorization` header. A refusal
carries a `code` as well as a sentence, so a program never has to match on
English: `unauthorized`, `browser`, `host`, `no-route`, `bad-body`,
`bad-path`, `no-such-note`, `outside-folder`, `open-failed`, `bad-text`,
`bad-place`, `unknown-command`, `no-document`, `no-window`, `bad-query`,
`bad-pattern`, `too-large`.

| Request | Method | Body | What it does |
| --- | --- | --- | --- |
| `/v1/status` | GET | | The protocol version, the app's version, the folder, the note in front, and whether it has unsaved changes |
| `/v1/commands` | GET | | What it accepts: the commands, the routes, and where text may be inserted |
| `/v1/document` | GET | | The note in front, with `source` saying whether it came from the editor or the file |
| `/v1/open` | POST | `{"path": "..."}` | Opens that note. The path may be absolute or relative to the folder |
| `/v1/insert` | POST | `{"text": "...", "at": "caret"}` | Puts the text in. `caret` is where you are; `end` adds it as blocks after the last one |
| `/v1/command` | POST | `{"command": "save"}` | Runs one of the commands below |
| `/v1/search` | POST | `{"query": "...", "caseSensitive": false, "wholeWord": false, "regex": false}` | Searches the vault, as the rail's search does |

The commands are `save`, `save-as`, `find`, `search-content`, `quick-open`,
`source-code-mode`, `toggle-sidebar`, `toggle-outline`, `toggle-read-only`,
`reload-from-disk`, `new-file` and `shortcuts`.

`/v1/document` answers with the editor's own copy when a window is there, so
unsaved changes are included, and `source` says `editor`. The text is what the
file would hold if it were saved at that moment, the same line endings and the
same last line, so comparing it against the file is meaningful. When no window
answers in time it falls back to the file and says `disk`.

## An example

Ask what is open, read it, add a paragraph at the end, and save:

```sh
auth="Authorization: Bearer $TOKEN"
json='content-type: application/json'

curl -s -H "$auth" $BASE/v1/status
curl -s -H "$auth" $BASE/v1/document | jq -r .markdown
curl -s -H "$auth" -H "$json" -d '{"text":"Added by a script.","at":"end"}' $BASE/v1/insert
curl -s -H "$auth" -H "$json" -d '{"command":"save"}' $BASE/v1/command
```

Find the notes that mention something, then open the first:

```sh
curl -s -H "$auth" -H "$json" -d '{"query":"kestrel"}' $BASE/v1/search |
  jq -r '.matches[0].relativePath' |
  xargs -I{} curl -s -H "$auth" -H "$json" -d "{\"path\":\"{}\"}" $BASE/v1/open
```

## If something goes wrong

A port already in use is reported in the pane rather than passed over in
silence; nothing is listening in that case. A token that has been somewhere it
should not have been is replaced with the button in the pane, which stops
everything holding the old one at once.
