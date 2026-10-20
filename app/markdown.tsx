import { type Block, type Inline, parseMarkdown } from '@/lib/markdown';

/**
 * Renders the markdown subset in lib/markdown.ts as React elements. The parser
 * never emits HTML, so nothing here goes through dangerouslySetInnerHTML.
 */
export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="flex flex-col gap-3 text-base">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
      return (
        <Tag className={block.level === 1 ? 'section-title' : 'text-base font-black uppercase tracking-wide'}>
          <Inlines content={block.content} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p>
          {block.lines.map((line, index) => (
            <span key={index}>
              {index > 0 && <br />}
              <Inlines content={line} />
            </span>
          ))}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`flex flex-col gap-1 pl-6 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <Inlines content={item} />
            </li>
          ))}
        </Tag>
      );
    }
  }
}

function Inlines({ content }: { content: Inline[] }) {
  return (
    <>
      {content.map((inline, index) => {
        if (inline.type === 'strong') return <strong key={index}>{inline.text}</strong>;
        if (inline.type === 'em') return <em key={index}>{inline.text}</em>;
        return <span key={index}>{inline.text}</span>;
      })}
    </>
  );
}
