<script>
	import { apiState, setApiKey, addMessage, clearMessageHistory, forceStop, messageList, currentMessage, enableThinking, getMessageDetails } from '$lib/anthropic.js';
	import { tick } from 'svelte';
	import { get } from 'svelte/store';
	import PanelButton from './PanelButton.svelte';
	import SmallButton from './SmallButton.svelte';
	import { aiActivity } from './activities.js';
	export let handleTool;
	let stopRequested = false;
	function handleKeyEnter(e)
	{
		if(e.key != "Enter")
			return;
		var value = e.target.value;
		if(value == "")
			return;
		setApiKey(value);
	}
	function handleMessage(e)
	{
		if(e.key != "Enter")
			return;
		e.preventDefault();
		var textArea = e.target;
		var value = textArea.value;
		if(value == "")
			return;
		textArea.style.height = "unset";
		// Reset the textarea
		currentMessage.set("");
		addMessage(value, handleTool);
	}
	function handleResize(e)
	{
		var textArea = e.target;
		textArea.style.height = "auto";
		textArea.style.height = textArea.scrollHeight + "px";
	}
	async function scrollToBottom(node)
	{
		await tick();
		node.scrollTop = node.scrollHeight;
		if (!get(aiActivity)) {
			document.getElementById("ai-input")?.focus();
		}
	}
	function scrollMessage(node, messageList)
	{
		// Make sure the messages are always scrolled to the bottom
		scrollToBottom(node);
		return {
			update(messageList) {
				scrollToBottom(node);
			}
		}
	}
	async function handleStop() {
		stopRequested = true;
		await forceStop();
		stopRequested = false;
	}

	async function handleDownload() {
		const messageListElement = document.getElementById('message-list');
		if (!messageListElement) return;
		// Temporarily add padding and background for the list
		messageListElement.classList.add("p-1");
		try {
			const mod = await import('html2canvas-pro');
			const html2canvas = mod.default || mod;
			const canvas = await html2canvas(messageListElement);
			const link = document.createElement('a');
			link.href = canvas.toDataURL('image/png');
			link.download = 'WebVM_Claude.png';
			link.click();
		} finally {
			messageListElement.classList.remove("p-1");
		}
	}

	function toggleThinkingMode() {
		enableThinking.set(!get(enableThinking));
	}
</script>
<h1 class="text-sm font-semibold text-zinc-100 pr-8">Claude AI Integration</h1>
<p class="text-[11px] leading-relaxed text-zinc-400">WebVM is integrated with Claude by Anthropic AI. You can prompt the AI to control the system.</p>
<p class="text-[11px] leading-relaxed text-zinc-400">You need to provide your API key. The key is only saved locally to your browser.</p>
<div class="flex grow flex-col overflow-y-hidden gap-2">
	<div class="flex items-center gap-1.5">
		<span class="mr-auto text-xs font-semibold text-zinc-200">Conversation history</span>
		<SmallButton buttonIcon="fa-solid fa-download" clickHandler={handleDownload} buttonTooltip="Save conversation as image"></SmallButton>
		<SmallButton buttonIcon="fa-solid fa-brain" clickHandler={toggleThinkingMode} buttonTooltip="{$enableThinking ? 'Disable' : 'Enable'} thinking mode" active={$enableThinking}></SmallButton>
		<SmallButton buttonIcon="fa-solid fa-trash-can" clickHandler={clearMessageHistory} buttonTooltip="Clear conversation history"></SmallButton>
	</div>
	<div class="flex grow overflow-y-auto scrollbar rounded-xl border border-white/10 bg-zinc-950/60" use:scrollMessage={$messageList}>
		<div class="h-full w-full">
			<div class="w-full min-h-full flex flex-col gap-2 justify-end p-2.5" id="message-list">
				{#each $messageList as msg}
					{@const details = getMessageDetails(msg)}
					{#if details.isToolUse}
						<p class="rounded-xl border border-white/5 bg-white/5 px-2.5 py-2 text-[11px] text-zinc-400 italic flex items-start gap-2"><i class="fas {details.icon} w-4 pt-0.5 text-center text-zinc-400 shrink-0" aria-hidden="true"></i><span class="min-w-0 break-words">{details.messageContent}</span></p>
					{:else if !details.isToolResult}
						<p class="{msg.role == 'error' ? 'rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-300' : msg.role == 'user' ? 'rounded-xl border border-white/10 bg-white/10 text-zinc-100' : 'rounded-xl border border-white/10 bg-zinc-900/60 text-zinc-200'} px-3 py-2 text-xs whitespace-pre-wrap flex items-start gap-2"><i class="fas {details.icon} w-4 pt-0.5 text-center {msg.role == 'error' ? 'text-rose-400' : 'text-zinc-400'} shrink-0" aria-hidden="true"></i><span class="min-w-0 break-words">{details.messageContent}</span></p>
					{/if}
				{/each}
			</div>
		</div>
	</div>
</div>
{#if $apiState == "KEY_REQUIRED"}
	<div class="rounded-2xl border border-white/10 bg-neutral-900/60 p-2.5 shadow-xs transition-all focus-within:border-white/20 shrink-0">
		<textarea
			class="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500 resize-none focus:outline-none max-h-32 overflow-y-auto scrollbar"
			placeholder="Insert your Claude API Key"
			rows="1"
			on:keydown={handleKeyEnter}
			on:input={handleResize}
			id="ai-input"
		/>
		<div class="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
			<span>Stored locally in browser</span>
			<span class="font-mono">Enter to save</span>
		</div>
	</div>
{:else if $aiActivity}
	{#if stopRequested }
		<PanelButton buttonIcon="fa-solid fa-hand" buttonText="Stopping...">
		</PanelButton>
	{:else}
		<PanelButton buttonIcon="fa-solid fa-hand" clickHandler={handleStop} buttonText="Stop">
		</PanelButton>
	{/if}
{:else}
	<div class="rounded-2xl border border-white/10 bg-neutral-900/60 p-2.5 shadow-xs transition-all focus-within:border-white/20 shrink-0">
		<textarea
			class="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-500 resize-none focus:outline-none max-h-32 overflow-y-auto scrollbar disabled:opacity-50 disabled:cursor-not-allowed"
			placeholder={handleTool === null ? "Waiting for system initialization..." : "Prompt..."}
			rows="1"
			on:keydown={handleMessage}
			on:input={handleResize}
			bind:value={$currentMessage}
			id="ai-input"
			disabled={handleTool === null}
		/>
		<div class="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
			<span>{$enableThinking ? 'Thinking enabled' : 'Claude 3.7 Sonnet'}</span>
			<span class="font-mono">{handleTool === null ? 'Initializing...' : 'Enter to send'}</span>
		</div>
	</div>
{/if}
