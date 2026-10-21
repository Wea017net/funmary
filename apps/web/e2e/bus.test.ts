// バスの時刻表の画面。時刻表は、取り込みの定期処理の代わりに、テストが DB に直接入れる。
import { expect, test } from '@playwright/test';
import { oidc, seedBus, signInAs, useMockOidc } from './support.ts';

// サーバーの状態 (次にログインする人) を共有するので、テストは 1 つずつ動かす
test.describe.configure({ mode: 'serial' });
useMockOidc();

test.describe('バス', () => {
	const email = `e2e-bus-${Date.now()}@fun.ac.jp`;

	test.beforeAll(() => {
		seedBus();
	});

	test('メニューにバスが出る。選んだバス停から未来大へ向かう便だけが、到着の時刻つきで出る', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.getByRole('link', { name: 'バス', exact: true }).first().click();
		await expect(page.getByRole('heading', { level: 1, name: 'バス' })).toBeVisible();

		await expect(page.getByRole('link', { name: /出発.*函館駅前/ })).toBeVisible();
		const rows = page.getByRole('listitem').filter({ hasText: '55A' });
		await expect(rows.first()).toContainText('赤川行き');
		await expect(rows.first()).toContainText('函館駅前 - はこだて未来大学');
		// 到着の時刻 (出発の 15 分後。未来大の発車表の同じ行き先の便) が付く
		await expect(rows.first()).toContainText('→');
		// 反対向き (千代台行き) は出ない
		await expect(page.getByText('千代台行き')).toHaveCount(0);
		// 現在地から向きを決めるボタンが出ている
		await expect(page.getByRole('button', { name: '現在地から向きを決める' })).toBeVisible();
	});

	test('向きを入れ替えると、URL は変えずに、未来大から出る便になる。向きは覚えない', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.goto('/app/bus');
		await page.getByRole('button', { name: /向きを入れ替える/ }).click();
		await expect(page).toHaveURL(/\/app\/bus$/);
		await expect(page.getByRole('link', { name: /到着.*函館駅前/ })).toBeVisible();
		const rows = page.getByRole('listitem').filter({ hasText: '55A' });
		await expect(rows.first()).toContainText('千代台行き');
		await expect(rows.first()).toContainText('はこだて未来大学 - 函館駅前');

		// 開き直すと、未来大へ向かう向きに戻る (学内の Wi-Fi でなければ)
		await page.goto('/app/bus');
		await expect(page.getByRole('link', { name: /出発.*函館駅前/ })).toBeVisible();
	});

	test('バス停の選択の画面から、バス停を選ぶと、バスの画面に戻る。次に開いても同じバス停', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.goto('/app/bus');
		await page.getByRole('link', { name: /出発.*函館駅前/ }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'バス停選択' })).toBeVisible();
		// 未来大そのものは選べない
		await expect(page.getByRole('button', { name: 'はこだて未来大学' })).toHaveCount(0);
		await page.getByRole('button', { name: '函館駅前' }).click();
		await expect(page).toHaveURL(/\/app\/bus$/);
		await page.reload();
		await expect(page.getByRole('link', { name: /出発.*函館駅前/ })).toBeVisible();
	});

	test('長いバス停名を選んでも、画面の横幅を超えない', async ({ page }) => {
		await page.setViewportSize({ width: 840, height: 900 });
		await signInAs(page, email);
		await page.goto('/app/bus');
		await page.getByRole('link', { name: /出発.*函館駅前/ }).click();
		await page.getByRole('button', { name: '赤川１丁目ライフプレステージ白ゆり美原前' }).click();

		const stopCard = page.getByRole('link', {
			name: /出発.*赤川１丁目ライフプレステージ白ゆり美原前/,
		});
		await expect(stopCard).toBeVisible();
		await expect(page.locator('main')).toHaveJSProperty(
			'scrollWidth',
			await page.locator('main').evaluate((main) => main.clientWidth),
		);
	});

	test('デスクトップでは次のバスと経路を並べ、時刻表を下にコンパクトに表示する', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInAs(page, email);
		await page.goto('/app');
		const homeHeadingLocator = page.getByRole('heading', { level: 1, name: 'ホーム' });
		const homeNextLocator = page.getByRole('region', { name: '次の授業' });
		await expect(homeHeadingLocator).toBeVisible();
		await expect(homeNextLocator).toBeVisible();
		const homeHeading = await homeHeadingLocator.boundingBox();
		const homeNext = await homeNextLocator.boundingBox();
		const homeNextStyle = await homeNextLocator.evaluate((element) => ({
			borderWidth: getComputedStyle(element).borderTopWidth,
			borderRadius: getComputedStyle(element).borderRadius,
		}));
		await page.goto('/app/bus');

		const busHeadingLocator = page.getByRole('heading', { level: 1, name: 'バス' });
		const nextBus = page.getByRole('region', { name: '次のバス' });
		const route = page.getByRole('region', { name: '経路' });
		const timetable = page.getByRole('region', { name: '時刻表' });
		const routeStop = page.getByRole('link', { name: /出発.*函館駅前/ });
		const departures = page.getByRole('list', { name: '函館駅前からはこだて未来大学への発車' });
		await expect(busHeadingLocator).toBeVisible();
		await expect(nextBus).toBeVisible();
		await expect(nextBus).toContainText(/55A|今日の発車は、もうありません/);
		await expect(nextBus).toHaveCSS('border-top-width', homeNextStyle.borderWidth);
		await expect(nextBus).toHaveCSS('border-radius', homeNextStyle.borderRadius);
		await expect(routeStop).toBeVisible();
		await expect(departures).toBeVisible();
		await expect(departures.getByText('1 番のりば', { exact: true })).toHaveCount(0);
		await expect(timetable.getByRole('heading', { name: '時刻表', exact: true })).toBeVisible();
		const daySwitch = timetable.getByRole('group', { name: '日の種類' });
		await expect(daySwitch).toBeVisible();
		const busHeading = await busHeadingLocator.boundingBox();
		const nextBusBox = await nextBus.boundingBox();
		const routeBox = await route.boundingBox();
		const routeCards = route.locator('.cards > *');
		const firstRouteCard = await routeCards.nth(0).boundingBox();
		const secondRouteCard = await routeCards.nth(1).boundingBox();
		const timetableBox = await timetable.boundingBox();
		const timetableHeadingBox = await timetable
			.getByRole('heading', { name: '時刻表' })
			.boundingBox();
		const daySwitchBox = await daySwitch.boundingBox();
		const departuresBox = await departures.boundingBox();
		expect(busHeading).not.toBeNull();
		expect(homeHeading).not.toBeNull();
		expect(homeNext).not.toBeNull();
		expect(nextBusBox).not.toBeNull();
		expect(routeBox).not.toBeNull();
		expect(firstRouteCard).not.toBeNull();
		expect(secondRouteCard).not.toBeNull();
		expect(timetableBox).not.toBeNull();
		expect(timetableHeadingBox).not.toBeNull();
		expect(daySwitchBox).not.toBeNull();
		expect(departuresBox).not.toBeNull();
		expect(busHeading!.y).toBe(homeHeading!.y);
		expect(nextBusBox!.y).toBe(homeNext!.y);
		expect(nextBusBox!.x).toBeLessThan(routeBox!.x);
		expect(secondRouteCard!.y).toBeGreaterThan(firstRouteCard!.y);
		expect(
			Math.abs(
				timetableHeadingBox!.y +
					timetableHeadingBox!.height / 2 -
					(daySwitchBox!.y + daySwitchBox!.height / 2),
			),
		).toBeLessThanOrEqual(1);
		expect(daySwitchBox!.x + daySwitchBox!.width).toBeLessThanOrEqual(
			timetableBox!.x + timetableBox!.width,
		);
		expect(departuresBox!.y).toBeGreaterThan(nextBusBox!.y);
		const listSize = await departures.evaluate((list) => ({
			scrollHeight: list.scrollHeight,
			clientHeight: list.clientHeight,
		}));
		expect(listSize.scrollHeight).toBeGreaterThan(listSize.clientHeight);
		await expect(page.locator('main')).toHaveJSProperty(
			'scrollHeight',
			await page.locator('main').evaluate((main) => main.clientHeight),
		);
	});

	test('狭い画面ではモバイルと同じ余白と文字サイズで便を縦に並べる', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await signInAs(page, email);
		await page.goto('/app/bus');
		const departures = page.getByRole('list', { name: '函館駅前からはこだて未来大学への発車' });
		const narrowRow = departures.getByRole('listitem').first();
		const mobileRow = await narrowRow.boundingBox();
		const mobileTimes = await narrowRow.locator('.times').boundingBox();
		const mobileDetail = await narrowRow.locator('.detail').boundingBox();
		expect(mobileRow).not.toBeNull();
		expect(mobileTimes).not.toBeNull();
		expect(mobileDetail).not.toBeNull();
		expect(mobileDetail!.y).toBeGreaterThanOrEqual(mobileTimes!.y + mobileTimes!.height);
		const mobileRowStyle = await narrowRow.evaluate((row) => ({
			padding: getComputedStyle(row).padding,
			gap: getComputedStyle(row).gap,
			timeFontSize: getComputedStyle(row.querySelector('.times')!).fontSize,
			sectionFontSize: getComputedStyle(row.querySelector('.section')!).fontSize,
		}));

		for (const width of [840, 1023]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(page.getByRole('region', { name: '次のバス' })).toBeVisible();
			const times = await narrowRow.locator('.times').boundingBox();
			const detail = await narrowRow.locator('.detail').boundingBox();
			expect(times).not.toBeNull();
			expect(detail).not.toBeNull();
			expect(detail!.y).toBeGreaterThanOrEqual(times!.y + times!.height);
			await expect(page.locator('main')).toHaveJSProperty(
				'scrollWidth',
				await page.locator('main').evaluate((main) => main.clientWidth),
			);
			await expect(
				narrowRow.evaluate((row) => ({
					padding: getComputedStyle(row).padding,
					gap: getComputedStyle(row).gap,
					timeFontSize: getComputedStyle(row.querySelector('.times')!).fontSize,
					sectionFontSize: getComputedStyle(row.querySelector('.section')!).fontSize,
				})),
			).resolves.toEqual(mobileRowStyle);
		}

		await page.setViewportSize({ width: 1024, height: 900 });
		const desktopTimes = await narrowRow.locator('.times').boundingBox();
		const desktopDetail = await narrowRow.locator('.detail').boundingBox();
		const desktopRow = await narrowRow.boundingBox();
		expect(desktopTimes).not.toBeNull();
		expect(desktopDetail).not.toBeNull();
		expect(desktopRow).not.toBeNull();
		expect(desktopTimes!.x + desktopTimes!.width).toBeLessThanOrEqual(desktopDetail!.x);
		expect(desktopRow!.height).toBeLessThan(mobileRow!.height);
	});

	test('リスト表示では到着時刻の有無にかかわらず、系統とバスのアイコンの列が揃う', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.goto('/app/bus');
		const rows = page
			.getByRole('list', { name: '函館駅前からはこだて未来大学への発車' })
			.getByRole('listitem');
		await expect(rows.filter({ has: page.locator('.arrow') })).not.toHaveCount(0);
		await expect(rows.filter({ hasNot: page.locator('.arrow') })).not.toHaveCount(0);
		for (const width of [1024, 1440]) {
			await page.setViewportSize({ width, height: 900 });
			for (const selector of ['.routes', '.section svg', '.section > span']) {
				const positions = await rows
					.locator(selector)
					.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x));
				expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
			}
			await expect(page.locator('main')).toHaveJSProperty(
				'scrollWidth',
				await page.locator('main').evaluate((main) => main.clientWidth),
			);
		}
	});

	test('初回描画や共通スタイルの読み込み順でバスの表示幅が変わらない', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInAs(page, email);
		let resumeScripts: () => void = () => {};
		const scriptsReady = new Promise<void>((resolve) => {
			resumeScripts = resolve;
		});
		await page.route('**/_app/immutable/**/*.js', async (route) => {
			await scriptsReady;
			await route.continue();
		});
		await page.goto('/app/bus', { waitUntil: 'commit' });
		const nextBus = page.getByRole('region', { name: '次のバス' });
		await expect(nextBus).toHaveCSS('display', 'flex');
		const before = await page
			.locator('.overview, .next-bus, .route-panel, .timetable-panel')
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
		resumeScripts();
		await expect(page.getByRole('button', { name: '現在地から向きを決める' })).toBeVisible();
		const after = await page
			.locator('.overview, .next-bus, .route-panel, .timetable-panel')
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
		expect(before).toEqual(after);
		await page.evaluate(async () => {
			const stylesheet = [...document.styleSheets].find((sheet) =>
				[...sheet.cssRules].some(
					(rule) => rule instanceof CSSStyleRule && rule.selectorText === '.page.page-w-48',
				),
			);
			const link = stylesheet?.ownerNode;
			if (!(link instanceof HTMLLinkElement)) throw new Error('共通スタイルがありません');
			const reloaded = link.cloneNode() as HTMLLinkElement;
			await new Promise<void>((resolve, reject) => {
				reloaded.onload = () => resolve();
				reloaded.onerror = () => reject(new Error('共通スタイルを読み込めませんでした'));
				document.head.append(reloaded);
			});
		});
		const reordered = await page
			.locator('.overview, .next-bus, .route-panel, .timetable-panel')
			.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
		expect(reordered).toEqual(after);
	});

	test('次のバスは向きと選択中のダイヤ区分に合わせて案内を変える', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInAs(page, email);
		await page.goto('/app/bus');

		const nextBus = page.getByRole('region', { name: '次のバス' });
		await expect(nextBus).toContainText('函館駅前 → はこだて未来大学');
		await page.getByRole('button', { name: /向きを入れ替える/ }).click();
		await expect(nextBus).toContainText('はこだて未来大学 → 函館駅前');

		const today = page.getByRole('button', { name: /\(今日\)/ });
		const otherDayLabel = (
			await page.getByRole('button', { name: /^(平日|休日)/ }).allTextContents()
		).find((label) => !label.includes('(今日)'));
		if (!otherDayLabel) throw new Error('今日以外のダイヤ区分がありません');
		await page.getByRole('button', { name: otherDayLabel.trim(), exact: true }).click();
		await expect(today).toBeVisible();
		await expect(nextBus).toContainText(
			`${otherDayLabel.includes('平日') ? '平日' : '休日'}ダイヤ`,
		);
	});

	test('モバイルでは従来の時刻表を保ち、デスクトップ用の次のバス枠を出さない', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInAs(page, email);
		await page.goto('/app/bus');
		const desktopSwitch = await page.getByRole('group', { name: '日の種類' }).boundingBox();
		expect(desktopSwitch).not.toBeNull();
		await page.setViewportSize({ width: 375, height: 667 });
		await page.getByRole('button', { name: /向きを入れ替える/ }).click();
		const arrival = page.getByRole('link', { name: /到着.*函館駅前/ });
		const locate = page.getByRole('button', { name: '現在地から向きを決める' });
		await expect(arrival).toBeVisible();
		await expect(locate).toBeVisible();
		const arrivalBox = await arrival.boundingBox();
		const locateBox = await locate.boundingBox();
		const routePadding = await page
			.getByRole('region', { name: '経路' })
			.evaluate((element) => parseFloat(getComputedStyle(element).paddingTop));
		expect(arrivalBox).not.toBeNull();
		expect(locateBox).not.toBeNull();
		expect(locateBox!.y - (arrivalBox!.y + arrivalBox!.height)).toBeGreaterThanOrEqual(
			routePadding,
		);
		await expect(page.getByRole('heading', { level: 1, name: 'バス' })).toBeVisible();
		await expect(page.getByRole('region', { name: '次のバス' })).toBeHidden();
		const timetable = page.getByRole('region', { name: '時刻表' });
		const timetableHeading = timetable.getByRole('heading', { name: '時刻表', exact: true });
		const daySwitch = timetable.getByRole('group', { name: '日の種類' });
		await expect(timetableHeading).toBeVisible();
		await expect(daySwitch).toBeVisible();
		const headingBox = await timetableHeading.boundingBox();
		const daySwitchBox = await daySwitch.boundingBox();
		expect(headingBox).not.toBeNull();
		expect(daySwitchBox).not.toBeNull();
		expect(daySwitchBox!.height).toBe(desktopSwitch!.height);
		expect(daySwitchBox!.width).toBe(desktopSwitch!.width);
		expect(
			Math.abs(
				headingBox!.y + headingBox!.height / 2 - (daySwitchBox!.y + daySwitchBox!.height / 2),
			),
		).toBeLessThanOrEqual(1);
		for (const width of [390, 430]) {
			await page.setViewportSize({ width, height: 844 });
			const box = await daySwitch.boundingBox();
			expect(box).not.toBeNull();
			expect(box!.height).toBe(daySwitchBox!.height);
			expect(box!.width).toBe(daySwitchBox!.width);
		}
		await expect(page.getByRole('listitem').filter({ hasText: '55A' }).first()).toBeVisible();
		await expect(page.locator('body')).toHaveJSProperty(
			'scrollWidth',
			await page.locator('body').evaluate((body) => body.clientWidth),
		);
	});

	test('ダークモードでも次のバスと時刻表が表示される', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await signInAs(page, email);
		await page
			.context()
			.addCookies([{ name: 'fm-theme', value: 'dark', url: 'http://localhost:4173' }]);
		await page.goto('/app/bus');

		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(page.getByRole('region', { name: '次のバス' })).toBeVisible();
		await expect(
			page.getByRole('list', { name: '函館駅前からはこだて未来大学への発車' }),
		).toBeVisible();
	});

	test('平日と休日を、URL は変えずに切り替えられ、その日のうちは覚える。今日の区分には (今日) が付く', async ({
		page,
	}) => {
		await signInAs(page, email);
		await page.goto('/app/bus');
		await expect(page.getByRole('button', { name: /\(今日\)/ })).toBeVisible();
		await page.getByRole('button', { name: /^休日/ }).click();
		await expect(page.getByRole('button', { name: /^休日/ })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
		await expect(page).toHaveURL(/\/app\/bus$/);

		await page.reload();
		await expect(page.getByRole('button', { name: /^休日/ })).toHaveAttribute(
			'aria-pressed',
			'true',
		);
	});

	test('ホームに、次のバスが出る。押すとバスの画面に行く', async ({ page }) => {
		await signInAs(page, email);
		await page.goto('/app');
		const section = page.getByRole('region', { name: '次のバス' });
		// 取り込んだ時刻表の終わりに近い時刻でも、乗る停留所と降りる停留所は出る
		await expect(section).toContainText('函館駅前 → はこだて未来大学');
		await section.getByRole('link').click();
		await expect(page.getByRole('heading', { level: 1, name: 'バス' })).toBeVisible();
	});

	test.describe('現在地が許可されているとき', () => {
		// 未来大の座標 (campus.ts の UNIVERSITY_LOCATION) の近く
		test.describe('未来大の近く', () => {
			test.use({
				permissions: ['geolocation'],
				geolocation: { latitude: 41.8421, longitude: 140.767 },
			});

			test('ホームの次のバスは、未来大から出る向きになる', async ({ page }) => {
				await signInAs(page, email);
				await page.goto('/app');
				await expect(page.getByRole('region', { name: '次のバス' })).toContainText(
					'はこだて未来大学 → 函館駅前',
				);
			});

			test('バスの画面も、未来大から出る向きになる', async ({ page }) => {
				await signInAs(page, email);
				await page.goto('/app/bus');
				await expect(page.getByRole('link', { name: /到着.*函館駅前/ })).toBeVisible();
			});
		});

		// 函館駅の近く
		test.describe('未来大から離れている', () => {
			test.use({
				permissions: ['geolocation'],
				geolocation: { latitude: 41.7737, longitude: 140.7266 },
			});

			test('ホームの次のバスは、未来大へ向かう向きになる', async ({ page }) => {
				await signInAs(page, email);
				await page.goto('/app');
				await expect(page.getByRole('region', { name: '次のバス' })).toContainText(
					'函館駅前 → はこだて未来大学',
				);
			});
		});
	});

	test('ログインしていなければ、バスの画面は開けない', async ({ page }) => {
		oidc.setIdentity({ sub: 'nobody', email: 'nobody@fun.ac.jp', email_verified: true });
		await page.context().clearCookies();
		await page.goto('/app/bus');
		await expect(page).not.toHaveURL(/\/app\/bus/);
	});
});
