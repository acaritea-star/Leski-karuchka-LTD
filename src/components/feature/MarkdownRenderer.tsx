import { Fragment } from 'react';
import { Link } from 'react-router-dom';

/**
 * Minimal, SAFE Markdown renderer for news articles.
 *
 * It converts a tiny, well-defined subset of Markdown into React elements
 * (never dangerouslySetInnerHTML), so arbitrary HTML / JavaScript in the
 * article content can never execute. Supported syntax:
 *   - `## Heading` / `### Heading` (rendered as h2/h3 — never h1)
 *   - `* item` / `- item` bullet lists
 *   - `**bold**`, `*italic*`
 *   - `[text](/internal-path)` → react-router Link, `[text](https://…)` → <a>
 *   - paragraphs
 */

function renderInline(text: string): React.ReactNode {
  // Order matters: bold first, then italic, then links.
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(regex);

  return parts.map((part, i) => {
    if (!part) return null;

    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      return (
        <strong key={i} className="font-semibold text-foreground-950">
          {bold[1]}
        </strong>
      );
    }

    const italic = part.match(/^\*([^*]+)\*$/);
    if (italic) {
      return <em key={i}>{italic[1]}</em>;
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const label = link[1];
      const href = link[2];
      if (href.startsWith('http')) {
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="text-primary-600 hover:text-primary-700 underline underline-offset-2"
          >
            {label}
          </a>
        );
      }
      return (
        <Link
          key={i}
          to={href}
          className="text-primary-600 hover:text-primary-700 underline underline-offset-2"
        >
          {label}
        </Link>
      );
    }

    return <Fragment key={i}>{part}</Fragment>;
  });
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const blocks = content
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-5">
      {blocks.map((block, i) => {
        // Headings (h2 / h3 only — the page title is the h1)
        if (block.startsWith('### ')) {
          return (
            <h3
              key={i}
              className="font-heading font-semibold text-foreground-950 text-lg md:text-xl tracking-tight pt-2"
            >
              {renderInline(block.slice(4).trim())}
            </h3>
          );
        }
        if (block.startsWith('## ')) {
          return (
            <h2
              key={i}
              className="font-heading font-semibold text-foreground-950 text-xl md:text-2xl tracking-tight pt-3"
            >
              {renderInline(block.slice(3).trim())}
            </h2>
          );
        }

        // Bullet list
        const lines = block.split('\n');
        const isList = lines.every((l) => /^[*\-]\s+/.test(l.trim()));
        if (isList) {
          const items = lines.map((l) => l.trim().replace(/^[*\-]\s+/, ''));
          return (
            <ul key={i} className="space-y-2 pl-1">
              {items.map((item, j) => (
                <li key={j} className="flex items-start gap-3 text-foreground-600 leading-relaxed">
                  <span className="mt-[0.55em] w-1.5 h-1.5 rounded-full bg-accent-500 shrink-0" />
                  <span>{renderInline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }

        // Paragraph
        return (
          <p key={i} className="text-foreground-600 leading-relaxed text-[15px] md:text-base">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}