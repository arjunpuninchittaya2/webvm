<h1 class="text-sm font-semibold text-zinc-100 pr-8">Information</h1>
<img src="assets/webvm_hero.png" alt="WebVM Logo" class="w-48 h-48 object-contain self-center">
<p class="text-xs text-zinc-200 leading-relaxed">WebVM is a virtual Linux environment running in the browser via WebAssembly</p>
<p class="text-xs font-semibold text-zinc-200">It is based on:</p>
<ul class="list-disc list-inside space-y-1 text-xs text-zinc-300 leading-relaxed">
	<li><a class="text-zinc-100 underline decoration-white/30 hover:decoration-white/70 transition-colors" target="_blank" href="https://cheerpx.io/">CheerpX</a>: x86 JIT in Wasm</li>
	<li><a class="text-zinc-100 underline decoration-white/30 hover:decoration-white/70 transition-colors" target="_blank" href="https://xtermjs.org/">Xterm.js</a>: interactive terminal</li>
	<li>Local/private <a class="text-zinc-100 underline decoration-white/30 hover:decoration-white/70 transition-colors" target="_blank" href="https://cheerpx.io/docs/guides/File-System-support">file storage</a></li>
	<li><a class="text-zinc-100 underline decoration-white/30 hover:decoration-white/70 transition-colors" target="_blank" href="https://cheerpx.io/docs/guides/Networking">Networking</a> via <a class="text-zinc-100 underline decoration-white/30 hover:decoration-white/70 transition-colors" target="_blank" href="https://tailscale.com/">Tailscale</a></li>
</ul>
<div class="pt-2 border-t border-white/5 text-[11px] leading-relaxed text-zinc-400">
	<slot></slot>
</div>
