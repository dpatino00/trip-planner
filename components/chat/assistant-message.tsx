import type { ReactNode } from "react";

const orderedItemPattern = /^\s*\d+[.)]\s+(.+)$/;
const unorderedItemPattern = /^\s*[-*•]\s+(.+)$/;
const markdownLinkPattern = /\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  markdownLinkPattern.lastIndex = 0;
  while ((match = markdownLinkPattern.exec(value)) !== null) {
    if (match.index > cursor) {
      nodes.push(value.slice(cursor, match.index));
    }
    nodes.push(
      <a
        key={`${keyPrefix}-link-${index}`}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer"
      >
        {match[1]}
      </a>,
    );
    cursor = match.index + match[0].length;
    index += 1;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

interface NarrativeBlock {
  kind: "paragraph" | "ordered" | "unordered";
  lines: string[];
}

function splitBlocks(value: string): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];
  let current: NarrativeBlock | null = null;

  const flush = () => {
    if (current?.lines.length) blocks.push(current);
    current = null;
  };

  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) {
      flush();
      continue;
    }

    const ordered = line.match(orderedItemPattern);
    const unordered = line.match(unorderedItemPattern);
    if (ordered || unordered) {
      const kind = ordered ? "ordered" : "unordered";
      if ((current as NarrativeBlock | null)?.kind !== kind) {
        flush();
        current = { kind, lines: [] };
      }
      current?.lines.push((ordered ?? unordered)?.[1] ?? "");
      continue;
    }

    if (current?.kind !== "paragraph") {
      flush();
      current = { kind: "paragraph", lines: [] };
    }
    current.lines.push(line);
  }
  flush();
  return blocks;
}

// @spec CHAT-UI-011
export function AssistantMessage({ content }: { content: string }) {
  return (
    <div className="assistant-narrative">
      {splitBlocks(content).map((block, blockIndex) => {
        if (block.kind === "ordered" || block.kind === "unordered") {
          const List = block.kind === "ordered" ? "ol" : "ul";
          return (
            <List key={`block-${blockIndex}`}>
              {block.lines.map((line, lineIndex) => (
                <li key={`item-${lineIndex}`}>
                  {renderInline(line, `block-${blockIndex}-item-${lineIndex}`)}
                </li>
              ))}
            </List>
          );
        }

        return (
          <p key={`block-${blockIndex}`}>
            {block.lines.map((line, lineIndex) => (
              <span key={`line-${lineIndex}`}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, `block-${blockIndex}-line-${lineIndex}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
