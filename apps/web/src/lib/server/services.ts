// 画面のサーバー側の処理 (load、action) が使う部品。起動時に hooks.server.ts の init が 1 回だけ入れる。
import type { CourseStore, SubjectStore } from '@funmary/db';

export interface Services {
	readonly courses: CourseStore;
	readonly subjects: SubjectStore;
	/** 公開 URL の origin (ブックマークレットの戻り先に使う) */
	readonly origin: string;
	/** 管理者への知らせ。秘密の値を含めない */
	readonly alertAdmin: (alert: {
		severity: 'info' | 'warn' | 'error';
		title: string;
		message?: string;
		key?: string;
	}) => Promise<unknown>;
}

let services: Services | undefined;

export function setServices(value: Services): void {
	services = value;
}

export function getServices(): Services {
	if (!services) throw new Error('サーバーの準備が終わっていません');
	return services;
}
