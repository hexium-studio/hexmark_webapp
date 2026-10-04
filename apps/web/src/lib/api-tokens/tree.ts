import type { TreeFolder, TreeNote } from "@hexmark/shared";
import { isRecord } from "@/lib/api-fields";

// The wiki's folders and notes a token's targets are picked from, read from
// GET /api/notes/v1/tree. A folder where the listing's depth ended is not
// loaded yet (loaded: false); the page loads it when it is opened. Pure.

export interface PickerNote {
  id: string;
  title: string;
  path: string;
}

export interface PickerFolder {
  id: string;
  name: string;
  path: string;
  loaded: boolean;
  folders: PickerFolder[];
  notes: PickerNote[];
}

export interface PickerTree {
  folders: PickerFolder[];
  notes: PickerNote[];
}

const isString = (value: unknown): value is string => typeof value === "string";

function joinPath(folderPath: string, name: string): string {
  return folderPath ? `${folderPath}/${name}` : name;
}

function readNotes(value: unknown, folderPath: string): PickerNote[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const notes: PickerNote[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) return undefined;
    const { id, title } = entry as Partial<TreeNote>;
    if (!isString(id) || !isString(title)) return undefined;
    notes.push({ id, title, path: joinPath(folderPath, title) });
  }
  return notes;
}

function readFolders(value: unknown): PickerFolder[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const folders: PickerFolder[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry)) return undefined;
    const { id, name, path, loaded } = entry as Partial<TreeFolder>;
    if (!isString(id) || !isString(name) || !isString(path)) return undefined;
    const children = readFolders(entry.folders);
    const notes = readNotes(entry.notes, path);
    if (!children || !notes) return undefined;
    folders.push({ id, name, path, loaded: loaded === true, folders: children, notes });
  }
  return folders;
}

// The root level (or a folder's contents); undefined when the answer does
// not have the expected shape.
export function readPickerTree(body: unknown): PickerTree | undefined {
  if (!isRecord(body)) return undefined;
  const folderPath = isRecord(body.folder) && isString(body.folder.path) ? body.folder.path : "";
  const folders = readFolders(body.folders);
  const notes = readNotes(body.notes, folderPath);
  return folders && notes ? { folders, notes } : undefined;
}

// The tree with `folderId`'s contents filled in from a later listing.
export function withLoadedFolder(
  tree: PickerTree,
  folderId: string,
  contents: PickerTree,
): PickerTree {
  const fill = (folders: PickerFolder[]): PickerFolder[] =>
    folders.map((folder) =>
      folder.id === folderId
        ? { ...folder, loaded: true, folders: contents.folders, notes: contents.notes }
        : { ...folder, folders: fill(folder.folders) },
    );
  return { ...tree, folders: fill(tree.folders) };
}
