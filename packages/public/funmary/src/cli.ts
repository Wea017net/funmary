// funmary コマンドの本体。引数を読んで、公開 API (@funmary/client) から取り、端末に出す。
// 副作用 (出力、設定の保存、通信、MCP の起動) は、依存として受け取るので、テストで差し替えられる。
import { FunmaryApiError, type FunmaryClient } from '@funmary/client';
import { parseArgs } from 'node:util';
import {
	deleteConfig,
	loadConfig,
	saveConfig,
	type ConfigEnvironment,
	type StoredConfig,
} from './config.ts';
import { formatBusLeg, formatChanges, formatToday, formatWeek } from './format.ts';
import { createStyle, type Style } from './style.ts';

export interface CliDeps {
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly platform: NodeJS.Platform;
	readonly home: string;
	readonly now: () => Date;
	/** 標準出力と標準エラーへ、1 行ずつ */
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
	/** 端末の幅 (桁) と、端末への出力か */
	readonly width: number;
	readonly isTTY: boolean;
	/** トークンを読む。端末なら、入力を隠して尋ね、パイプなら、標準入力から読む */
	readonly readToken: () => Promise<string>;
	readonly createClient: (config: StoredConfig) => FunmaryClient;
	/** 手元の MCP サーバー (stdio) を起動する。終わるまで返らない */
	readonly runMcp: (config: StoredConfig) => Promise<void>;
	readonly version: string;
}

const USAGE = `funmary: Funmary (公立はこだて未来大学の学生向けの、非公式のアプリ) のコマンド

使い方: funmary <コマンド> [オプション]

コマンド:
  login     接続先とアクセストークンを保存する (--url <URL>。トークンは、尋ねるか、標準入力から読む)
  logout    保存した接続先とトークンを消す
  today     今日の授業と予定を出す
  week      今週の時間割を出す (--date YYYY-MM-DD で、その日を含む週)
  changes   これからの休講、補講、教室変更を出す (--days <日数>、既定は 14)
  bus       バスの時刻表を出す。未来大とバス停の間の、2 つの向き (--stop <番号か名前> --to | --from --day weekday|holiday --limit <件数> --all)
  mcp       手元の MCP サーバー (stdio) を起動する

共通のオプション:
  --json    スクリプト向けに、JSON で出す (today、week、changes、bus)
  --help    この説明を出す
  --version 版を出す

環境変数: FUNMARY_URL、FUNMARY_TOKEN (保存した値より先に使う)、NO_COLOR (色を出さない)
`;

const COMMANDS = ['login', 'logout', 'today', 'week', 'changes', 'bus', 'mcp'];

/** 日本時間の日付 (YYYY-MM-DD) と時刻 (HH:MM) */
function jst(now: Date): { date: string; time: string } {
	const iso = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString();
	return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function addDays(date: string, days: number): string {
	return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000)
		.toISOString()
		.slice(0, 10);
}

/** 利用者に伝える失敗。理由の文だけを出して、終わる */
class CliError extends Error {
	readonly exitCode: number;
	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

/** 接続先の URL を整える。https か、手元 (localhost、127.0.0.1) の http だけを受け付ける */
export function normalizeBaseUrl(input: string): string {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw new CliError('URL を読めません。例: https://funmary.example.com');
	}
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
		throw new CliError(
			'URL は https:// で始めてください (手元の開発なら、http://localhost も使えます)',
		);
	}
	return url.origin;
}

const asNumber = (value: string | undefined, label: string, min: number, max: number) => {
	if (value === undefined) return undefined;
	const number = Number(value);
	if (!Number.isInteger(number) || number < min || number > max) {
		throw new CliError(`${label} は、${min} から ${max} の整数で指定してください`, 2);
	}
	return number;
};

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs({
			args: [...argv],
			allowPositionals: true,
			options: {
				help: { type: 'boolean', short: 'h' },
				version: { type: 'boolean', short: 'v' },
				json: { type: 'boolean' },
				url: { type: 'string' },
				token: { type: 'string' },
				date: { type: 'string' },
				days: { type: 'string' },
				stop: { type: 'string' },
				to: { type: 'boolean' },
				from: { type: 'boolean' },
				day: { type: 'string' },
				limit: { type: 'string' },
				all: { type: 'boolean' },
			},
		});
	} catch (error) {
		deps.err(error instanceof Error ? error.message : String(error));
		deps.err('使い方は、funmary --help で見られます');
		return 2;
	}
	const { values, positionals } = parsed;
	const command = positionals[0];
	if (values.version) {
		deps.out(deps.version);
		return 0;
	}
	if (values.help || command === undefined || command === 'help') {
		deps.out(USAGE);
		return command === undefined && !values.help ? 2 : 0;
	}

	if (!COMMANDS.includes(command)) {
		deps.err(`知らないコマンドです: ${command}`);
		deps.err('使い方は、funmary --help で見られます');
		return 2;
	}

	const environment: ConfigEnvironment = {
		env: deps.env,
		platform: deps.platform,
		home: deps.home,
	};
	const style = createStyle({ env: deps.env, isTTY: deps.isTTY });
	const print = (lines: readonly string[]) => lines.forEach((line) => deps.out(line));
	const printJson = (value: unknown) => deps.out(JSON.stringify(value, null, 2));

	try {
		if (command === 'login') return await login(values, environment, deps);
		if (command === 'logout') {
			deps.out(
				deleteConfig(environment)
					? '保存した接続先とトークンを消しました'
					: '保存した接続先とトークンは、ありません',
			);
			return 0;
		}

		const config = loadConfig(environment);
		if (!config) {
			throw new CliError(
				'接続先とトークンがありません。先に funmary login --url <URL> を実行するか、環境変数 FUNMARY_URL と FUNMARY_TOKEN を設定してください',
			);
		}
		if (command === 'mcp') {
			await deps.runMcp(config);
			return 0;
		}
		const client = deps.createClient(config);
		const now = jst(deps.now());

		if (command === 'today') {
			const [timetable, events] = await Promise.all([
				client.timetable({ start: now.date, end: now.date }),
				client.events.list({ start: now.date, end: now.date }),
			]);
			if (values.json) printJson({ date: now.date, lessons: timetable.lessons, events });
			else
				print(
					formatToday({ date: now.date, lessons: timetable.lessons, events }, style, deps.width),
				);
			return 0;
		}
		if (command === 'week') {
			if (values.date !== undefined && !isDate(values.date)) {
				throw new CliError('--date は、YYYY-MM-DD の形で指定してください', 2);
			}
			const grid = await client.week(values.date === undefined ? {} : { date: values.date });
			if (values.json) printJson(grid);
			else print(formatWeek(grid, style, deps.width));
			return 0;
		}
		if (command === 'changes') {
			const days = asNumber(values.days, '--days', 1, 90) ?? 14;
			const lessons = await client.changes({ start: now.date, end: addDays(now.date, days - 1) });
			if (values.json) printJson(lessons);
			else print(formatChanges(lessons, style, deps.width));
			return 0;
		}
		if (command === 'bus') return await bus(values, client, now, style, deps, printJson, print);

		return 2;
	} catch (error) {
		return reportFailure(error, deps);
	}
}

function reportFailure(error: unknown, deps: CliDeps): number {
	if (error instanceof CliError) {
		deps.err(error.message);
		return error.exitCode;
	}
	if (error instanceof FunmaryApiError) {
		deps.err(error.message);
		const body = error.body as { consentUrl?: unknown } | undefined;
		if (error.code === 'terms_not_accepted' && typeof body?.consentUrl === 'string') {
			deps.err(`利用規約への同意が要ります: ${body.consentUrl}`);
		} else if (error.status === 401) {
			deps.err(
				'アクセストークンが使えません。設定画面で発行し直して、funmary login をやり直してください',
			);
		} else if (error.status === 403) {
			deps.err('このトークンには、この操作の範囲が許されていません');
		}
		return 1;
	}
	// 想定外の失敗。トークンを含まないよう、メッセージだけを出す
	deps.err(error instanceof Error ? error.message : String(error));
	return 1;
}

async function login(
	values: { url?: string | undefined; token?: string | undefined },
	environment: ConfigEnvironment,
	deps: CliDeps,
): Promise<number> {
	const existing = loadConfig(environment);
	const rawUrl = values.url ?? existing?.baseURL;
	if (!rawUrl) {
		throw new CliError(
			'接続先の URL を、--url で指定してください。例: funmary login --url https://funmary.example.com',
			2,
		);
	}
	const baseURL = normalizeBaseUrl(rawUrl);
	const token = (values.token ?? (await deps.readToken())).trim();
	if (!token) throw new CliError('トークンが空です', 2);
	const me = await deps.createClient({ baseURL, token }).me();
	const file = saveConfig(environment, { baseURL, token });
	deps.out(`ログインしました (${baseURL})`);
	deps.out(`許可された範囲: ${me.scopes.join('、') || 'なし'}`);
	deps.out(`保存先: ${file}`);
	return 0;
}

async function bus(
	values: {
		stop?: string | undefined;
		to?: boolean | undefined;
		from?: boolean | undefined;
		day?: string | undefined;
		limit?: string | undefined;
		all?: boolean | undefined;
		json?: boolean | undefined;
	},
	client: FunmaryClient,
	now: { date: string; time: string },
	style: Style,
	deps: CliDeps,
	printJson: (value: unknown) => void,
	print: (lines: readonly string[]) => void,
): Promise<number> {
	if (values.day !== undefined && values.day !== 'weekday' && values.day !== 'holiday') {
		throw new CliError('--day は、weekday か holiday を指定してください', 2);
	}
	if (values.to && values.from)
		throw new CliError('--to と --from は、どちらか 1 つにしてください', 2);
	const limit = asNumber(values.limit, '--limit', 1, 20) ?? 5;
	const listing = await client.bus.stops();
	const candidates = listing.stops.filter((stop) => stop.id !== '14023');

	let stop = candidates.find((candidate) => candidate.highlighted) ?? candidates[0];
	if (values.stop !== undefined) {
		const needle = values.stop.trim().toLowerCase();
		const byId = candidates.filter((candidate) => candidate.id === values.stop);
		const exact = candidates.filter((candidate) => candidate.name.toLowerCase() === needle);
		const partial = candidates.filter((candidate) => candidate.name.toLowerCase().includes(needle));
		const matched = byId.length > 0 ? byId : exact.length > 0 ? exact : partial;
		if (matched.length === 0) throw new CliError(`バス停が見つかりません: ${values.stop}`);
		if (matched.length > 1) {
			throw new CliError(
				`「${values.stop}」に当たるバス停が ${matched.length} 件あります: ${matched.map((m) => `${m.name} (${m.id})`).join('、')}。番号で指定してください`,
			);
		}
		stop = matched[0];
	}
	if (!stop) throw new CliError('バスの時刻表を、まだ取り込めていません');

	const directions = values.to
		? (['toUniversity'] as const)
		: values.from
			? (['fromUniversity'] as const)
			: (['toUniversity', 'fromUniversity'] as const);
	const legs = [];
	for (const direction of directions) {
		legs.push(
			await client.bus.legs({
				stopId: stop.id,
				direction,
				...(values.day === undefined ? {} : { day: values.day }),
			}),
		);
	}
	if (values.json) {
		printJson(legs);
		return 0;
	}
	legs.forEach((leg, index) => {
		if (index > 0) deps.out('');
		print(
			formatBusLeg(leg, { nowTime: now.time, limit, all: values.all ?? false }, style, deps.width),
		);
	});
	return 0;
}
