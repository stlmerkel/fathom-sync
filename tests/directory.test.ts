import { describe, expect, it } from 'vitest';
import { decodeEntities, parseCsv, parseDirectory } from '../src/attendees/directory';

const HEADER = '"ID","firstName","lastName","jobTitle","email","phone","departmentDesc1","HR_EffectiveTerminationDate"';

describe('parseCsv', () => {
	it('handles quoted fields, embedded commas and doubled quotes', () => {
		expect(parseCsv('a,"b, c","say ""hi"""\n1,2,3')).toEqual([
			['a', 'b, c', 'say "hi"'],
			['1', '2', '3'],
		]);
	});
	it('handles CRLF and a trailing newline', () => {
		expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
	});
});

describe('decodeEntities', () => {
	it('decodes the entities the directory export uses', () => {
		expect(decodeEntities('Center for Teaching &amp; Learning')).toBe('Center for Teaching & Learning');
		expect(decodeEntities('&lt;x&gt; &quot;y&quot; &#39;z&#39;')).toBe(`<x> "y" 'z'`);
	});
});

describe('parseDirectory', () => {
	it('maps rows by normalised email', () => {
		const csv = [
			HEADER,
			'"1",Mary Ellen,Finch,Senior Associate,MFinch@maryville.edu,"314.529.9400",Center for Teaching &amp; Learning,""',
		].join('\n');
		const dir = parseDirectory(csv);
		expect(dir.get('mfinch@maryville.edu')).toEqual({
			firstName: 'Mary Ellen',
			lastName: 'Finch',
			email: 'mfinch@maryville.edu',
			jobTitle: 'Senior Associate',
			department: 'Center for Teaching & Learning',
			phone: '314.529.9400',
			terminated: false,
		});
	});
	it('marks a row with a termination date as terminated', () => {
		const csv = [HEADER, '"2",Old,Timer,Clerk,old@maryville.edu,"","Admin","2020-05-01"'].join('\n');
		expect(parseDirectory(csv).get('old@maryville.edu')?.terminated).toBe(true);
	});
	it('prefers a current row over a terminated one for the same email', () => {
		const csv = [
			HEADER,
			'"3",Pat,Lee,Old Title,pat@maryville.edu,"","A","2019-01-01"',
			'"4",Pat,Lee,New Title,pat@maryville.edu,"","B",""',
		].join('\n');
		expect(parseDirectory(csv).get('pat@maryville.edu')?.jobTitle).toBe('New Title');
	});
	it('skips rows without an email and strips a BOM', () => {
		const csv = '\uFEFF' + [HEADER, '"5",No,Email,Title,,"","X",""'].join('\n');
		expect(parseDirectory(csv).size).toBe(0);
	});
	it('strips BOM before email column header', () => {
		const csv = '\uFEFFemail,firstName\na@x.edu,A';
		expect(parseDirectory(csv).get('a@x.edu')?.firstName).toBe('A');
	});
	it('returns an empty map when the email column is missing', () => {
		expect(parseDirectory('"firstName","lastName"\nA,B').size).toBe(0);
	});
});

// Review F5: a half-synced export must not become trusted directory data.
describe('malformed directory CSV', () => {
	it('parseCsv rejects an unterminated quoted field', () => {
		expect(() => parseCsv('a,b\n1,"open')).toThrow(/unterminated/i);
	});
	it('parseDirectory rejects a file cut off inside a quoted field', () => {
		expect(() => parseDirectory('email,firstName,lastName\npat@uni.edu,"Pat,Lee')).toThrow();
	});
	it('parseDirectory rejects a data row whose field count differs from the header', () => {
		const csv = ['email,firstName,lastName', 'a@x.edu,A,One', 'b@x.edu,B'].join('\n');
		expect(() => parseDirectory(csv)).toThrow(/row 3/);
	});
});
