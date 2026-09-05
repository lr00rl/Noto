/**
 * The query language quick open reads: `type:` and `scope:`.
 *
 * Ported from the author's own `fuzzy-search` plugin, keyword for keyword and
 * alias for alias, because a syntax half-learned in one tool and half-honoured
 * in another is worse than not having it. `type:` says what to search and
 * `scope:` says where, and everything else in the box is what to look for:
 *
 *   type:file      f, files      the names of notes
 *   type:folder    d, dir, dirs, folders
 *   type:content   c, text       the words inside notes
 *   scope:works/jobs             only inside that folder
 *
 * The tab is the default and the token is the statement: a query that says
 * `type:content` searches contents whichever tab is showing, which is what
 * lets one line of typing answer a question the tabs would take three keys
 * to ask.
 *
 * Pure, so the grammar, the token editing and the completion can be tested
 * without a palette around them.
 */

/** What a query can be aimed at. The names are the plugin's own. */
export const TYPE_VALUES = ['file', 'folder', 'content'] as const;

export type SearchType = (typeof TYPE_VALUES)[number];

/** The two operators, which is also the order they complete in. */
export const OPERATORS = ['type', 'scope'] as const;

const TYPE_ALIASES: Readonly<Record<string, SearchType>> = {
  file: 'file', f: 'file', files: 'file',
  folder: 'folder', d: 'folder', dir: 'folder', dirs: 'folder', folders: 'folder',
  content: 'content', c: 'content', text: 'content',
};

/** A key and its value, quoted or bare; the value may be empty, as in `type:`. */
const TOKEN = /\b(type|scope)\s*:\s*(?:"([^"]*)"|(\S*))/gi;

export interface ParsedQuery {
  /** What the query says to search, or null when it says nothing. */
  readonly type: SearchType | null;
  /** Where it says to search, normalised, or null. */
  readonly scope: string | null;
  /** What is left once the operators are taken out: the words to match. */
  readonly terms: string;
  readonly raw: string;
}

/** A path as a scope: forward slashes, no leading or trailing one. */
export function normalisePrefix(prefix: string): string {
  return prefix.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function resolveType(value: string): SearchType | null {
  return TYPE_ALIASES[value.trim().toLowerCase()] ?? null;
}

export function parseQuery(raw: string): ParsedQuery {
  let type: SearchType | null = null;
  let scope: string | null = null;
  const terms = raw
    .replace(TOKEN, (_match, key: string, quoted?: string, bare?: string) => {
      const value = (quoted ?? bare ?? '').trim();
      if (key.toLowerCase() === 'type') {
        const resolved = resolveType(value);
        if (resolved) type = resolved;
      } else {
        // An empty `scope:` clears it, which is how a scope is taken off
        // without deleting the word that put it there.
        scope = value.length > 0 ? normalisePrefix(value) : null;
      }
      // A space, so the words on either side do not fuse into one term.
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { type, scope, terms, raw };
}

const needsQuoting = (value: string): boolean => /\s/.test(value);

const formatToken = (key: string, value: string): string =>
  `${key}:${needsQuoting(value) ? `"${value}"` : value}`;

/** Put a token in, or change the one that is there, leaving the rest alone. */
export function setToken(raw: string, key: 'type' | 'scope', value: string): string {
  if (value === '') return removeToken(raw, key);
  const token = formatToken(key, value);
  const pattern = new RegExp(`\\b${key}\\s*:\\s*(?:"[^"]*"|\\S*)`, 'i');
  if (pattern.test(raw)) return raw.replace(pattern, token).replace(/\s+/g, ' ').trimStart();
  // In front, so a query reads as the operators and then the words.
  return (raw.trim().length > 0 ? `${token} ${raw.trim()}` : token).replace(/\s+/g, ' ');
}

export function removeToken(raw: string, key: 'type' | 'scope'): string {
  return raw
    .replace(new RegExp(`\\b${key}\\s*:\\s*(?:"[^"]*"|\\S*)`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Completion {
  /** What the row says, which is also what the token becomes. */
  readonly label: string;
  /** The whole box after taking this one. */
  readonly insert: string;
  /** Where the caret goes after that. */
  readonly cursor: number;
  /** A word after the label: how many notes a folder holds. */
  readonly hint?: string;
}

export interface CompletionResult {
  readonly candidates: readonly Completion[];
  /** What the top candidate would add to what is typed, or nothing. */
  readonly ghost: string;
}

const EMPTY: CompletionResult = { candidates: [], ghost: '' };

/** The run of non-space characters the caret is in, and where it starts and ends. */
function tokenAt(raw: string, cursor: number): { text: string; start: number; end: number } {
  let start = cursor;
  while (start > 0 && !/\s/.test(raw[start - 1])) start -= 1;
  let end = cursor;
  while (end < raw.length && !/\s/.test(raw[end])) end += 1;
  return { text: raw.slice(start, end), start, end };
}

const withToken = (raw: string, start: number, end: number, replacement: string) => ({
  insert: raw.slice(0, start) + replacement + raw.slice(end),
  cursor: start + replacement.length,
});

/** What the top candidate adds to what is typed, if it simply extends it. */
function ghostFor(typed: string, candidate: string | undefined): string {
  if (candidate === undefined) return '';
  return candidate.toLowerCase().startsWith(typed.toLowerCase()) && candidate.length > typed.length
    ? candidate.slice(typed.length)
    : '';
}

/**
 * What the token under the caret could become.
 *
 * Prefix matching rather than fuzzy: a completion that rewrites what has been
 * typed into something that merely resembles it is a worse offer than none. A
 * scope completes one segment at a time, the way a shell completes a path, so
 * `scope:A` offers the folders called A and not every folder beneath them.
 */
export function completeQuery(
  raw: string,
  cursor: number,
  folders: readonly { readonly relativePath: string; readonly notes?: number }[] = [],
  limit = 8,
): CompletionResult {
  const { text, start, end } = tokenAt(raw, cursor);
  if (text.length === 0) return EMPTY;

  const scoped = /^scope:(.*)$/i.exec(text);
  if (scoped) {
    const written = scoped[1].replace(/^"|"$/g, '');
    const partial = normalisePrefix(written);
    // A path that ends in a slash means "inside this one", as it does in a
    // shell: the folder itself is already chosen and its children are what is
    // being asked for. Without this the only candidate is the folder that was
    // just taken, and the list stops being an offer.
    const inside = /[\\/]$/.test(written);
    const slash = partial.lastIndexOf('/');
    const parent = inside ? partial : (slash === -1 ? '' : partial.slice(0, slash));
    const leaf = inside ? '' : (slash === -1 ? partial : partial.slice(slash + 1)).toLowerCase();
    const candidates = folders
      .filter((folder) => {
        const path = normalisePrefix(folder.relativePath);
        const at = path.lastIndexOf('/');
        const holder = at === -1 ? '' : path.slice(0, at);
        const name = at === -1 ? path : path.slice(at + 1);
        return holder.toLowerCase() === parent.toLowerCase() && name.toLowerCase().startsWith(leaf);
      })
      .slice(0, limit)
      .map((folder) => {
        // The slash on the end is an invitation to keep going: type a letter
        // and the next segment's folders are what comes back.
        const label = formatToken('scope', `${normalisePrefix(folder.relativePath)}/`);
        return {
          label,
          ...withToken(raw, start, end, label),
          ...(folder.notes === undefined
            ? {}
            : { hint: `${folder.notes} ${folder.notes === 1 ? 'note' : 'notes'}` }),
        };
      });
    return { candidates, ghost: ghostFor(text, candidates[0]?.label) };
  }

  const typed = /^type:(.*)$/i.exec(text);
  if (typed) {
    const partial = typed[1].toLowerCase();
    const values = new Set<SearchType>();
    for (const value of TYPE_VALUES) if (value.startsWith(partial)) values.add(value);
    const aliased = resolveType(partial);
    if (aliased) values.add(aliased);
    const candidates = [...values].slice(0, limit).map((value) => {
      const label = `type:${value}`;
      return { label, ...withToken(raw, start, end, label) };
    });
    return { candidates, ghost: ghostFor(text, candidates[0]?.label) };
  }

  const lower = text.toLowerCase();
  const keywords = OPERATORS.filter((operator) => operator.startsWith(lower) && operator !== lower);
  if (keywords.length > 0) {
    const candidates = keywords.slice(0, limit).map((operator) => {
      const label = `${operator}:`;
      return { label, ...withToken(raw, start, end, label) };
    });
    return { candidates, ghost: ghostFor(text, candidates[0]?.label) };
  }
  return EMPTY;
}
