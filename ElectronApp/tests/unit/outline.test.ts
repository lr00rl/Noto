import { describe, expect, it } from 'vitest';
import { outlineOf } from '../../src/renderer/outline';

describe('document outline', () => {
  it('lists headings with their depth and block position', () => {
    const source = '# Title\n\nBody.\n\n## Section\n\nMore.\n\n### Detail\n';
    expect(outlineOf(source)).toEqual([
      { blockIndex: 0, depth: 1, text: 'Title' },
      { blockIndex: 2, depth: 2, text: 'Section' },
      { blockIndex: 4, depth: 3, text: 'Detail' },
    ]);
  });

  it('strips the marker run without eating heading text', () => {
    expect(outlineOf('### C# and F#\n')[0].text).toBe('C# and F#');
    expect(outlineOf('## Closed heading ##\n')[0].text).toBe('Closed heading');
  });

  it('understands setext headings', () => {
    expect(outlineOf('Title\n=====\n\nSection\n-------\n')).toEqual([
      { blockIndex: 0, depth: 1, text: 'Title' },
      { blockIndex: 1, depth: 2, text: 'Section' },
    ]);
  });

  it('ignores hashes that are not headings', () => {
    // A fence keeps its contents out of the outline, and so does a paragraph
    // that merely mentions a hash.
    expect(outlineOf('```\n# not a heading\n```\n\nA # in prose.\n')).toEqual([]);
  });

  it('shows a heading that has no text yet rather than hiding it', () => {
    // Typing `# ` creates the heading before its text exists. The outline
    // mirrors the document, so the entry appears immediately and fills in.
    expect(outlineOf('#\u0020\n')).toEqual([{ blockIndex: 0, depth: 1, text: 'Untitled heading' }]);
    expect(outlineOf('## \n')).toEqual([{ blockIndex: 0, depth: 2, text: 'Untitled heading' }]);
  });

  it('returns nothing for a document without headings', () => {
    expect(outlineOf('Just a paragraph.\n\n- and a list\n')).toEqual([]);
  });

  it('tracks block index across non-heading blocks so navigation lands right', () => {
    const source = '| a |\n| --- |\n| 1 |\n\n# After a table\n';
    expect(outlineOf(source)).toEqual([{ blockIndex: 1, depth: 1, text: 'After a table' }]);
  });
});
