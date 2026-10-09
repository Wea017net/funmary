// 利用者が登録できる Webhook の個数の上限。下げても、登録済みの Webhook は消さない
import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/admin.ts';
import { getServices } from '#lib/server/services.ts';
import { MAX_WEBHOOK_LIMIT, parseWebhookLimit } from '#lib/server/webhook-limit.ts';

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return { limit: getServices().webhooks.limit(), max: MAX_WEBHOOK_LIMIT };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		requireAdmin(locals);
		const limit = parseWebhookLimit((await request.formData()).get('limit'));
		if (limit === null) {
			return fail(400, { error: `0 から ${MAX_WEBHOOK_LIMIT} までの整数を入れてください。` });
		}
		getServices().webhooks.setLimit(limit);
		return { message: `上限を ${limit} 個にしました。` };
	},
};
