/*
 * A deliberately small markdown subset for game rules. SPEC.md §4.3 types
 * `games.rules` as markdown text; this is what "markdown" means here.
 *
 * Headings (#, ##, ###), paragraphs, bullet lists (- or *), numbered lists
 * (1.), and **bold** / *italic* inline. Nothing else: no raw HTML, no links,
 * no images. The output is a block tree rendered to React elements, never an
 * HTML string, so there is nothing to sanitise.
 *
 * Pure, so it is tested without a request or a DOM.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; content: Inline[] }
  | { type: 'paragraph'; lines: Inline[][] }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

const HEADING = /^(#{1,3})\s+(.*\S)\s*$/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*\S)\s*$/;

/** `**bold**`, `*italic*` and `_italic_`; anything unmatched stays literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: 'text', text: text.slice(last, start) });
    if (match[1] !== undefined) out.push({ type: 'strong', text: match[1] });
    else out.push({ type: 'em', text: match[2] ?? match[3] ?? '' });
    last = start + match[0].length;
  }

  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  let paragraph: Inline[][] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        content: parseInline(heading[2]),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline((bullet ?? numbered)![1]));
      continue;
    }

    // Plain text. A line directly under a list item continues that item;
    // otherwise it is a paragraph line, and a single newline is a line break.
    if (list && list.items.length > 0) {
      const item = list.items[list.items.length - 1];
      item.push({ type: 'text', text: ' ' }, ...parseInline(line.trim()));
      continue;
    }
    paragraph.push(parseInline(line.trim()));
  }

  flushParagraph();
  flushList();
  return blocks;
}

/** Text with every mark stripped — for previews and tests. */
export function plainText(inlines: Inline[]): string {
  return inlines.map((inline) => inline.text).join('');
}
