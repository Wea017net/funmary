// 予定を足す (Issue #144)。
import { fail, redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { jstDateTime } from '@funmary/core';
import { echoFormValues, emptyFormValues, parseEventForm } from '#lib/event-form.ts';
import { getServices } from '#lib/server/services.ts';
import { requireSignedIn } from '#lib/server/admin.ts';

export const load: ServerLoad = ({ locals }) => {
	requireSignedIn(locals);
	return { values: emptyFormValues(jstDateTime(new Date()).date) };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		requireSignedIn(locals);
		const form = await request.formData();
		const parsed = parseEventForm(form);
		if (!parsed.ok) {
			return fail(400, {
				error: parsed.error,
				values: echoFormValues(form, jstDateTime(new Date()).date),
			});
		}
		getServices().userEvents.create(locals.user.id, parsed.value, new Date());
		redirect(303, '/app/events?saved=created');
	},
};
