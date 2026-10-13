/** Removes a trailing "## Sources" section (the server appends one); only when it is the last section. */
export function stripSourcesSection(markdown: string): string {
  const heading = /(^|\n)##[ \t]+Sources[ \t]*(?=\n|$)/g;
  let last: RegExpExecArray | null = null;
  for (let m = heading.exec(markdown); m; m = heading.exec(markdown)) last = m;
  if (!last) return markdown;
  const after = markdown.slice(last.index + last[0].length);
  if (/\n##[ \t]+\S/.test(after)) return markdown; // another section follows
  return markdown.slice(0, last.index).trimEnd();
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
