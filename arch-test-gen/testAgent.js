/**
 * ArchitectAI Test Generation Agent
 *
 * Runs one agentic LangGraph session per service to generate Jest test suites
 * based on the ecosystem spec. Runs in parallel with arch-code-gen; both
 * services consume the same architectai.implementation.requested event.
 *
 * The generated test files assume the file structure that arch-code-gen will
 * have produced (from the same spec), so the tests are always in sync with
 * the implementation contract — not the final generated code.
 *
 * Per-archetype output:
 *   http      → {sid}/__tests__/routes.test.js  (supertest integration)
 *               {sid}/__tests__/services.test.js (unit tests for service layer)
 *   messaging → {sid}/__tests__/handlers.test.js (unit tests per handler, mock producer)
 *   provider  → {sid}/__tests__/translator.test.js (unit: foreign → internal event)
 *               {sid}/__tests__/client.test.js     (unit: mock fetch, verify parsing)
 *   adaptor   → {sid}/__tests__/validator.test.js  (unit: valid/invalid payloads)
 *               {sid}/__tests__/translator.test.js  (unit: parsed payload → event)
 *
 * Usage:
 *   const { runTestAgent } = require('./testAgent');
 *   const workspace = await runTestAgent(spec, apiKey, onProgress);
 */

'use strict';

const nodePath = require('path');
const fs       = require('fs');
const { tool }             = require('@langchain/core/tools');
const { HumanMessage }     = require('@langchain/core/messages');
const { ChatAnthropic }    = require('@langchain/anthropic');
const { createReactAgent } = require('@langchain/langgraph/prebuilt');
const { z }                = require('zod');

// Use Haiku — test generation is pattern-following, not open-ended reasoning
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MAX_TOKENS  = 8000;

// ── Tool factory ──────────────────────────────────────────────────────────────
// Same write_file / read_file pattern as arch-code-gen's agent.js.

function makeTools(workspace, outputDir, onProgress, serviceId) {
  const writeFile = tool(
    async ({ path, content }) => {
      workspace[path] = content;
      if (outputDir) {
        const abs = nodePath.join(outputDir, path);
        fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
      }
      onProgress({ type: 'file', message: `Writing ${path}`, path, content, service: serviceId });
      return `OK: wrote ${path} (${content.length} bytes)`;
    },
    {
      name:        'write_file',
      description: 'Write content to a file in the workspace. Use this for every file you create.',
      schema: z.object({
        path:    z.string().describe('File path relative to workspace root'),
        content: z.string().describe('Complete file content'),
      }),
    }
  );

  const readFile = tool(
    async ({ path }) => workspace[path] !== undefined
      ? workspace[path]
      : `ERROR: file not found: ${path}`,
    {
      name:        'read_file',
      description: 'Read a file previously written to the workspace.',
      schema: z.object({
        path: z.string().describe('File path to read'),
      }),
    }
  );

  return [writeFile, readFile];
}

// ── Archetype naming — mirrors arch-code-gen/agent.js ────────────────────────
function correctArchetypeNames(spec, onProgress) {
  return {
    ...spec,
    services: spec.services.map(s => {
      const arch = s.archetype || 'http';
      let { id, name } = s;
      if (arch === 'provider' && !id.endsWith('-provider')) {
        id   = id.replace(/-provider$|-adaptor$/, '') + '-provider';
        name = name.replace(/Provider$|Adaptor$/, '') + 'Provider';
        onProgress({ type: 'info', message: `Corrected provider naming: ${s.id} → ${id}` });
      } else if (arch === 'adaptor' && !id.endsWith('-adaptor')) {
        id   = id.replace(/-provider$|-adaptor$/, '') + '-adaptor';
        name = name.replace(/Provider$|Adaptor$/, '') + 'Adaptor';
        onProgress({ type: 'info', message: `Corrected adaptor naming: ${s.id} → ${id}` });
      }
      return { ...s, id, name };
    }),
  };
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildHttpTestPrompt(spec, service) {
  const sid  = service.id;
  const apis = service.apis || [];

  // Group endpoints by first path segment (mirrors arch-code-gen route grouping)
  const routeGroups = {};
  for (const a of apis) {
    const seg = (a.path.split('/').filter(Boolean)[0] || 'root');
    (routeGroups[seg] = routeGroups[seg] || []).push(a);
  }
  const segments = Object.keys(routeGroups);

  const endpointList = apis
    .map(a => `  ${a.method} ${a.path} — ${a.description}`)
    .join('\n') || '  (none)';

  const serviceFiles = segments
    .map(seg => `  src/services/${seg}.js — business logic for the "${seg}" domain`)
    .join('\n');

  return `You are generating Jest test files for the "${sid}" HTTP service in the "${spec.projectName}" ecosystem.

Use the write_file tool for EVERY file. Do not explain — just write files.

## Service contracts

Purpose: ${service.purpose}
Tech:    ${service.tech || 'Node.js/Express'}

API endpoints:
${endpointList}

## File structure of the source service (already generated — do NOT recreate it)

  src/index.js          — Express app, exports { app } for testing
  src/middleware/validate.js
  src/middleware/errorHandler.js
${segments.map(seg => `  src/routes/${seg}.js\n  src/services/${seg}.js`).join('\n')}

## Required test files

${sid}/__tests__/routes.test.js
  - const { app } = require('../src/index')
  - const request = require('supertest')
  - One describe block per route group: ${segments.join(', ')}
  - In each describe, one test per endpoint:
${apis.map(a => `      "${a.method} ${a.path}": happy-path test — expect status 2xx and response body shape`).join('\n')}
  - For POST/PUT endpoints: also test missing required field → expect status 400
  - For GET /:id style endpoints: also test with a non-existent id → expect status 404
  - Use realistic data matching the service purpose: "${service.purpose}"
  - After each mutating test (POST/PUT/DELETE) that changes state, use a fresh server or clean up

${sid}/__tests__/services.test.js
  - Unit tests for src/services/ modules — no HTTP, no supertest
${serviceFiles}
  - Import each service module; call its exported functions directly
  - Test: create an item → list returns it; get by id returns correct item; update changes it; delete removes it
  - Use realistic domain data for "${service.purpose}"
  - No mocks needed — services use in-memory stores

## Rules
- Every path MUST begin with "${sid}/" — no exceptions
- Write complete, runnable test code. Every test must have at least one expect() assertion.
- Use real domain field names matching "${service.purpose}" — no foo/bar/baz placeholders
- Do not ask questions or explain anything. Just write files.
- Stop when all listed files are written.
`;
}

function buildMessagingTestPrompt(spec, service) {
  const sid      = service.id;
  const consumes = (service.events || []).filter(e => e.direction === 'consumes');
  const produces = (service.events || []).filter(e => e.direction === 'produces');

  const handlerList = consumes
    .map(e => {
      const safe = e.topic.replace(/\./g, '-');
      return `  src/handlers/${safe}.js — handles topic "${e.topic}": ${e.description}`;
    })
    .join('\n') || '  (none)';

  const topicTests = consumes
    .map(e => {
      const safe = e.topic.replace(/\./g, '-');
      return `    "${e.topic}" (${safe}.js): happy-path payload → verify return value shape; missing field → verify graceful handling`;
    })
    .join('\n');

  const producerTopics = produces.map(e => `"${e.topic}"`).join(', ') || 'none';

  return `You are generating Jest test files for the "${sid}" messaging service in the "${spec.projectName}" ecosystem.

Use the write_file tool for EVERY file. Do not explain — just write files.

## Service contracts

Purpose:          ${service.purpose}
Consumes topics:  ${consumes.map(e => e.topic).join(', ') || '(none)'}
Produces topics:  ${produces.map(e => e.topic).join(', ') || '(none)'}

## File structure of the source service (already generated — do NOT recreate it)

  src/consumer.js    — KafkaJS consumer, routes messages to handlers
  src/producer.js    — KafkaJS producer; exports connect() and publish(topic, payload)
  src/kafka.js       — KafkaJS instance
${handlerList}
  src/services/      — business logic (pure functions, no Kafka knowledge)

## Required test files

${sid}/__tests__/handlers.test.js
  - Unit tests for each handler function (one describe block per topic)
  - jest.mock('../src/producer') to intercept publish() calls — never connect to a real broker
  - Import each handler from src/handlers/{topic-slug}.js directly
  - Per-topic tests:
${topicTests}
  - When a handler returns { topic, payload }, assert that the correct topic is one of: ${producerTopics}
    and that the payload contains the expected fields
  - Use realistic payloads matching the service purpose: "${service.purpose}"

## Rules
- Every path MUST begin with "${sid}/" — no exceptions
- jest.mock('../src/producer') — never require a real Kafka connection in tests
- Write complete, runnable test code. Every test must have at least one expect() assertion.
- Use real domain field names matching "${service.purpose}" — no foo/bar/baz placeholders
- Do not ask questions or explain anything. Just write files.
- Stop when all listed files are written.
`;
}

function buildProviderTestPrompt(spec, service) {
  const sid      = service.id;
  const fa       = service.foreignApi || {};
  const produces = (service.events || []).filter(e => e.direction === 'produces');

  const producedTopics = produces
    .map(e => `  "${e.topic}" — ${e.description}`)
    .join('\n') || '  (none)';

  return `You are generating Jest test files for the "${sid}" provider service in the "${spec.projectName}" ecosystem.

Use the write_file tool for EVERY file. Do not explain — just write files.

## Service contracts

Purpose:      ${service.purpose}
Foreign API:  ${fa.name || 'unknown'} (${fa.baseUrl || 'unknown URL'})
Auth method:  ${fa.authMethod || 'apiKey'}
Produces:
${producedTopics}

## File structure of the source service (already generated — do NOT recreate it)

  src/client.js      — wraps ${fa.name || 'foreign API'} with node-fetch; returns raw parsed JSON
  src/translator.js  — maps foreign API responses → internal event payloads
  src/producer.js    — KafkaJS producer

## Required test files

${sid}/__tests__/translator.test.js
  - Unit tests for src/translator.js — no network, no Kafka
  - Import translator functions directly
  - For each produces topic:
${produces.map(e => `      "${e.topic}": given a realistic raw ${fa.name || 'foreign API'} response, assert translate() returns the expected internal event shape (correct fields and types)`).join('\n') || '      (none to test)'}
  - Use realistic foreign-domain data appropriate to "${fa.name || 'the foreign API'}"

${sid}/__tests__/client.test.js
  - Unit tests for src/client.js — mock global fetch so no real HTTP is made
  - jest.spyOn(global, 'fetch') or jest.fn() assigned to global.fetch before each test
  - For each exported client function:
      happy path: mock fetch to return a realistic ${fa.name || 'foreign API'} response;
        assert the client function parses and returns the expected shape
      error path: mock fetch to return status 401; assert the client function throws or rejects

## Rules
- Every path MUST begin with "${sid}/" — no exceptions
- No real HTTP, no real Kafka in tests — all external calls must be mocked
- Write complete, runnable test code. Every test must have at least one expect() assertion.
- Use realistic ${fa.name || 'foreign API'} domain data — no foo/bar/baz placeholders
- Do not ask questions or explain anything. Just write files.
- Stop when all listed files are written.
`;
}

function buildAdaptorTestPrompt(spec, service) {
  const sid      = service.id;
  const ac       = service.accepts || {};
  const produces = (service.events || []).filter(e => e.direction === 'produces');

  const producedTopics = produces
    .map(e => `  "${e.topic}" — ${e.description}`)
    .join('\n') || '  (none)';

  return `You are generating Jest test files for the "${sid}" adaptor service in the "${spec.projectName}" ecosystem.

Use the write_file tool for EVERY file. Do not explain — just write files.

## Service contracts

Purpose:         ${service.purpose}
Accepts:         ${ac.protocol || 'HTTP'}/${ac.format || 'JSON'} from ${ac.foreignEntity || 'foreign entity'}
Produces:
${producedTopics}

## File structure of the source service (already generated — do NOT recreate it)

  src/validator.js   — validates inbound payload; validate(req) → parsed payload or throws
  src/translator.js  — maps validated payload → internal event; translate(payload) → event
  src/producer.js    — KafkaJS producer

## Required test files

${sid}/__tests__/validator.test.js
  - Unit tests for src/validator.js — test the validate(req) function in isolation
  - Construct mock req objects: { body: Buffer.from(JSON.stringify({...})), headers: {...} }
  - Happy path: provide a valid ${ac.foreignEntity || 'foreign entity'} payload → validate() returns the parsed object
  - Missing required field: omit a critical field → validate() throws with a descriptive error
  - Malformed body: pass non-JSON Buffer → validate() throws
  - If the service uses signature verification: include a test with a correct header and one with a wrong header

${sid}/__tests__/translator.test.js
  - Unit tests for src/translator.js — test the translate(payload) function in isolation
  - No network, no Kafka
  - Happy path: given a realistic valid ${ac.foreignEntity || 'foreign entity'} payload,
    assert translate() returns the expected internal event for each produces topic:
${produces.map(e => `      "${e.topic}": assert event has correct fields and types`).join('\n') || '      (none)'}
  - Edge case: minimal payload (only required fields) → translate() returns a valid event

## Rules
- Every path MUST begin with "${sid}/" — no exceptions
- No real HTTP, no real Kafka in tests — pure unit tests of validator.js and translator.js
- Write complete, runnable test code. Every test must have at least one expect() assertion.
- Use realistic ${ac.foreignEntity || 'foreign entity'} domain data — no foo/bar/baz placeholders
- Do not ask questions or explain anything. Just write files.
- Stop when all listed files are written.
`;
}

function buildTestPrompt(spec, service) {
  const arch = service.archetype || 'http';
  switch (arch) {
    case 'http':      return buildHttpTestPrompt(spec, service);
    case 'messaging': return buildMessagingTestPrompt(spec, service);
    case 'provider':  return buildProviderTestPrompt(spec, service);
    case 'adaptor':   return buildAdaptorTestPrompt(spec, service);
    default:          return buildHttpTestPrompt(spec, service);
  }
}

// ── Single session ────────────────────────────────────────────────────────────
async function runSession(prompt, apiKey, onProgress, workspace, serviceId) {
  const tools = makeTools(workspace, null, onProgress, serviceId);
  const llm   = new ChatAnthropic({ model: MODEL_HAIKU, apiKey, maxTokens: MAX_TOKENS });
  const agent = createReactAgent({ llm, tools });

  const eventStream = agent.streamEvents(
    { messages: [new HumanMessage(prompt)] },
    { version: 'v2', recursionLimit: 60 }
  );

  for await (const event of eventStream) {
    if (event.event === 'on_chat_model_end') {
      onProgress({ type: 'thinking', message: 'Generating tests…', service: serviceId });
    }
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
async function runTestAgent(spec, apiKey, onProgress) {
  const workspace     = {};
  const correctedSpec = correctArchetypeNames(spec, onProgress);

  for (const service of correctedSpec.services) {
    // Skip mock companion services — they are dev/stage scaffolding with no business logic to test
    if (service.id.endsWith('-mock')) continue;

    onProgress({ type: 'test', message: `Generating tests for ${service.id}`, service: service.id });
    await runSession(
      buildTestPrompt(correctedSpec, service),
      apiKey,
      onProgress,
      workspace,
      service.id
    );
  }

  return workspace;
}

module.exports = { runTestAgent };
