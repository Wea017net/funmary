// サーバーの OpenAPI の定義 (/api/v1/openapi.json) から、クライアントの型を作る。
// サーバーは動かさず、ルートの定義だけを読む (リクエストを処理しないので、依存は空でよい)。
// CI で作り直して、差分がないことを確かめる。
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createOpenApiRoutes, createV1Routes, type V1RoutesDeps } from '@funmary/api';
import openapiTS, { astToString } from 'openapi-typescript';

const app = createOpenApiRoutes(createV1Routes({} as V1RoutesDeps));
const response = await app.request('/api/v1/openapi.json');
if (!response.ok) throw new Error(`OpenAPI の定義を作れませんでした (HTTP ${response.status})`);
const document = (await response.json()) as Parameters<typeof openapiTS>[0];

const header = `// このファイルは scripts/generate-types.ts が作る。手では直さない (pnpm --filter @funmary/client generate)。\n\n`;
const body = astToString(await openapiTS(document));
const output = fileURLToPath(new URL('../src/generated/api.ts', import.meta.url));
await writeFile(output, header + body);
console.log(`書き出しました: ${output}`);
