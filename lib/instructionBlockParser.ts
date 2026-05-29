/**
 * Mirror of web app's lib/instruction-block-parser.ts.
 * Keep in sync when either side changes.
 *
 * Parses a notes_only block of free text into a structured list so renderers
 * can display it as sections + bullets instead of a wall-of-text paragraph.
 */

export interface InstructionSection {
  header?: string;
  items: string[];
}

export interface ParsedInstruction {
  sections: InstructionSection[];
  callouts: string[];
}

const HEADER_RE = /^([A-Z][A-Z0-9 /+&\-]*?(?:\s*\([^)]+\))?)\s*:\s*([\s\S]*)$/;
const SECTION_SPLIT_RE = /\.\s+(?=[A-Z][A-Z0-9 /+&\-]*(?:\s*\([^)]+\))?\s*:)/;

export function parseInstructionBlock(text: string | null | undefined): ParsedInstruction {
  if (!text) return { sections: [], callouts: [] };
  const raw = String(text).trim();
  if (!raw) return { sections: [], callouts: [] };

  const callouts: string[] = [];
  const stripped = raw
    .replace(/\[([^\]]+)\]/g, (_, content) => {
      callouts.push(String(content).trim());
      return '';
    })
    .replace(/\s+/g, ' ')
    .replace(/\s*\.\s*\./g, '.')
    .trim();

  if (!stripped) {
    return { sections: callouts.length ? [] : [{ items: [raw] }], callouts };
  }

  if (raw.includes('\n')) {
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { sections: [{ items: lines }], callouts };
  }

  const blocks = stripped.split(SECTION_SPLIT_RE).map((s) => s.trim()).filter(Boolean);

  const sections: InstructionSection[] = [];
  for (const block of blocks) {
    const headerMatch = block.match(HEADER_RE);
    let header: string | undefined;
    let body: string;
    if (headerMatch) {
      header = headerMatch[1].trim();
      body = headerMatch[2].trim();
    } else {
      body = block.trim();
    }

    body = body.replace(/[.;]\s*$/, '').trim();

    const items = body
      .split(/;\s*/)
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    if (items.length === 0 && !header) continue;
    sections.push({ header, items: items.length > 0 ? items : [body] });
  }

  if (sections.length === 0) {
    return { sections: [{ items: [stripped] }], callouts };
  }

  return { sections, callouts };
}
