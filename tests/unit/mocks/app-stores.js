import { writable } from 'svelte/store';

export const page = writable({
	data: { posts: [] },
	url: new URL('http://localhost/')
});
export const navigating = writable(null);
export const updated = writable(false);
