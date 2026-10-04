"use client";

import type { TokenEntryKind } from "@hexmark/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Checkbox } from "@/components/checkbox/Checkbox";
import type { PickerFolder, PickerNote, PickerTree } from "@/lib/api-tokens/tree";
import access from "./Access.module.css";
import styles from "./Tokens.module.css";

export interface PickedTarget {
  kind: TokenEntryKind;
  id: string;
  path: string;
}

export interface TargetTreeProps {
  id: string;
  legend: string;
  hint: string;
  tree: PickerTree;
  // "folder:<id>" and "note:<id>" of the chosen targets.
  selected: ReadonlySet<string>;
  onToggle(target: PickedTarget, on: boolean): void;
  // Loads a folder's contents that were not loaded yet.
  onLoad(folderId: string): Promise<void>;
}

export const targetKey = (kind: TokenEntryKind, id: string) => `${kind}:${id}`;

interface NodeProps extends Omit<TargetTreeProps, "id" | "legend" | "hint" | "tree"> {
  expanded: ReadonlySet<string>;
  loading: ReadonlySet<string>;
  onExpand(folder: PickerFolder): void;
}

function NoteNode({ note, ...props }: NodeProps & { note: PickerNote }) {
  const t = useTranslations("tokens.form.access.tree");
  return (
    <li className={access.treeItem}>
      <span className={access.treeSpacer} aria-hidden="true" />
      <Checkbox
        label={
          <span className={styles.folderPath}>
            <span className="visually-hidden">{t("note")} </span>
            {note.title}
          </span>
        }
        checked={props.selected.has(targetKey("note", note.id))}
        onChange={(event) =>
          props.onToggle(
            { kind: "note", id: note.id, path: note.path },
            event.currentTarget.checked,
          )
        }
      />
    </li>
  );
}

function FolderNode({ folder, ...props }: NodeProps & { folder: PickerFolder }) {
  const t = useTranslations("tokens.form.access.tree");
  const open = props.expanded.has(folder.id);
  const listId = `tree-${folder.id}`;
  const empty = folder.loaded && folder.folders.length === 0 && folder.notes.length === 0;
  return (
    <li className={access.treeItem}>
      {empty ? (
        <span className={access.treeSpacer} aria-hidden="true" />
      ) : (
        <button
          type="button"
          className={access.treeToggle}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => props.onExpand(folder)}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
          <span className="visually-hidden">
            {t(open ? "close" : "open", { name: folder.name })}
          </span>
        </button>
      )}
      <Checkbox
        label={
          <span className={styles.folderPath}>
            <span className="visually-hidden">{t("folder")} </span>
            {folder.name}
          </span>
        }
        checked={props.selected.has(targetKey("folder", folder.id))}
        onChange={(event) =>
          props.onToggle(
            { kind: "folder", id: folder.id, path: folder.path },
            event.currentTarget.checked,
          )
        }
      />
      {open ? (
        <ul id={listId} className={access.treeList}>
          {props.loading.has(folder.id) ? (
            <li className={styles.muted}>{t("loading")}</li>
          ) : (
            <>
              {folder.folders.map((child) => (
                <FolderNode key={child.id} folder={child} {...props} />
              ))}
              {folder.notes.map((note) => (
                <NoteNode key={note.id} note={note} {...props} />
              ))}
            </>
          )}
        </ul>
      ) : null}
    </li>
  );
}

// The wiki as a tree to pick targets from, at any depth: folders open and
// close with their button (loading what was not loaded yet), and every
// folder and note has its checkbox. Native buttons and checkboxes, so the
// keyboard works as everywhere; nothing moves outside the opened folder.
export function TargetTree(props: TargetTreeProps) {
  const t = useTranslations("tokens.form.access.tree");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState<ReadonlySet<string>>(new Set());
  const change = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  async function onExpand(folder: PickerFolder) {
    const open = !expanded.has(folder.id);
    setExpanded((current) => change(current, folder.id, open));
    if (!open || folder.loaded) return;
    setLoading((current) => change(current, folder.id, true));
    await props.onLoad(folder.id);
    setLoading((current) => change(current, folder.id, false));
  }
  const node = { ...props, expanded, loading, onExpand };
  const { tree } = props;
  return (
    <fieldset id={props.id} className={styles.group} aria-describedby={`${props.id}-hint`}>
      <legend className={styles.legend}>{props.legend}</legend>
      <p id={`${props.id}-hint`} className={styles.muted}>
        {props.hint}
      </p>
      {tree.folders.length + tree.notes.length === 0 ? (
        <p className={styles.muted}>{t("empty")}</p>
      ) : (
        <ul className={access.tree}>
          {tree.folders.map((folder) => (
            <FolderNode key={folder.id} folder={folder} {...node} />
          ))}
          {tree.notes.map((note) => (
            <NoteNode key={note.id} note={note} {...node} />
          ))}
        </ul>
      )}
    </fieldset>
  );
}
