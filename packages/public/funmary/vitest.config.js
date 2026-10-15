import { defineProject } from 'vitest/config';

export default defineProject({
	test: {
		name: 'funmary',
		include: ['src/**/*.test.ts'],
		environment: 'node',
	},
});
