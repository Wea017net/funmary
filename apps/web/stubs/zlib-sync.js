// @discordjs/ws が「あれば使う」オプションの圧縮ライブラリ (zlib-sync、C++ の拡張) の代わりの、空の部品。
// 圧縮は既定で使わない (compression が null) ので、読み込まれても何も起きない。
// これがないと、ビルドが、見つからない依存として止まる。VPS には better-sqlite3 しか入れないので、実物は同梱しない
export default undefined;
