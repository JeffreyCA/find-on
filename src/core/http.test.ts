import { describe, expect, it } from 'vitest';
import { classifyResponse, type HttpOutcome } from './http';
import { fixtureText, html, json, oldRedditLoginWall, wwwRedditBlocked } from './test-utils';

const NOW = 1_760_000_000_000;

function kind(o: HttpOutcome) {
  return o.kind;
}

describe('classifyResponse', () => {
  it('parses OK JSON and reads the rate-limit headers', async () => {
    const res = json({ data: { children: [] } }, 200, {
      'x-ratelimit-remaining': '99.0',
      'x-ratelimit-used': '1',
      'x-ratelimit-reset': '296',
    });
    expect(await classifyResponse(res, NOW)).toEqual({
      kind: 'ok',
      data: { data: { children: [] } },
      meta: {
        status: 200,
        contentType: 'application/json; charset=UTF-8',
        rate: { remaining: 99, resetAt: NOW + 296_000 },
      },
    });
  });

  it('maps a followed redirect to /login to a login wall', async () => {
    expect(kind(await classifyResponse(oldRedditLoginWall(), NOW))).toBe('login');
  });

  it('maps the 403 block page to an HTTP error, not a sign-in wall', async () => {
    expect(kind(await classifyResponse(wwwRedditBlocked(), NOW))).toBe('http');
  });

  it('recognizes the human-verification page, whatever its status', async () => {
    const page = fixtureText('reddit-challenge.html');
    expect(kind(await classifyResponse(html(page), NOW))).toBe('challenge');
    expect(kind(await classifyResponse(html(page, 403), NOW))).toBe('challenge');
  });

  it('takes the retry time of a 429 from x-ratelimit-reset, else 60 s', async () => {
    const withReset = new Response('', { status: 429, headers: { 'x-ratelimit-reset': '40' } });
    expect(await classifyResponse(withReset, NOW)).toMatchObject({
      kind: 'rate-limited',
      retryAt: NOW + 40_000,
    });
    const bare = new Response('Too Many Requests', { status: 429 });
    expect(await classifyResponse(bare, NOW)).toMatchObject({ retryAt: NOW + 60_000 });
  });

  it('never parses anything but OK JSON', async () => {
    expect(kind(await classifyResponse(html('<p>Service Unavailable</p>', 503), NOW))).toBe('http');
    expect(kind(await classifyResponse(json({ message: 'Not Found' }, 404), NOW))).toBe('http');
    expect(kind(await classifyResponse(html('<p>hello</p>'), NOW))).toBe('format');
    const broken = new Response('{"data":', { headers: { 'content-type': 'application/json' } });
    expect(await classifyResponse(broken, NOW)).toMatchObject({
      kind: 'format',
      detail: 'invalid JSON',
    });
  });
});
