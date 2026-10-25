import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BLOCK_LIST,
  isAllowedByFilter,
  parsePatterns,
  type SiteFilter,
} from './site-filter';

const block = (lines: string[]): SiteFilter => ({ mode: 'block', block: lines, allow: [] });
const allow = (lines: string[]): SiteFilter => ({ mode: 'allow', block: [], allow: lines });

describe('parsePatterns', () => {
  it('normalizes hosts and paths and skips blanks and comments', () => {
    const { patterns, invalid } = parsePatterns([
      '# work',
      '',
      '  Example.COM  ',
      '*.corp.example.com',
      'www.news.example/Section/ # trailing comment',
      'https://mail.example.org/u/0/?tab=inbox',
      'docs.example.net/path/*',
      'bücher.example',
    ]);
    expect(invalid).toEqual([]);
    expect(patterns.map(({ host, path }) => `${host}${path}`)).toEqual([
      'example.com',
      'corp.example.com',
      'news.example/section',
      'mail.example.org/u/0',
      'docs.example.net/path',
      'xn--bcher-kva.example',
    ]);
  });

  it('flags lines that are not host patterns', () => {
    const { patterns, invalid } = parsePatterns([
      'localhost',
      'foo.*.com',
      'example.com:8080',
      'two words.com',
      '/path-only',
      'ok.example',
    ]);
    expect(patterns.map((p) => p.raw)).toEqual(['ok.example']);
    expect(invalid).toEqual([
      'localhost',
      'foo.*.com',
      'example.com:8080',
      'two words.com',
      '/path-only',
    ]);
  });

  it('accepts the default block list as valid', () => {
    expect(parsePatterns(DEFAULT_BLOCK_LIST).invalid).toEqual([]);
  });
});

describe('isAllowedByFilter', () => {
  it('blocks a host, its subdomains and path prefixes, case-insensitively', () => {
    const filter = block(['example.com', 'google.com/search']);
    expect(isAllowedByFilter('https://example.com/a', filter)).toBe(false);
    expect(isAllowedByFilter('https://WWW.Example.com./a', filter)).toBe(false);
    expect(isAllowedByFilter('https://notexample.com/', filter)).toBe(true);
    expect(isAllowedByFilter('https://www.google.com/search?q=x', filter)).toBe(false);
    expect(isAllowedByFilter('https://www.google.com/Search?q=x', filter)).toBe(false);
    expect(isAllowedByFilter('https://www.google.com/maps', filter)).toBe(true);
  });

  it('checks only listed sites in allow mode', () => {
    const filter = allow(['news.example.com']);
    expect(isAllowedByFilter('https://news.example.com/story/1', filter)).toBe(true);
    expect(isAllowedByFilter('https://example.com/', filter)).toBe(false);
    expect(isAllowedByFilter('https://example.com/', allow([]))).toBe(false);
  });

  it('applies the default block list', () => {
    const filter = block([...DEFAULT_BLOCK_LIST]);
    expect(isAllowedByFilter('https://mail.google.com/mail/u/0/#inbox', filter)).toBe(false);
    // "google.*/search" covers every Google domain, and nothing that only ends in "google".
    expect(isAllowedByFilter('https://www.google.co.uk/search?q=x', filter)).toBe(false);
    expect(isAllowedByFilter('https://google.de/search?q=x', filter)).toBe(false);
    expect(isAllowedByFilter('https://notgoogle.de/search?q=x', filter)).toBe(true);
    expect(isAllowedByFilter('https://google.evil.com/search?q=x', filter)).toBe(true);
    expect(isAllowedByFilter('https://discord.com/channels/1/2', filter)).toBe(false);
    expect(isAllowedByFilter('https://discord.com/blog', filter)).toBe(true);
    expect(isAllowedByFilter('https://xkcd.com/927/', filter)).toBe(true);
  });

  it('matches short names under any suffix, subdomains included', () => {
    const filter = block(['taz.*']);
    expect(isAllowedByFilter('https://taz.de/x', filter)).toBe(false);
    expect(isAllowedByFilter('https://www.taz.de/x', filter)).toBe(false);
    expect(isAllowedByFilter('https://taz.example.de/x', filter)).toBe(true);
  });

  it('never allows URLs it cannot parse', () => {
    expect(isAllowedByFilter('not a url', block([]))).toBe(false);
  });
});
