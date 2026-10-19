// Matches `Related: [[Name]]`, `Related: [[Name|alias]]`, `Related: [[Name#h]]`.
const RELATED_RE = /^Related:\s*\[\[([^\]|#]+)/;

// Splitting with a capture group keeps each line's own separator in the array.
const SEP_RE = /(\r\n|\n|\r)/;

export interface RelatedResult {
	content: string;
	added: string[];
	hasFrontmatter: boolean;
}

export function insertRelatedLines(content: string, names: string[]): RelatedResult {
	const unchanged: RelatedResult = { content, added: [], hasFrontmatter: false };
	// Even indexes hold line text, odd indexes hold the separator that follows it.
	const parts = content.split(SEP_RE);
	const lineCount = Math.ceil(parts.length / 2);
	const line = (i: number): string => parts[i * 2] ?? '';

	if (line(0).replace(/^\uFEFF/, '').trim() !== '---') return unchanged;

	let close = -1;
	for (let i = 1; i < lineCount; i++) {
		if (line(i).trim() === '---') {
			close = i;
			break;
		}
	}
	if (close === -1) return unchanged;

	const linked = new Set<string>();
	for (let i = 0; i < lineCount; i++) {
		const m = RELATED_RE.exec(line(i));
		if (m && m[1]) linked.add(m[1].trim().toLowerCase());
	}

	const added: string[] = [];
	for (const name of names) {
		const key = name.trim().toLowerCase();
		if (!key || linked.has(key)) continue;
		linked.add(key);
		added.push(name.trim());
	}
	if (added.length === 0) return { content, added, hasFrontmatter: true };

	let anchor = close;
	while (anchor + 1 < lineCount && RELATED_RE.test(line(anchor + 1))) anchor++;

	// The anchor (closing fence or last Related line) supplies the separator for new lines.
	// Only the final line of a file has no separator; then the anchor gains '\n' and the
	// last inserted line stays separator-free, so the file still ends as it did.
	const atEof = anchor * 2 + 1 >= parts.length;
	const sep = (!atEof && parts[anchor * 2 + 1]) || '\n';
	const pairs: string[] = [];
	added.forEach((n, i) => {
		const lastAtEof = atEof && i === added.length - 1;
		pairs.push(`Related: [[${n}]]`, lastAtEof ? '' : sep);
	});
	if (atEof) parts.push(sep);
	parts.splice(anchor * 2 + 2, 0, ...pairs);
	return { content: parts.join(''), added, hasFrontmatter: true };
}
