/**
 * Builds backend/contracts/openapi.yaml from the TypeScript contract (api-types.ts) and the route
 * table (openapi.routes.ts), so the OpenAPI document cannot drift from the types both apps use.
 *
 *   npm run contract:openapi          write the file
 *   npm run contract:openapi -- --check   exit 1 if the file is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';
import { stringify } from 'yaml';
import type { ApiErrorCode } from '@contracts';
import { routes, type RouteAuth, type RouteDoc } from '../../../contracts/openapi.routes.js';

const contractsDir = fileURLToPath(new URL('../../../contracts/', import.meta.url));
export const OPENAPI_PATH = `${contractsDir}openapi.yaml`;

/** HTTP status for each error code, matching what the services throw. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  CONSENT_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  INVITATION_INVALID: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  SKIP_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERVIEW_COMPLETED: 409,
  DUPLICATE_SUBMISSION: 409,
  SECONDARY_CAMERA_REQUIRED: 409,
  RECORDING_NOT_READY: 409,
  INVITATION_EXPIRED: 410,
  RECORDING_DELETED: 410,
  RESUME_UNSUPPORTED: 415,
  RESUME_UNREADABLE: 422,
  ACCOUNT_LOCKED: 423,
  SESSION_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  RECORDING_DELETE_FAILED: 502,
  PROVIDER_UNAVAILABLE: 503,
  MEDIA_NOT_CONFIGURED: 503,
  RECORDING_UNAVAILABLE: 503,
  SERVICE_UNAVAILABLE: 503,
  PROVIDER_TIMEOUT: 504,
};

const SECURITY: Record<RouteAuth, Array<Record<string, string[]>>> = {
  public: [],
  recruiter: [{ recruiterSession: [] }],
  candidate: [{ candidateSession: [] }],
  // Recruiter viewer, candidate laptop, or (no cookie) a phone with a pairing token in the body.
  mediaToken: [{ recruiterSession: [] }, { candidateSession: [] }, {}],
  webhook: [{ livekitSignature: [] }],
};

type JsonSchema = Record<string, unknown>;
/** Bodies whose fields are all optional, so the body itself may be omitted. */
const OPTIONAL_BODIES = new Set(['GenerateQuestionsRequest', 'MediaTokenRequest']);
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function contractSchemas(): Record<string, JsonSchema> {
  const schema = createGenerator({
    path: `${contractsDir}api-types.ts`,
    tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
    type: '*',
    expose: 'export',
    jsDoc: 'extended',
    skipTypeCheck: true,
    additionalProperties: true,
  }).createSchema('*');
  const text = JSON.stringify(schema.definitions ?? {}).replaceAll('#/definitions/', '#/components/schemas/');
  return JSON.parse(text) as Record<string, JsonSchema>;
}

function operation(route: RouteDoc, schemas: Record<string, JsonSchema>) {
  const parameters: unknown[] = [...route.path.matchAll(/:(\w+)/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  }));
  if (route.query) {
    const props = (schemas[route.query]?.properties ?? {}) as Record<string, JsonSchema>;
    for (const [name, schema] of Object.entries(props)) parameters.push({ name, in: 'query', required: false, schema });
  }

  const success = route.status ?? 200;
  const responses: Record<string, unknown> = {
    [success]:
      route.contentType
        ? { description: 'File download.', content: { [route.contentType]: { schema: { type: 'string', format: 'binary' } } } }
        : route.response
          ? { description: 'Success.', content: { 'application/json': { schema: ref(route.response) } } }
          : { description: 'Success (no body).' },
  };
  const byStatus = new Map<number, ApiErrorCode[]>();
  for (const code of new Set<ApiErrorCode>([...route.errors, 'INTERNAL_ERROR'])) {
    const status = ERROR_STATUS[code];
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  for (const [status, codes] of [...byStatus.entries()].sort(([a], [b]) => a - b)) {
    responses[status] = { description: `Error codes: ${codes.join(', ')}.`, content: { 'application/json': { schema: ref('ApiErrorBody') } } };
  }

  return {
    tags: [route.tag],
    summary: route.summary,
    security: SECURITY[route.auth],
    ...(parameters.length ? { parameters } : {}),
    ...(route.request ? { requestBody: { required: !OPTIONAL_BODIES.has(route.request), content: { 'application/json': { schema: ref(route.request) } } } } : {}),
    ...(route.upload
      ? {
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: { type: 'object', required: [route.upload.field], properties: { [route.upload.field]: { type: 'string', format: 'binary', description: route.upload.description } } },
              },
            },
          },
        }
      : {}),
    responses,
  };
}

export function generateOpenApi(): string {
  const schemas = contractSchemas();
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][route.method] = operation(route, schemas);
  }
  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'HireByte API',
      version: '0.1.0',
      description:
        'REST API of the HireByte Node backend (PRD v2.1 §11). Errors always use ApiErrorBody. ' +
        'Realtime Socket.IO events are documented in events.md.',
    },
    servers: [{ url: '/api' }],
    tags: [...new Set(routes.map((r) => r.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        recruiterSession: { type: 'apiKey', in: 'cookie', name: 'hb_session', description: 'HttpOnly session cookie set by POST /auth/recruiter/login.' },
        candidateSession: { type: 'apiKey', in: 'cookie', name: 'hb_candidate', description: 'HttpOnly, interview-scoped cookie set by POST /candidate/access (path /api).' },
        livekitSignature: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'JWT signed with the LiveKit API secret, containing a sha256 of the raw body.' },
      },
      schemas,
    },
  };
  const header = [
    '# GENERATED from backend/contracts/api-types.ts and backend/contracts/openapi.routes.ts.',
    '# Do not edit by hand: run `npm run contract:openapi` in backend/api.',
    '',
  ].join('\n');
  return header + stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = generateOpenApi();
  if (process.argv.includes('--check')) {
    const current = readFileSync(OPENAPI_PATH, 'utf8').replace(/\r\n/g, '\n');
    if (current !== next) {
      console.error('backend/contracts/openapi.yaml is out of date. Run `npm run contract:openapi` in backend/api.');
      process.exit(1);
    }
    console.log('openapi.yaml is up to date.');
  } else {
    writeFileSync(OPENAPI_PATH, next);
    console.log(`Wrote ${OPENAPI_PATH} (${routes.length} operations).`);
  }
}
