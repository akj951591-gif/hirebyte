import { readFileSync } from 'node:fs';
import type { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { routes } from '../../../contracts/openapi.routes.js';
import { loadEnv } from '../../src/config/env.js';
import { createDeps } from '../../src/deps.js';
import { apiRoutes, routeContext, webhookRoutes } from '../../src/routes/index.js';
import { generateOpenApi, OPENAPI_PATH } from '../../src/scripts/generate-openapi.js';
import { createServices } from '../../src/services/index.js';

interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

/** Every method + path the Express routers actually serve (all sub-routers are mounted at /api). */
function served(router: Router, out = new Set<string>()): Set<string> {
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    if (layer.route) {
      for (const [method, on] of Object.entries(layer.route.methods)) if (on && method !== '_all') out.add(`${method} ${layer.route.path}`);
    } else if (layer.handle?.stack) {
      served(layer.handle as unknown as Router, out);
    }
  }
  return out;
}

describe('OpenAPI contract (backend/contracts/openapi.yaml)', () => {
  const generated = generateOpenApi();

  it('is up to date (run `npm run contract:openapi` after changing routes or types)', () => {
    expect(readFileSync(OPENAPI_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(generated);
  });

  it('documents exactly the routes the API serves', () => {
    const deps = createDeps(loadEnv({ DATABASE_URL: 'postgresql://unused@localhost/unused', SESSION_SECRET: 's'.repeat(40) }));
    const ctx = routeContext(deps, createServices(deps));
    const actual = served(webhookRoutes(ctx), served(apiRoutes(ctx)));
    actual.add('get /health'); // defined directly on the app
    const documented = new Set(routes.map((r) => `${r.method} ${r.path}`));
    expect([...documented].sort()).toEqual([...actual].sort());
    expect(documented.size).toBe(routes.length); // no duplicates
  });

  it('only references schemas that exist', () => {
    const doc = parse(generated) as { components: { schemas: Record<string, unknown> } };
    const names = new Set(Object.keys(doc.components.schemas));
    const refs = [...generated.matchAll(/\$ref: "#\/components\/schemas\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1]!));
    expect(refs.length).toBeGreaterThan(50);
    expect(refs.filter((r) => !names.has(r))).toEqual([]);
    for (const route of routes) {
      for (const name of [route.request, route.query, route.response].filter(Boolean)) expect(names.has(name!)).toBe(true);
    }
  });
});
