import type { TreeFolder } from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";

// The folders a token can be limited to, from GET /api/notes/v1/tree, as one
// list ordered by path ("Projects", "Projects/Web", …). Pure.

export interface FolderChoice {
  id: string;
  name: string;
  path: string;
  // 0 for the root level, for indenting the list.
  depth: number;
}

// `value` is a folders list; undefined where the listing's depth ended
// (loaded: false), which holds no further folders to offer.
function collect(value: unknown, depth: number, into: FolderChoice[]): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) return false;
    const { id, name, path } = entry as Partial<TreeFolder>;
    if (typeof id !== "string" || typeof name !== "string" || typeof path !== "string") {
      return false;
    }
    into.push({ id, name, path, depth });
    if (!collect(entry.folders, depth + 1, into)) return false;
  }
  return true;
}

// Undefined when the answer does not have the expected shape.
export function readFolderChoices(body: unknown): FolderChoice[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.folders)) return undefined;
  const list: FolderChoice[] = [];
  if (!collect(body.folders, 0, list)) return undefined;
  return list.sort((a, b) => a.path.localeCompare(b.path));
}
