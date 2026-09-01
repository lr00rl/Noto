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

The header is two words, `Files` and `Outline`, with a 1.5px rule that slides
between them in 180ms. Not a bordered segmented control: that is a component
out of a kit, it repeats the panel border it already sits inside, and its filled
half becomes the second heaviest thing in the rail. The rule moves because
moving is what says the two are one control and that you went from one to the
other. It is positioned by a custom property the current view sets, so nothing
is measured after paint and the first frame is never in the wrong place.

The rail toggle in the title bar opens and closes the region; the menu items
open it on the view they name.

Tree rows are 26px, which is the density a four-level tree needs. No background
at rest, `--raised` on hover, and the current file gets a tint plus the spine.
The previous build drew a filled rounded rectangle in accent tint around the
current file and every open folder, so a third of the tree was orange.

### Connector lines

Both trees in the rail draw them, and they are the reason a deep tree is
readable at all: without them a four-level tree is a column of names at varying
indents and the eye has to measure pixels to see what belongs to what.

Three parts. Each level carries a 1px vertical stem as a background gradient, so
no positioning context is created and nothing is measured in script. Each row
draws a horizontal arm into that stem. The last row of a level draws a rounded
corner instead and masks the stem below it.

That last part is the whole difference. A tee on every row including the last
reads as a grid of ticks; a corner that closes the branch reads as a tree. The
technique is the one in the author's own Typora theme, which draws the same
three parts with inline SVG; here the markup is ours, so borders and a
`border-bottom-left-radius` do it without the data URIs.

The line colour is `--tree-line`, an ink or paper wash at 14 to 18 percent. Low
enough that a deep tree reads as texture rather than as a diagram, which is the
difference between a guide and a schematic.

### Indicators are bars, not inset shadows

`box-shadow: inset 2px 0 0` on a element with a border radius follows that
radius: it comes out thick in the middle and pinched to nothing at both ends, a
crescent rather than a bar. Every "you are here" mark in the app is its own
absolutely positioned element with its own 1px radius and a 5px inset top and
bottom, so it is a straight bar with round caps and looks like a decision.

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

Appearance carries the theme, the three typographic settings, and the custom
stylesheet. Text size, line height and line width are sliders with the value
beside them in its own units, because a slider alone hides the number and a
number field alone turns finding a comfortable line height into typing and
re-typing. The width is a character count rather than a pixel width, since
comfortable line length is what it actually controls and it should hold as the
size changes; it replaced a narrow/medium/wide preset that could not say 68
when 66 and 74 were both wrong.

Range inputs are painted rather than left alone. A bare one uses the operating
system's accent colour, which is neither this app's accent nor anything the
palette knows about: a strip of macOS blue in a warm paper window.

The custom stylesheet is a path, not a text area: a theme is a file you keep
open in your own editor and reload, and a picker would make you find it again
every time. It is committed on blur or Enter rather than per keystroke, so a
half-typed path is never written and never reported unreadable.

Two things make that stylesheet actually able to retheme the app. The palette
lives in a `@layer`, because an unlayered rule beats a layered one whatever its
specificity, and without that a user's `:root { --accent: … }` would silently
lose to the theme's `:root[data-theme='light']`. And the stylesheet is applied
as a constructed sheet through `adoptedStyleSheets` rather than as a `<style>`
element, because the renderer's `style-src 'self'` refuses inline style elements
outright: the element appears in the DOM and the browser declines to apply it,
a failure whose only symptom is the theme not working. A sheet built by script
is not parsed from markup, so the policy stays exactly as strict as it was.

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

## Saving automatically

Off by default, and debounced against typing rather than fired when the document
turns dirty. A save costs between 226 ms and several seconds depending on the
document, so saving mid-word on a large file would stall the very typing that
triggered it.

It refuses in exactly the cases the Save button refuses: a save already in
flight, a recovery record standing, a file changed underneath us. Automatic
saving must not reach a path the manual one guards, and an external conflict
resolved automatically is data loss nobody watched happen.

## What the chrome must never do

Move the document sideways when a panel opens is unavoidable with a rail, but
nothing else may. Panels do not float over text. Controls do not appear and
disappear on hover except the tab close. Nothing animates on load. The accent
never appears twice in one region.
