<script>
	import PanelButton from './PanelButton.svelte';
	import { cpuPercentage } from './activities.js'
</script>

<h1 class="text-sm font-semibold text-zinc-100 pr-8">Engine</h1>
<PanelButton buttonImage="assets/cheerpx.svg" clickUrl="https://cheerpx.io/docs" buttonText="Explore CheerpX">
</PanelButton>
<p class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200"><span class="font-semibold">Virtual CPU: </span><span class="font-mono tabular-nums">{$cpuPercentage}%</span></p>
<p class="text-[11px] leading-relaxed text-zinc-400">CheerpX is a x86 virtualization engine in WebAssembly</p>
<p class="text-[11px] leading-relaxed text-zinc-400">It can securely run unmodified x86 binaries and libraries in the browser</p>
<p class="text-[11px] leading-relaxed text-zinc-400">Excited about our technology? <a class="text-zinc-200 underline decoration-white/30 hover:decoration-white/70 transition-colors" href="https://cheerpx.io/docs/getting-started" target="_blank">Start building</a> your projects using <a class="text-zinc-200 underline decoration-white/30 hover:decoration-white/70 transition-colors" href="https://cheerpx.io/" target="_blank">CheerpX</a> today!</p>
