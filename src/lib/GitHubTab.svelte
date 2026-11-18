<script>
	import PanelButton from './PanelButton.svelte';
	import GitHubStarCount from './counters/GitHubStarCount.svelte';
</script>

<h1 class="text-sm font-semibold text-zinc-100 pr-8">GitHub</h1>
<PanelButton buttonImage="assets/github-mark-white.svg" clickUrl="https://github.com/leaningtech/webvm" buttonText="GitHub repo">
	<span class="ml-auto inline-flex items-center gap-1 text-[11px] font-mono text-zinc-300">
		<i class="fas fa-star text-[10px] text-amber-400/90" aria-hidden="true"></i>
		<GitHubStarCount repo="leaningtech/webvm"/>
	</span>
</PanelButton>
<p class="text-[11px] leading-relaxed text-zinc-400">Like WebVM? <a class="text-zinc-200 underline decoration-white/30 hover:decoration-white/70 transition-colors" href="https://github.com/leaningtech/webvm" target="_blank">Give us a star!</a></p>
<p class="text-[11px] leading-relaxed text-zinc-400">WebVM is FOSS, you can fork it to build your own version and begin working on your CheerpX-based project</p>
<p class="text-[11px] leading-relaxed text-zinc-400">Found a bug? Please open a <a class="text-zinc-200 underline decoration-white/30 hover:decoration-white/70 transition-colors" href="https://github.com/leaningtech/webvm/issues" target="_blank">GitHub issue</a></p>
