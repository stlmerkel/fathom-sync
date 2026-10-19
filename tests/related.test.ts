import { describe, expect, it } from 'vitest';
import { insertRelatedLines } from '../src/attendees/related';

const NOTE = ['---', 'vault: cursus-opus', 'type: meeting', '---', '', '## Summary', 'Body'].join('\n');

describe('insertRelatedLines', () => {
	it('inserts directly after the closing frontmatter fence', () => {
		const r = insertRelatedLines(NOTE, ['Sara Bronson', 'Princess Baehler']);
		expect(r.hasFrontmatter).toBe(true);
		expect(r.added).toEqual(['Sara Bronson', 'Princess Baehler']);
		expect(r.content.split('\n').slice(3, 6)).toEqual([
			'---',
			'Related: [[Sara Bronson]]',
			'Related: [[Princess Baehler]]',
		]);
	});

	it('appends after existing Related lines and skips names already linked', () => {
		const existing = NOTE.replace('---\n\n', '---\nRelated: [[Josh Tepen]]\n\n');
		const r = insertRelatedLines(existing, ['josh tepen', 'Scott Obermeyer']);
		expect(r.added).toEqual(['Scott Obermeyer']);
		expect(r.content.split('\n').slice(3, 6)).toEqual([
			'---',
			'Related: [[Josh Tepen]]',
			'Related: [[Scott Obermeyer]]',
		]);
	});

	it('recognises aliased links as already present', () => {
		const existing = NOTE.replace('---\n\n', '---\nRelated: [[Josh Tepen|Josh]]\n\n');
		expect(insertRelatedLines(existing, ['Josh Tepen']).added).toEqual([]);
	});

	it('is idempotent', () => {
		const once = insertRelatedLines(NOTE, ['Sara Bronson']).content;
		const twice = insertRelatedLines(once, ['Sara Bronson']);
		expect(twice.added).toEqual([]);
		expect(twice.content).toBe(once);
	});

	it('dedupes names within one call', () => {
		expect(insertRelatedLines(NOTE, ['Sara Bronson', 'Sara Bronson']).added).toEqual(['Sara Bronson']);
	});

	it('leaves a note without frontmatter unchanged and reports it', () => {
		const plain = '# Old meeting\nRelated text';
		const r = insertRelatedLines(plain, ['Sara Bronson']);
		expect(r).toEqual({ content: plain, added: [], hasFrontmatter: false });
	});

	it('leaves a note with an unclosed frontmatter fence unchanged', () => {
		const broken = '---\nvault: cursus-opus\n## Summary';
		expect(insertRelatedLines(broken, ['A B']).hasFrontmatter).toBe(false);
	});

	// Review Focus 3
	it('keeps CRLF line endings', () => {
		const crlf = NOTE.split('\n').join('\r\n');
		const r = insertRelatedLines(crlf, ['Sara Bronson']);
		expect(r.content).toContain('---\r\nRelated: [[Sara Bronson]]\r\n');
		expect(r.content.includes('\n') && !/[^\r]\n/.test(r.content)).toBe(true);
	});

	it('handles a BOM before the opening fence', () => {
		const bom = '\uFEFF' + NOTE;
		const r = insertRelatedLines(bom, ['Sara Bronson']);
		expect(r.hasFrontmatter).toBe(true);
		expect(r.content.startsWith('\uFEFF---')).toBe(true);
		expect(r.added).toEqual(['Sara Bronson']);
	});

	// Review fix 1: mixed endings must survive byte-for-byte.
	it('keeps every original line ending when a note mixes LF and CRLF', () => {
		const mixed = '---\nvault: cursus-opus\r\ntype: meeting\n---\r\n\n## Summary\r\nBody\nEnd';
		const r = insertRelatedLines(mixed, ['Sara Bronson']);
		expect(r.added).toEqual(['Sara Bronson']);
		expect(r.content).toContain('---\r\nRelated: [[Sara Bronson]]\r\n\n## Summary');
		const restored = r.content.replace(/Related: \[\[Sara Bronson\]\](\r\n|\n|\r)/, '');
		expect(restored).toBe(mixed);
	});
});
