import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';

const extensionPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3');

interface WorkerFixtures {
  /**
   * Stands in for https://old.reddit.com/login/, where old.reddit.com redirects signed-out users.
   * Playwright never routes the request a redirect leads to (it lets the browser continue it), so
   * that request needs a real server.
   */
  loginServer: { port: number };
}

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures, WorkerFixtures>({
  loginServer: [
    // Playwright requires the object pattern even when a fixture has no dependencies.
    async ({}, use) => {
      const { key, cert } = selfSignedCertificate('old.reddit.com');
      const server = https.createServer({ key, cert }, (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Log in to Reddit</title>');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('No login server port');
      await use({ port: address.port });
      await new Promise((resolve) => server.close(resolve));
    },
    { scope: 'worker' },
  ],

  // Extensions need a persistent context. The bundled Chromium (`channel: 'chromium'`) still
  // honours `--load-extension` and runs extensions in headless mode; branded Chrome does not.
  context: async ({ loginServer }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // Tests answer requests with `context.route`. Anything that gets past the routes fails to
        // resolve instead of reaching the real network, except old.reddit.com's login page.
        `--host-resolver-rules=MAP old.reddit.com 127.0.0.1:${loginServer.port}, MAP * ~NOTFOUND`,
        // For the login server's self-signed certificate. Playwright's `ignoreHTTPSErrors` does not
        // cover the extension service worker's requests.
        '--ignore-certificate-errors',
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;

/** A throwaway key pair and certificate for `host`, made with the openssl command line tool. */
function selfSignedCertificate(host: string): { key: string; cert: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-on-e2e-'));
  try {
    const keyFile = path.join(dir, 'key.pem');
    const certFile = path.join(dir, 'cert.pem');
    execFileSync(
      'openssl',
      [
        ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2'],
        ['-subj', `/CN=${host}`, '-keyout', keyFile, '-out', certFile],
      ].flat(),
      { stdio: 'ignore' },
    );
    return { key: fs.readFileSync(keyFile, 'utf8'), cert: fs.readFileSync(certFile, 'utf8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
