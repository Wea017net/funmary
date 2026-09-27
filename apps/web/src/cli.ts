// 管理用コマンド。手元では pnpm funmary-admin <コマンド>、本番では funmary-admin <コマンド> で使う (設計書 19.4)。
// 秘密の値は画面に出さない。出すのは変数の名前だけにする。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCommand, runMain } from 'citty';
import {
	backupDatabase,
	createCourseStore,
	createSubjectStore,
	createUnmatchedLessonStore,
	openDatabase,
	restoreDatabase,
} from '@funmary/db';
// 入口 (@funmary/sources) からだと、取得の部品と依存まで cli.js にまとまるので、PDF の読み取りだけを読み込む
import { parseTimetablePdf } from '@funmary/sources/timetable-pdf';
import { parseConfig, type Config } from './lib/server/config.ts';
import { fillSecrets, generateSecrets } from './lib/server/env-file.ts';
import { findMigrationsFolder } from './lib/server/migrations-path.ts';
import { importTimetable, type TimetableImportReport } from './lib/server/timetable-import.ts';

/** リリースでは cli.js の隣に migrations を置く。TypeScript のまま動かす手元にはないので、DB のパッケージの既定に任せる */
const bundledMigrations = findMigrationsFolder(dirname(fileURLToPath(import.meta.url)));

/** 手元の開発では .env を読む。本番では systemd やラッパーが環境変数を渡すので読まない */
function loadDevelopmentEnv(): void {
	if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
		process.loadEnvFile('.env');
	}
}

/** 設定を読む。足りない値や誤りがあれば、直し方を示して終える */
function loadConfigOrExit(): Config {
	loadDevelopmentEnv();
	const result = parseConfig(process.env);
	if (result.ok) return result.config;
	console.error('環境変数に足りない値か誤りがあります。次の変数を直してください。');
	for (const issue of result.issues) console.error(`  ${issue.name}: ${issue.message}`);
	process.exit(1);
}

const init = defineCommand({
	meta: {
		name: 'init',
		description: '環境変数ファイルの空の鍵を作って埋める。値のある行は変えない',
	},
	args: {
		file: {
			type: 'string',
			description: '書き換える環境変数ファイル。なければ .env.example から作る',
			default: '.env',
		},
	},
	run({ args }) {
		const exists = existsSync(args.file);
		const text = exists
			? readFileSync(args.file, 'utf8')
			: existsSync('.env.example')
				? readFileSync('.env.example', 'utf8')
				: '';
		const result = fillSecrets(text, generateSecrets);
		if (exists && result.filled.length === 0) {
			console.log(`${args.file} の鍵はすべて埋まっています。何も変えていません。`);
			return;
		}
		// 既存のファイルは上書きしても所有者と権限が変わらない。新しく作るときは自分だけが読めるようにする
		writeFileSync(args.file, result.text, exists ? {} : { mode: 0o600 });
		console.log(`${args.file} に次の鍵を書きました: ${result.filled.join(', ')}`);
		console.log('Google の値は、自分で書いてください。');
	},
});

const migrate = defineCommand({
	meta: { name: 'migrate', description: 'DB のマイグレーションを行う (起動時にも自動で行われる)' },
	run() {
		const config = loadConfigOrExit();
		mkdirSync(config.dataDir, { recursive: true });
		const database = openDatabase(join(config.dataDir, 'funmary.db'), {
			backupDir: join(config.dataDir, 'backups'),
			...(bundledMigrations && { migrationsFolder: bundledMigrations }),
		});
		database.close();
		console.log(`${join(config.dataDir, 'funmary.db')} のマイグレーションを終えました。`);
	},
});

const backup = defineCommand({
	meta: {
		name: 'backup',
		description: 'DB のバックアップを取る。古い日ごとのバックアップは 14 個まで残す',
	},
	run() {
		const config = loadConfigOrExit();
		const database = openDatabase(join(config.dataDir, 'funmary.db'), {
			backupDir: join(config.dataDir, 'backups'),
			...(bundledMigrations && { migrationsFolder: bundledMigrations }),
		});
		try {
			const file = backupDatabase(database, join(config.dataDir, 'backups'), { now: new Date() });
			console.log(`バックアップを作りました: ${file}`);
		} finally {
			database.close();
		}
	},
});

const restore = defineCommand({
	meta: {
		name: 'restore',
		description: 'バックアップから DB を戻す。先に systemctl stop funmary でアプリを止めておく',
	},
	args: {
		file: { type: 'positional', description: '戻すバックアップのファイル', required: true },
	},
	run({ args }) {
		const config = loadConfigOrExit();
		const kept = restoreDatabase(join(config.dataDir, 'funmary.db'), args.file, {
			now: new Date(),
		});
		console.log(`戻しました。それまでの DB は ${kept} に残してあります。`);
		console.log('systemctl start funmary でアプリを起動してください。');
	},
});

const WEEKDAYS = ['', '月', '火', '水', '木', '金', '土'];
const METHOD_LABELS = {
	exact: '完全一致',
	normalized: '表記の揺れを除いて一致',
	'old-name-removed': '旧名を除いて一致',
	manual: '管理画面で紐付け済み',
} as const;

/** 取り込みの結果を、管理者が確かめられる形で出す */
function printTimetableReport(
	report: Extract<TimetableImportReport, { kind: 'planned' }>,
	subjectName: (id: number) => string,
): void {
	const term = report.term === 'spring' ? '前期' : report.term === 'fall' ? '後期' : '学期不明';
	console.log(`${report.academicYear} 年度 ${term} の時間割`);
	for (const warning of report.warnings) console.log(`  警告: ${warning}`);

	const counts = new Map<string, number>();
	for (const slot of report.slots) {
		counts.set(slot.method, (counts.get(slot.method) ?? 0) + 1);
	}
	console.log(
		`枠 ${report.slots.length} 件 (` +
			Object.entries(METHOD_LABELS)
				.map(([method, label]) => `${label} ${counts.get(method) ?? 0}`)
				.join('、') +
			')',
	);
	// 完全一致でないものは、取り違えがないかを人が確かめる
	for (const slot of report.slots.filter((s) => s.method !== 'exact')) {
		console.log(
			`  ${METHOD_LABELS[slot.method]}: ${slot.lessonName} → ${subjectName(slot.subjectId)} (${WEEKDAYS[slot.weekday]} ${slot.period} 限)`,
		);
	}
	console.log(`照合できなかった名前 ${report.unmatched.length} 件`);
	for (const item of report.unmatched) {
		if (item.reason === 'similar') {
			console.log(
				`  似た科目だけあり: ${item.lessonName} (似た科目: ${subjectName(item.candidateId)})`,
			);
		} else {
			console.log(
				`  ${item.reason === 'ambiguous' ? '候補が複数' : '候補なし'}: ${item.lessonName}`,
			);
		}
	}

	if (!report.applied) {
		console.log(
			'確かめただけで、DB には書き込んでいません。書き込むには --apply を付けてください。',
		);
		return;
	}
	const { added, updated, conflicts, newUnmatched } = report.applied;
	console.log(
		`書き込みました: 枠を ${added} 件足し、空だった教室を ${updated} 件埋めました。` +
			`照合できなかった名前を ${newUnmatched} 件、新しく記録しました。`,
	);
	if (conflicts.length > 0) {
		console.log(`既にある枠と教室が違うもの ${conflicts.length} 件 (上書きしていません)`);
		for (const c of conflicts) {
			console.log(
				`  ${subjectName(c.subjectId)} ${WEEKDAYS[c.weekday]} ${c.period} 限: 登録済み ${c.existingRoom ?? '(なし)'}、PDF ${c.importedRoom ?? '(なし)'}`,
			);
		}
	}
}

const timetableImport = defineCommand({
	meta: {
		name: 'import',
		description:
			'授業時間割の PDF を読み、科目と照合して、科目ごとに共有する枠に取り込む。--apply がなければ確かめるだけ',
	},
	args: {
		file: { type: 'positional', description: '授業時間割の PDF', required: true },
		apply: { type: 'boolean', description: 'DB に書き込む', default: false },
		year: { type: 'string', description: '年度 (PDF の表題から読めないときに指定する)' },
		'ignore-warnings': {
			type: 'boolean',
			description: '読み取りに警告があっても書き込む (内容を確かめてから使う)',
			default: false,
		},
	},
	async run({ args }) {
		const year = args.year === undefined ? undefined : Number(args.year);
		if (year !== undefined && !Number.isInteger(year)) {
			console.error(`年度は数字で指定してください: ${args.year}`);
			process.exit(1);
		}
		const parsed = await parseTimetablePdf(new Uint8Array(readFileSync(args.file)));
		if (parsed.kind === 'invalid') {
			console.error(`時間割の PDF として読めませんでした: ${parsed.reason}`);
			process.exit(1);
		}
		console.log(
			`PDF から ${parsed.entries.length} コマを読みました (更新日 ${parsed.updatedOn ?? '不明'}、` +
				`クラスのあるコマ ${Math.round(parsed.quality.classRatio * 100)}%、` +
				`部屋のあるコマ ${Math.round(parsed.quality.roomRatio * 100)}%)`,
		);

		const config = loadConfigOrExit();
		const database = openDatabase(join(config.dataDir, 'funmary.db'), {
			backupDir: join(config.dataDir, 'backups'),
			...(bundledMigrations && { migrationsFolder: bundledMigrations }),
		});
		try {
			const subjects = createSubjectStore(database);
			const report = importTimetable(
				parsed,
				{
					subjects,
					courses: createCourseStore(database),
					unmatched: createUnmatchedLessonStore(database),
				},
				{
					apply: args.apply,
					now: new Date(),
					ignoreWarnings: args['ignore-warnings'],
					...(year !== undefined && { academicYear: year }),
				},
			);
			switch (report.kind) {
				case 'no-year':
					console.error('PDF の表題から年度を読めませんでした。--year で指定してください。');
					process.exitCode = 1;
					return;
				case 'no-subjects':
					console.error(
						`${report.academicYear} 年度の科目がまだありません。先に定期処理 import-syllabus で公開シラバスを取り込んでください。`,
					);
					process.exitCode = 1;
					return;
				case 'has-warnings':
					console.error('読み取りに警告があるので、書き込みませんでした。');
					for (const warning of report.warnings) console.error(`  ${warning}`);
					console.error('内容を確かめたうえで書き込むなら、--ignore-warnings を付けてください。');
					process.exitCode = 1;
					return;
				case 'planned':
					printTimetableReport(report, (id) => subjects.findById(id)?.name ?? `(科目 ${id})`);
			}
		} finally {
			database.close();
		}
	},
});

const timetable = defineCommand({
	meta: { name: 'timetable', description: '科目ごとに共有する時間割の枠を扱う' },
	subCommands: { import: timetableImport },
});

const main = defineCommand({
	meta: { name: 'funmary-admin', description: 'Funmary の管理用コマンド' },
	subCommands: { init, migrate, backup, restore, timetable },
});

await runMain(main);
