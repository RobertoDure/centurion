import { writeFile } from 'node:fs/promises';

import { buildOpenApiDocument } from './http/openapi';

const target = new URL('../../../docs/openapi.json', import.meta.url);
const document = await buildOpenApiDocument();
await writeFile(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`wrote ${target.pathname}`);
