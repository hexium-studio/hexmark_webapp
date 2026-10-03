"use client";

import {
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from "react";
import {
  acceptedChars,
  type CodeRules,
  type CodeValue,
  clearCell,
  insertChars,
  keyCommand,
  typedText,
} from "./code-model";

interface Options {
  value: CodeValue;
  onValueChange(next: string[]): void;
  rules: CodeRules;
  masked: boolean;
}

interface Draft {
  index: number;
  text: string;
}

// Event handling of the cells. The real characters live only in `value`
// (React state of the caller). A masked cell renders an empty input; the
// asterisk is drawn next to it (CodeInput.tsx), so it never becomes the
// input's value and screen readers never read it out.
export function useCodeCells({ value, onValueChange, rules, masked }: Options) {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // Text an input method (IME) is still composing. The input must show it
  // until the composition ends, or the browser cancels the composition.
  const [draft, setDraft] = useState<Draft | null>(null);
  const composingIndex = useRef<number | null>(null);
  const last = value.length - 1;

  function focusCell(index: number) {
    inputs.current[Math.min(Math.max(index, 0), last)]?.focus();
  }

  // What the input element itself holds: never the real character while masked.
  function shownValue(index: number): string {
    if (draft?.index === index) return draft.text;
    return masked ? "" : (value[index] ?? "");
  }

  // Returns false when nothing in `text` is accepted; the cell then keeps
  // its character and React restores the input to the controlled value.
  function insertText(index: number, text: string): boolean {
    const chars = acceptedChars(text, rules);
    if (chars.length === 0) return false;
    const result = insertChars(value, index, chars);
    onValueChange(result.code);
    focusCell(result.focusIndex);
    return true;
  }

  function onChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.value;
    if (composingIndex.current === index) {
      setDraft({ index, text: next });
      return;
    }
    // Deleted without a Backspace key event (cut, some touch keyboards).
    if (next === "") {
      onValueChange(clearCell(value, index));
      return;
    }
    // One typed character, or several from autofill or drag and drop.
    insertText(index, typedText(shownValue(index), next));
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    // Leave shortcuts (selection, Cmd+Backspace, ...) to the browser.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const command = keyCommand(value, index, event.key, rules, masked);
    if (!command) return;
    event.preventDefault();
    if (command.code) onValueChange(command.code);
    if (command.focus !== undefined) focusCell(command.focus);
  }

  function onPaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    insertText(index, event.clipboardData.getData("text"));
  }

  function onCompositionStart(index: number) {
    composingIndex.current = index;
    setDraft({ index, text: shownValue(index) });
  }

  function onCompositionEnd(index: number, event: CompositionEvent<HTMLInputElement>) {
    composingIndex.current = null;
    setDraft(null);
    insertText(index, event.data);
  }

  return {
    inputs,
    draftIndex: draft?.index,
    focusCell,
    shownValue,
    handlers: { onChange, onKeyDown, onPaste, onCompositionStart, onCompositionEnd },
  };
}
