/**
 * Vertical rules at each tab stop of a code line's indentation.
 *
 * The author's `fence-enhance` plugin draws these in Typora and their vault
 * has 285,431 indented lines across 31,372 fences, so the guides are what
 * makes a block of Python or YAML readable at a glance rather than a wall.
 *
 * Drawn as a background on the leading whitespace of each line, which is the
 * one place a rule can go without adding an element per line to a document
 * that may hold tens of thousands of them. The whitespace is real text in the
 * file, so nothing is inserted and nothing is escaped.
 *
 * Pure, so the column arithmetic is tested without a document.
 */

/** How many columns of indentation a line opens with, tabs expanded. */
export function indentColumns(line: string, tabSize: number): number {
  let columns = 0;
  for (const character of line) {
    if (character === '\t') columns += tabSize - (columns % tabSize);
    else if (character === ' ') columns += 1;
    else break;
  }
  return columns;
}

/** How many characters of the line are that indentation. */
export function indentLength(line: string): number {
  let count = 0;
  while (count < line.length && (line[count] === ' ' || line[count] === '\t')) count += 1;
  return count;
}

const greatestCommonDivisor = (a: number, b: number): number => (b === 0 ? a : greatestCommonDivisor(b, a % b));

/**
 * The block's own indent step, from the indents it actually uses.
 *
 * Their common divisor rather than a guess: a file indented by three has its
 * guides at three, and one that mixes two and four gets them at two. A block
 * led by tabs takes the tab size, since a tab is one step whatever its width.
 */
export function detectIndentUnit(lines: readonly string[], tabSize: number, maxSample = 200): number {
  let unit = 0;
  let sampled = 0;
  let tabLed = 0;
  let spaceLed = 0;
  for (const line of lines) {
    if (sampled >= maxSample) break;
    if (line.trim() === '') continue;
    sampled += 1;
    if (line[0] === '\t') { tabLed += 1; continue; }
    const columns = indentColumns(line, tabSize);
    if (columns === 0) continue;
    spaceLed += 1;
    unit = unit === 0 ? columns : greatestCommonDivisor(unit, columns);
  }
  if (tabLed > spaceLed) return tabSize;
  return spaceLed === 0 || unit < 2 ? tabSize : unit;
}

/**
 * The background that draws a line's guides, or null where there are none.
 *
 * One hairline at each step up to, but not including, the line's own indent:
 * a rule under the first character of the text would underline the code
 * rather than mark the step it sits at.
 */
export function indentGuideStyle(columns: number, unit: number, color: string): string | null {
  if (unit <= 0 || columns < unit) return null;
  const stops: string[] = [];
  for (let column = unit; column <= columns - 1; column += unit) {
    stops.push(`transparent calc(${column}ch - 1px)`, `${color} calc(${column}ch - 1px)`, `${color} ${column}ch`, `transparent ${column}ch`);
  }
  if (stops.length === 0) return null;
  return `background-image: linear-gradient(to right, transparent 0, ${stops.join(', ')}, transparent 100%)`;
}

export interface GuideRange {
  /** Offset of the line's first character within the block's text. */
  readonly from: number;
  readonly to: number;
  readonly style: string;
}

/** Every guide range in one code block's text. */
export function guideRanges(text: string, tabSize: number, color: string): GuideRange[] {
  const lines = text.split('\n');
  const unit = detectIndentUnit(lines, tabSize);
  const ranges: GuideRange[] = [];
  let offset = 0;
  for (const line of lines) {
    const length = indentLength(line);
    if (length > 0 && line.trim() !== '') {
      const style = indentGuideStyle(indentColumns(line, tabSize), unit, color);
      if (style !== null) ranges.push({ from: offset, to: offset + length, style });
    }
    offset += line.length + 1;
  }
  return ranges;
}
