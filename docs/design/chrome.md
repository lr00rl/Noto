# The chrome

What surrounds the document, and why it is shaped this way. The document itself
is specified by the editor stylesheet; this covers the title bar, the rail, the
tabs, the status line and preferences.

## Who this is for

One person, in the app for hours a day, writing and reading long technical notes
in Chinese with English code identifiers, inside a folder tree that is four
levels deep and has a few thousand files in it. That single fact settles most of
what follows: the more hours a day someone spends in a tool, the less decoration
it should carry and the more precision it needs. Beauty buys tolerance on first
contact and that credit does not renew. Everything here is judged by whether it
still reads well in month three.

Typora is the reference for how little chrome a writing surface needs. It is not
a reference for what Noto does, which includes tabs, a plugin tier and settings
Typora does not have.

## The one idea

**The only thing the chrome marks is where you are.** A terracotta spine, two
pixels wide, on the left edge of the current thing: the current file in the
tree, the current heading in the outline, the current block in the document.
Same colour, same width, same meaning, three places.

Everything else in the chrome is ink, muted, or hairline. No filled accent
buttons, no accent underlines on tabs, no accent borders around toggles. The
previous build spent the accent on nine unrelated things at once, which is why
none of them read as important.

Remove the spine and the app is still completely usable. That is the test an
accent has to pass.

## Layers

The chassis is editorial: a serif measure of 60 to 75 characters, generous
leading, one spacing scale, near-zero motion. The evidence is the Markdown
document, which occupies the whole canvas and needs no help. The accent is the
spine, and it is under five percent of any viewport.

## Title bar

38 pixels. It carries identity, not actions.

The filename sits in the optical centre of the window at 13px in `--muted`, with
the unsaved dot beside it. On macOS the bar reserves 78px on the left for the
traffic lights and nothing else goes there except the rail toggle.

Icons only, at 26×26 with a 15px stroke glyph, `--muted` at rest, `--ink` on
hover, `--accent` while the surface they open is open. No borders. No fills. No
labels. Six bordered text buttons in a row is a toolbar from 2005 and it competed
with the document on every screen.

What is on it: the rail toggle on the left; plugins, preferences and save on the
right. What is not, and where it went instead:

| Was a button | Now |
| --- | --- |
| Open… | File menu, the empty state, the tree |
| Outline | A tab inside the rail |
| Theme | Preferences, under Appearance |
| Find | `Cmd+F` and the Edit menu |

**Save appears only when there is something to save.** A permanently greyed Save
is noise in a window that is saved almost all of the time, and it says nothing
when it finally lights up. The dot on the filename is the state; the icon is the
action, and it arrives with the state.

The state word itself (`Opened`, `Unsaved changes`, `Saved`) stays in the DOM as
a live region for assistive technology and is not drawn. Sighted users get the
dot. Exceptional states are not whispered here at all: they take the alert.

## Rail

One region on the left, 240px, holding two views rather than two panels. The
previous build opened Files and Outline as separate columns, so asking for both
spent 470 pixels of a 1280 pixel window on navigation.

The header is two text tabs, `Files` and `Outline`, 12px, active in `--ink` and
inactive in `--muted`. The rail toggle in the title bar opens and closes the
region; the menu items open it on the view they name.

Tree rows are 26px, which is the density a four-level tree needs. No background
at rest, `--raised` on hover, and the current file gets `--raised` plus the
spine. The previous build drew a filled rounded rectangle in accent tint around
the current file and every open folder, so a third of the tree was orange.
Indent is marked by 1px hairline guides, not by spacing alone.

## Tabs

Only drawn when more than one document is open. The active tab takes `--paper`,
the same surface as the canvas, so it reads as continuous with the document
below it rather than as a separate control strip. Inactive tabs take `--panel`
and `--muted` text. The close affordance appears on hover.

No accent underline. The tab that is the same colour as the page is already the
one you are in.

## Status line

28px, `--muted`, 11px. The containing folder on the left, shortened to a leading
tilde inside the home directory, with the full path on hover. The fidelity line
on the right, which is the one thing in the window that says the file is being
kept byte for byte, and which nothing else says.

Not the filename: the title bar has it, and repeating it spends the only other
line the window has on something already read.

## Preferences

One dialog, 720×560, reached from the gear or `Cmd+,`. Sections down the left,
content on the right: Appearance, Editor, Plugins.

Plugins live here because they are configuration, not a workspace panel. They
had a right sidebar of their own that pushed the document sideways whenever it
opened, and it read as a debug console: `Disabled` in bold, a paragraph of
capability jargon, and a full-width `Enable` slab, four times over. As a
preferences section each plugin is one row, name and a plain sentence on the
left, the action on the right at its natural width. Diagnostics stay collapsed
behind a disclosure, because that is what they are.

Copy in this dialog is written for the person using the editor. "Editor
decoration only. No filesystem access." is a capability declaration and belongs
in the manifest, not on screen. What the reader needs is what the plugin does.

## What the chrome must never do

Move the document sideways when a panel opens is unavoidable with a rail, but
nothing else may. Panels do not float over text. Controls do not appear and
disappear on hover except the tab close. Nothing animates on load. The accent
never appears twice in one region.
