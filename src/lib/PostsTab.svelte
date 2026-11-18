<script>
	import BlogPost from './BlogPost.svelte';
	import { page } from '$app/stores';
</script>
<h1 class="text-sm font-semibold text-zinc-100 pr-8">Blog posts</h1>
<div class="overflow-y-auto scrollbar flex flex-col gap-2 pr-0.5">
{#each ($page.data?.posts ?? []) as post}
	<BlogPost
		title={post.title}
		image={post.image}
		url={post.url}
	/>
{:else}
	<p class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-400">Blog posts are unavailable offline.</p>
{/each}
</div>
