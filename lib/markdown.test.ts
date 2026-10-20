import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseInline, parseMarkdown, plainText } from './markdown';

describe('parseInline', () => {
  it('leaves plain text alone', () => {
    assert.deepEqual(parseInline('ten cups each side'), [{ type: 'text', text: 'ten cups each side' }]);
  });

  it('picks out bold and italic and keeps the text around them', () => {
    assert.deepEqual(parseInline('Elbows **behind** the table, *always*.'), [
      { type: 'text', text: 'Elbows ' },
      { type: 'strong', text: 'behind' },
      { type: 'text', text: ' the table, ' },
      { type: 'em', text: 'always' },
      { type: 'text', text: '.' },
    ]);
  });

  it('treats an unmatched asterisk as a literal', () => {
    assert.deepEqual(parseInline('5 * 2 cups'), [{ type: 'text', text: '5 * 2 cups' }]);
  });

  it('accepts underscores for italic', () => {
    assert.deepEqual(parseInline('_no_ re-racks'), [
      { type: 'em', text: 'no' },
      { type: 'text', text: ' re-racks' },
    ]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and keeps single newlines as line breaks', () => {
    const blocks = parseMarkdown('Line one\nLine two\n\nSecond paragraph');
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'paragraph');
    assert.deepEqual(
      (blocks[0] as { lines: unknown[][] }).lines.map((line) => plainText(line as never)),
      ['Line one', 'Line two'],
    );
  });

  it('reads headings at three levels and ignores deeper ones', () => {
    const blocks = parseMarkdown('# Setup\n## Play\n### Notes\n#### Not a heading');
    assert.deepEqual(
      blocks.map((block) => (block.type === 'heading' ? block.level : block.type)),
      [1, 2, 3, 'paragraph'],
    );
  });

  it('groups consecutive bullets into one list', () => {
    const blocks = parseMarkdown('- ten cups\n- two balls\n* re-rack at 6');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'list');
    const list = blocks[0] as { ordered: boolean; items: unknown[][] };
    assert.equal(list.ordered, false);
    assert.deepEqual(
      list.items.map((item) => plainText(item as never)),
      ['ten cups', 'two balls', 're-rack at 6'],
    );
  });

  it('starts a new list when the kind changes', () => {
    const blocks = parseMarkdown('1. flip\n2. drink\n- then run');
    assert.deepEqual(
      blocks.map((block) => (block.type === 'list' ? block.ordered : block.type)),
      [true, false],
    );
  });

  it('continues a list item onto the next line rather than starting a paragraph', () => {
    const blocks = parseMarkdown('- first rule\n  which carries on\n- second');
    const list = blocks[0] as { items: unknown[][] };
    assert.equal(blocks.length, 1);
    assert.equal(plainText(list.items[0] as never), 'first rule which carries on');
  });

  it('keeps inline marks inside headings and list items', () => {
    const [heading, list] = parseMarkdown('# **Beer** pong\n- *no* blowing');
    assert.equal(heading.type, 'heading');
    assert.deepEqual((heading as { content: unknown[] }).content[0], { type: 'strong', text: 'Beer' });
    assert.deepEqual((list as { items: unknown[][] }).items[0][0], { type: 'em', text: 'no' });
  });

  it('is empty for blank input', () => {
    assert.deepEqual(parseMarkdown(''), []);
    assert.deepEqual(parseMarkdown('\n\n  \n'), []);
  });

  it('handles Windows line endings', () => {
    assert.equal(parseMarkdown('a\r\n\r\nb').length, 2);
  });
});
