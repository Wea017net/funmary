import repository from '../../../../repository.json' with { type: 'json' };

// リポジトリの URL。値はルートの repository.json にまとめている (移管 #114 のときは、そちらを書き換える)
export const REPOSITORY_URL = `https://github.com/${repository.repository}`;
