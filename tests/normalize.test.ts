import { describe, expect, it } from 'vitest';
import { domainFromWebsite, domainOf, normalizeEmail } from '../src/attendees/normalize';

describe('normalizeEmail', () => {
	it('trims and lowercases', () => {
		expect(normalizeEmail('  SBronson@Maryville.EDU ')).toBe('sbronson@maryville.edu');
	});
	it('strips surrounding quotes left by YAML', () => {
		expect(normalizeEmail("'sbronson@maryville.edu'")).toBe('sbronson@maryville.edu');
		expect(normalizeEmail('"sbronson@maryville.edu"')).toBe('sbronson@maryville.edu');
	});
	it('strips NBSP, zero-width characters and a BOM that trim() leaves behind', () => {
		expect(normalizeEmail('﻿sbronson@maryville.edu ')).toBe('sbronson@maryville.edu');
		expect(normalizeEmail('sbron​son@maryville.edu')).toBe('sbronson@maryville.edu');
	});
	it('returns empty for non-strings, blanks and non-emails', () => {
		expect(normalizeEmail(undefined)).toBe('');
		expect(normalizeEmail(null)).toBe('');
		expect(normalizeEmail(42)).toBe('');
		expect(normalizeEmail(['a@b.com'])).toBe('');
		expect(normalizeEmail('')).toBe('');
		expect(normalizeEmail('Sara Bronson')).toBe('');
	});
});

describe('domainOf', () => {
	it('returns the part after the last @', () => {
		expect(domainOf('mohammad.haque@propeller.cloud')).toBe('propeller.cloud');
	});
	it('returns empty when there is no @', () => {
		expect(domainOf('nobody')).toBe('');
	});
});

describe('domainFromWebsite', () => {
	it.each([
		['www.capacity.com', 'capacity.com'],
		["'burstiq.com'", 'burstiq.com'],
		['https://www.1edtech.org/', '1edtech.org'],
		['adobe.com', 'adobe.com'],
		['http://Example.com/path?q=1', 'example.com'],
	])('%s → %s', (input, expected) => {
		expect(domainFromWebsite(input)).toBe(expected);
	});
	it('returns empty for non-strings and blanks', () => {
		expect(domainFromWebsite(undefined)).toBe('');
		expect(domainFromWebsite('')).toBe('');
	});
});
