import { describe, expect, it } from 'vitest';
import {
  completeQuery, normalisePrefix, parseQuery, removeToken, resolveType, setToken,
} from '../../src/renderer/quick-open-query';

const FOLDERS = [
  { relativePath: 'works', notes: 12 },
  { relativePath: 'works/jobs', notes: 5 },
  { relativePath: 'works/journal', notes: 3 },
  { relativePath: 'archive', notes: 40 },
];

describe('what a query says', () => {
  it('reads the type, by its name or any of its aliases', () => {
    expect(parseQuery('type:content kestrel').type).toBe('content');
    expect(parseQuery('type:c kestrel').type).toBe('content');
    expect(parseQuery('type:d').type).toBe('folder');
    expect(parseQuery('TYPE:Files').type).toBe('file');
    expect(resolveType('nonsense')).toBeNull();
    expect(parseQuery('type:nonsense kestrel').type).toBeNull();
  });

  it('reads the scope, quoted when it has spaces in it', () => {
    expect(parseQuery('scope:works/jobs plan').scope).toBe('works/jobs');
    expect(parseQuery('scope:"my notes/2026" plan').scope).toBe('my notes/2026');
    expect(parseQuery('scope:/works/ plan').scope).toBe('works');
    // Nothing after it at all takes the scope off rather than meaning the
    // root. A word after a space is the value, as it is in the plugin: the
    // colon binds to the next thing typed, not to the end of the word.
    expect(parseQuery('scope:').scope).toBeNull();
    expect(parseQuery('plan scope:').scope).toBeNull();
    expect(parseQuery('scope: plan').scope).toBe('plan');
  });

  it('leaves everything else as the words to look for', () => {
    expect(parseQuery('type:content scope:works kestrel plan').terms).toBe('kestrel plan');
    expect(parseQuery('  spaced   out  ').terms).toBe('spaced out');
    // The token is taken out as a space, so the words around it stay apart.
    expect(parseQuery('one type:file two').terms).toBe('one two');
  });
});

describe('changing a token without disturbing the rest', () => {
  it('adds one in front, and replaces the one that is there', () => {
    expect(setToken('kestrel', 'type', 'content')).toBe('type:content kestrel');
    expect(setToken('type:file kestrel', 'type', 'content')).toBe('type:content kestrel');
    expect(setToken('type:file kestrel', 'scope', 'works')).toBe('scope:works type:file kestrel');
  });

  it('quotes a value that would not survive being read back', () => {
    const written = setToken('plan', 'scope', 'my notes/2026');
    expect(written).toBe('scope:"my notes/2026" plan');
    expect(parseQuery(written).scope).toBe('my notes/2026');
  });

  it('takes one out, leaving the words', () => {
    expect(removeToken('type:content scope:works kestrel', 'type')).toBe('scope:works kestrel');
    expect(setToken('type:content kestrel', 'type', '')).toBe('kestrel');
    expect(removeToken('kestrel', 'scope')).toBe('kestrel');
  });
});

describe('what the box offers to finish', () => {
  const at = (raw: string) => completeQuery(raw, raw.length, FOLDERS);

  it('finishes an operator keyword from a bare word', () => {
    expect(at('ty').candidates.map((one) => one.label)).toEqual(['type:']);
    expect(at('sc').candidates.map((one) => one.label)).toEqual(['scope:']);
    expect(at('kestrel').candidates).toEqual([]);
  });

  it('finishes a type from what has been typed of it', () => {
    expect(at('type:c').candidates.map((one) => one.label)).toEqual(['type:content']);
    expect(at('type:f').candidates.map((one) => one.label)).toEqual(['type:file', 'type:folder']);
    expect(at('type:').candidates).toHaveLength(3);
  });

  it('finishes a scope one folder at a time, as a shell does', () => {
    expect(at('scope:w').candidates.map((one) => one.label)).toEqual(['scope:works/']);
    // The slash means inside, so only that folder's own children are offered.
    expect(at('scope:works/').candidates.map((one) => one.label))
      .toEqual(['scope:works/jobs/', 'scope:works/journal/']);
    expect(at('scope:works/jo').candidates).toHaveLength(2);
    expect(at('scope:works/jour').candidates.map((one) => one.label)).toEqual(['scope:works/journal/']);
    expect(at('scope:works/jobs').candidates[0].hint).toBe('5 notes');
    // One is one, which a list of folder sizes says often enough to matter.
    expect(completeQuery('scope:a', 6, [{ relativePath: 'alone', notes: 1 }]).candidates[0].hint)
      .toBe('1 note');
    // And what is taken parses back to the folder it names.
    expect(parseQuery(at('scope:w').candidates[0].insert).scope).toBe('works');
  });

  it('says what taking the first one would add, and where it puts the caret', () => {
    const result = at('type:c');
    expect(result.ghost).toBe('ontent');
    expect(result.candidates[0].insert).toBe('type:content');
    expect(result.candidates[0].cursor).toBe('type:content'.length);
  });

  it('completes the token the caret is in, leaving the rest of the box alone', () => {
    const raw = 'type:c kestrel';
    const result = completeQuery(raw, 6, FOLDERS);
    expect(result.candidates[0].insert).toBe('type:content kestrel');
    expect(result.candidates[0].cursor).toBe('type:content'.length);
    // With the caret in the words, there is nothing to finish.
    expect(completeQuery(raw, raw.length, FOLDERS).candidates).toEqual([]);
  });
});

describe('a path as a scope', () => {
  it('is slashes forward, with none at either end', () => {
    expect(normalisePrefix('/works/jobs/')).toBe('works/jobs');
    expect(normalisePrefix('works\\jobs')).toBe('works/jobs');
    expect(normalisePrefix('')).toBe('');
  });
});
