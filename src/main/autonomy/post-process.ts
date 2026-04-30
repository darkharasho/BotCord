const MAX = 2000;

export function postProcess(raw: string): string | null {
  let text = raw
    .replace(/@everyone/g, '')
    .replace(/@here/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (text.length === 0) return null;

  if (text.length > MAX) {
    const head = text.slice(0, MAX);
    const m = head.match(/[.!?](?=\s|$)(?!.*[.!?](?=\s|$))/s);
    if (m && m.index !== undefined) {
      text = head.slice(0, m.index + 1);
    } else {
      text = head;
    }
  }
  return text;
}
