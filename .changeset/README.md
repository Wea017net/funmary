# Changesets

npm で配るパッケージ (`funmary`、`@funmary/client`、`@funmary/mcp`) の版と変更履歴を管理します。公開しないパッケージは、対象にしません。

公開するパッケージを変えたら、`pnpm changeset` で、変更の種類 (patch、minor、major) と、変更の説明を書き、できたファイルをコミットします。説明は、利用者が変更履歴で読む文なので、日本語で書きます。
