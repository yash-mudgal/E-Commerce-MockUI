import * as React from "react";

/**
 * Store page text with light formatting, rendered as React elements (never as HTML), so a merchant's text can't
 * inject markup. Supported: "## Heading", "### Subheading", "- list item", blank line between paragraphs,
 * **bold** and [link text](https://… or mailto:…).
 */
export type Block = { type: "h2" | "h3" | "p"; text: string } | { type: "ul"; items: string[] };

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join("\n") });
    if (list) blocks.push({ type: "ul", items: list });
    para = [];
    list = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (h) { flush(); blocks.push({ type: h[1].length === 2 ? "h2" : "h3", text: h[2] }); continue; }
    const li = /^[-*]\s+(.+)$/.exec(line.trim());
    if (li) {
      if (para.length) { blocks.push({ type: "p", text: para.join("\n") }); para = []; }
      (list ??= []).push(li[1]);
      continue;
    }
    if (list) { blocks.push({ type: "ul", items: list }); list = null; }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;

export function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(...withBreaks(text.slice(last, m.index), key++));
    if (m[1] !== undefined) out.push(<strong key={`b${key++}`} className="font-semibold text-fg">{m[1]}</strong>);
    else out.push(<a key={`a${key++}`} href={m[3]} className="underline underline-offset-4 hover:text-brand" rel="noopener noreferrer"
      target={m[3].startsWith("http") ? "_blank" : undefined}>{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...withBreaks(text.slice(last), key++));
  return out;
}

function withBreaks(text: string, key: number): React.ReactNode[] {
  return text.split("\n").flatMap((part, i) => (i === 0 ? [part] : [<br key={`br${key}-${i}`} />, part]));
}

export function RichText({ source }: { source: string }) {
  return (
    <div className="space-y-5 text-[15px] leading-relaxed text-fg-muted">
      {parseBlocks(source).map((b, i) =>
        b.type === "h2" ? <h2 key={i} className="pt-4 font-display text-2xl text-fg">{inline(b.text)}</h2>
        : b.type === "h3" ? <h3 key={i} className="pt-2 text-base font-semibold text-fg">{inline(b.text)}</h3>
        : b.type === "ul" ? <ul key={i} className="list-disc space-y-1.5 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
        : <p key={i}>{inline(b.text)}</p>,
      )}
    </div>
  );
}
