import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/*
 * Every route is credentialed unless it is on the list below.
 *
 * SPEC.md §3.4: without a credential you see the join screen and nothing else —
 * not the roster, not photos, not standings. The gate itself is per-page rather
 * than middleware (lib/session.ts signs with node:crypto, which the edge
 * runtime does not have, and a middleware that only sniffs for a cookie is
 * satisfied by `kfless_session=anything`).
 *
 * The weakness of a per-page gate is forgetting a page, so this walks the route
 * tree instead of trusting anyone to remember. It is a static check — it reads
 * source, starts nothing, and needs no database.
 *
 * It lives in lib/ rather than beside the routes because `npm test` discovers
 * tests under lib/ and scripts/, and because it is about the app tree as a
 * whole rather than any one module.
 */

const appDir = fileURLToPath(new URL('../app', import.meta.url));

/** Pages that may render for someone with no credential, and why. */
const PUBLIC_PAGES: Record<string, string> = {
  'join/page.tsx': 'The join screen itself. Gating it would be a redirect loop.',
};

/** Route handlers that may answer without a credential, and why. */
const PUBLIC_ROUTES: Record<string, string> = {
  'api/health/route.ts':
    'Liveness probe. A host checks it before any cookie exists. Reports counts, never names.',
  'api/pulse/route.ts':
    'Returns the literal string "ok" and touches no database — it only answers whether the server is reachable.',
  'join/[token]/route.ts': 'The magic link. It is how you stop being anonymous.',
};

function walk(dir: string, filename: string, found: string[] = [], base = ''): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) walk(full, filename, found, rel);
    else if (entry === filename) found.push(rel);
  }
  return found;
}

/**
 * Source with comments removed.
 *
 * Searching raw source for `requireIdentity(` matched the sentence in
 * app/api/images explaining why it does NOT use requireIdentity, so deleting
 * that route's real check left the test green. A guard that reads prose as
 * proof is worse than no guard.
 */
function codeOf(rel: string): string {
  return readFileSync(join(appDir, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(rel: string): string {
  return readFileSync(join(appDir, rel), 'utf8');
}

describe('every page requires a credential (SPEC.md §3.4)', () => {
  const pages = walk(appDir, 'page.tsx');

  it('finds the route tree at all', () => {
    // Guards against the walk silently matching nothing and the suite passing
    // vacuously — the failure mode this whole file exists to prevent.
    assert.ok(pages.length >= 10, `expected to find the pages, found ${pages.length}`);
  });

  for (const page of pages) {
    const reason = PUBLIC_PAGES[page];

    it(reason ? `${page} is deliberately public` : `${page} calls requireIdentity()`, () => {
      const gated = codeOf(page).includes('requireIdentity(');

      if (reason) {
        assert.equal(
          gated,
          false,
          `${page} is on the public list but calls requireIdentity(). Remove it from the list.`,
        );
        return;
      }

      assert.ok(
        gated,
        `${page} renders without calling requireIdentity(). Either gate it, or add it to ` +
          'PUBLIC_PAGES with a reason it may be seen by someone with no credential.',
      );
    });
  }
});

describe('every route handler requires a credential (SPEC.md §3.4)', () => {
  const routes = walk(appDir, 'route.ts');

  it('finds the route handlers at all', () => {
    assert.ok(routes.length >= 3, `expected to find the handlers, found ${routes.length}`);
  });

  for (const route of routes) {
    const reason = PUBLIC_ROUTES[route];

    it(reason ? `${route} is deliberately public` : `${route} checks identity`, () => {
      const code = codeOf(route);
      const checks = code.includes('identify(') || code.includes('requireIdentity(');

      if (reason) {
        assert.equal(
          checks,
          false,
          `${route} is on the public list but checks identity. Remove it from the list.`,
        );
        return;
      }

      assert.ok(
        checks,
        `${route} answers without checking identity. Either check it, or add it to ` +
          'PUBLIC_ROUTES with a reason.',
      );
    });
  }
});

describe('the public lists stay honest', () => {
  it('names only files that exist', () => {
    // A renamed file leaves a stale entry behind. The rename itself is safe —
    // the new path is not on the list, so it must be gated — but a list full of
    // ghosts stops being reviewable.
    for (const rel of [...Object.keys(PUBLIC_PAGES), ...Object.keys(PUBLIC_ROUTES)]) {
      assert.doesNotThrow(
        () => statSync(join(appDir, rel)),
        `${rel} is on a public list but no longer exists`,
      );
    }
  });

  it('gives a reason for each entry', () => {
    for (const [rel, reason] of Object.entries({ ...PUBLIC_PAGES, ...PUBLIC_ROUTES })) {
      assert.ok(reason.trim().length > 20, `${rel} needs a real reason, not "${reason}"`);
    }
  });
});

describe('images are not cached by shared caches (SPEC.md §9.3)', () => {
  // Player photos behind a CDN. `public` would let an intermediary hold a copy
  // and hand it to someone with no cookie, which would undo the gate on the
  // route without touching the route.
  const source = read('api/images/[id]/route.ts');

  it('marks the response private', () => {
    assert.match(source, /'Cache-Control': 'private,/);
  });

  it('never marks it public', () => {
    assert.doesNotMatch(source, /'Cache-Control': 'public/);
  });

  it('varies on the cookie', () => {
    assert.match(source, /Vary: 'Cookie'/);
  });
});
