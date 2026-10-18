// Putting a piece of text (an emoji, a mention) into the message being typed. Pure; unit-tested.

/** Inserts `value` into `text` at the selection [start, end] and returns the new text and where the caret goes. */
export function insertAt(text: string, value: string, start: number, end: number) {
  const from = Math.max(0, Math.min(start, text.length)), to = Math.max(from, Math.min(end, text.length));
  return { text: text.slice(0, from) + value + text.slice(to), caret: from + value.length };
}
