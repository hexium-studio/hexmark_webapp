import { type MessageFormatElement, parse, TYPE } from "@formatjs/icu-messageformat-parser";

// What a message expects from the code that formats it: its placeholders and
// tags, and the options of its select and plural arguments. Used by
// translation-check.ts to compare a translation with the English text.

export type ArgumentKind =
  | "text"
  | "number"
  | "date"
  | "time"
  | "plural"
  | "selectordinal"
  | "select"
  | "tag";

export interface Signature {
  // Placeholders and tags by name ("<code>" for tags).
  kinds: Map<string, ArgumentKind>;
  // Option keys of each select argument.
  selectOptions: Map<string, Set<string>>;
  // Plural options that are no plural category, e.g. "several".
  badPluralOptions: string[];
}

const PLURAL_OPTION = /^(zero|one|two|few|many|other|=\d+)$/;

// Throws the parser's SyntaxError for an invalid message.
export function readSignature(message: string): Signature {
  return signature(parse(message));
}

// Languages differ in what they need: a plain {count} in English may be a
// plural elsewhere (and the other way round), a plain {name} may become a
// select. What cannot work is a value used as another kind of value (a
// number as a date, a select as a plural) or a tag as a placeholder.
const KIND_GROUP: Record<ArgumentKind, string> = {
  text: "text",
  number: "numeric",
  plural: "numeric",
  selectordinal: "numeric",
  date: "datetime",
  time: "datetime",
  select: "select",
  tag: "tag",
};

export function compatible(wanted: ArgumentKind, found: ArgumentKind): boolean {
  const [a, b] = [KIND_GROUP[wanted], KIND_GROUP[found]];
  if (a === b) return true;
  return (a === "text" || b === "text") && a !== "tag" && b !== "tag";
}

function signature(elements: MessageFormatElement[]): Signature {
  const result: Signature = { kinds: new Map(), selectOptions: new Map(), badPluralOptions: [] };
  collect(elements, result);
  return result;
}

function collect(elements: MessageFormatElement[], into: Signature) {
  for (const element of elements) {
    switch (element.type) {
      case TYPE.argument:
        into.kinds.set(element.value, "text");
        break;
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        into.kinds.set(element.value, TYPE[element.type] as ArgumentKind);
        break;
      case TYPE.tag:
        into.kinds.set(`<${element.value}>`, "tag");
        collect(element.children, into);
        break;
      case TYPE.select:
        into.kinds.set(element.value, "select");
        into.selectOptions.set(element.value, new Set(Object.keys(element.options)));
        for (const option of Object.values(element.options)) collect(option.value, into);
        break;
      case TYPE.plural:
        into.kinds.set(
          element.value,
          element.pluralType === "ordinal" ? "selectordinal" : "plural",
        );
        for (const [name, option] of Object.entries(element.options)) {
          if (!PLURAL_OPTION.test(name)) into.badPluralOptions.push(name);
          collect(option.value, into);
        }
        break;
      default:
        break;
    }
  }
}
