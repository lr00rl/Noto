import { describe, expect, it } from 'vitest';
import { isHtmlComment } from '../../src/renderer/editor/noto/html-view';

describe('isHtmlComment', () => {
  it('recognises the markers this vault wraps its generated sections in', () => {
    expect(isHtmlComment('<!-- note-assistant:index:start -->')).toBe(true);
    expect(isHtmlComment('<!-- note-assistant:index:end -->')).toBe(true);
    expect(isHtmlComment('  <!-- a note to a future editor -->  ')).toBe(true);
    expect(isHtmlComment('<!--\n  several lines\n-->')).toBe(true);
  });

  it('leaves real markup framed, because a reader has to see it to edit it', () => {
    expect(isHtmlComment('<div class="x">text</div>')).toBe(false);
    expect(isHtmlComment('<img src="a.png">')).toBe(false);
    expect(isHtmlComment('<br/>')).toBe(false);
  });

  it('refuses a block that holds more than one thing', () => {
    // The text after the first comment is markup, and hiding the frame would
    // hide that too.
    expect(isHtmlComment('<!-- one --><div>two</div>')).toBe(false);
    expect(isHtmlComment('<!-- one -->\n<!-- two -->')).toBe(false);
  });

  it('refuses an unclosed comment, which is not one yet', () => {
    expect(isHtmlComment('<!-- still typing')).toBe(false);
    expect(isHtmlComment('-->')).toBe(false);
    expect(isHtmlComment('')).toBe(false);
  });
});
