import { describe, expect, it } from 'vitest';
import { droppedNote } from '../../src/renderer/editor/noto/dropped-note';

const file = (name: string) => new File(['x'], name);

describe('a file dropped on the editor', () => {
  it('is a note to open when it is markdown or plain text', () => {
    expect(droppedNote([file('a.png'), file('b.MD')])!.name).toBe('b.MD');
    expect(droppedNote([file('notes.txt')])!.name).toBe('notes.txt');
  });

  it('is not one when it is a picture, or nothing', () => {
    expect(droppedNote([file('a.png'), file('b.jpg')])).toBeNull();
    expect(droppedNote([])).toBeNull();
    expect(droppedNote(null)).toBeNull();
  });
});
