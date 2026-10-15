# @funmary/mcp

[Funmary](https://github.com/funmary-app/funmary) の MCP サーバーです。手元のパソコンで動かして、Claude Desktop などから、自分の時間割、休講、予定、バスの時刻表を読み書きできます。Funmary は、公立はこだて未来大学の学生向けの、非公式のアプリです。

## 使い方

Funmary の設定画面で、個人用のアクセストークンを発行し、クライアントの設定に書きます。

```json
{
  "mcpServers": {
    "funmary": {
      "command": "npx",
      "args": ["-y", "@funmary/mcp"],
      "env": {
        "FUNMARY_URL": "https://funmary.example.com",
        "FUNMARY_TOKEN": "fmy_..."
      }
    }
  }
}
```

- `FUNMARY_URL`: 使っている Funmary のサーバーの URL。既定値は持ちません
- `FUNMARY_TOKEN`: 個人用のアクセストークン。トークンに許した範囲 (`read:lessons`、`write:events` など) の道具だけが出ます。書き込みの範囲は、必要なときだけ許してください

道具の定義は、Funmary のサーバーの `/mcp` と共有しています。サーバーの `/mcp` に、OAuth で直接つなぐこともできます。

## ライブラリとして

```ts
import { createFunmaryMcpServer, createClientData } from '@funmary/mcp';
import { createFunmaryClient } from '@funmary/client';

const client = createFunmaryClient({ baseURL, token });
const server = createFunmaryMcpServer({
  data: createClientData(client),
  scopes: (await client.me()).scopes,
});
```

## ライセンス

BSD-3-Clause または Apache-2.0 (好きな方を選べます)。
