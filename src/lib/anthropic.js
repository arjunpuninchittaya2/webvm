import { get, writable } from 'svelte/store';
import { browser } from '$app/environment'
import { aiActivity } from '$lib/activities.js'
import { tryPlausible } from '$lib/plausible.js';

var apiKey = null;
var client = null;
var messages = [];
var stopFlag = false;
var lastScreenshot = null;
var screenshotCanvas = null;
var screenshotCtx = null;

async function getClient()
{
	if (client)
		return client;
	if (!apiKey)
		throw new Error('Anthropic API key is not configured');
	const mod = await import('@anthropic-ai/sdk');
	const Anthropic = mod.default || mod.Anthropic || mod;
	client = new Anthropic({ apiKey: apiKey, dangerouslyAllowBrowser: true });
	return client;
}

export function setApiKey(key)
{
	apiKey = key;
	client = null;
	// Reset messages
	messages = [];
	messageList.set(messages);
	try {
		localStorage.setItem("anthropic-api-key", key);
	} catch {
		// Ignore storage errors
	}
	apiState.set("READY");
	tryPlausible("ClaudeAI Key");
}

function clearApiKey()
{
	apiKey = null;
	client = null;
	try {
		localStorage.removeItem("anthropic-api-key");
	} catch {
		// Ignore storage errors
	}
	apiState.set("KEY_REQUIRED");
}

function addMessageInternal(role, content)
{
	messages.push({role: role, content: content});
	messageList.set(messages);
}

const ERROR_PREFIX_RE = /^(?:Error|API Error|Provider returned error):\s*/i;
const TRUNCATED_JSON_RE = /\{\s*(?:"|error\s*:)|"(?:error|message|detail)"\s*:\s*\{/i;
const DEFAULT_JSON_ERROR_FALLBACK = 'Request failed. Please check your API key and try again.';

function safeString(val)
{
	if (val == null)
		return '';
	if (typeof val === 'string')
		return val;
	try
	{
		return String(val);
	}
	catch
	{
		return '';
	}
}

function safeGet(fn)
{
	try
	{
		return fn();
	}
	catch
	{
		return undefined;
	}
}

function stripErrorPrefixes(text)
{
	let out = safeString(text).trim();
	while (ERROR_PREFIX_RE.test(out))
	{
		out = out.replace(ERROR_PREFIX_RE, '').trim();
	}
	return out;
}

function extractMessageFromJsonBlob(text)
{
	const trimmed = safeString(text).trim();
	if (!trimmed.endsWith('}'))
		return null;

	let searchFrom = 0;
	let attempts = 0;
	while (searchFrom < trimmed.length && attempts < 20)
	{
		const idx = trimmed.indexOf('{', searchFrom);
		if (idx === -1)
			break;
		searchFrom = idx + 1;

		const candidate = trimmed.slice(idx);
		if (!/^\{\s*["}]/.test(candidate))
			continue;

		attempts++;
		try
		{
			const parsed = JSON.parse(candidate);
			if (!parsed || typeof parsed !== 'object')
				continue;

			const prefix = trimmed.slice(0, idx).replace(/[:\s]+$/, '').trim();
			const inner =
				(typeof parsed.error?.error?.message === 'string' && parsed.error.error.message) ||
				(typeof parsed.error?.message === 'string' && parsed.error.message) ||
				(typeof parsed.message === 'string' && parsed.message) ||
				(typeof parsed.detail === 'string' && parsed.detail) ||
				(typeof parsed.error_description === 'string' && parsed.error_description) ||
				(typeof parsed.error === 'string' && parsed.error) ||
				'';

			if (inner.trim())
				return inner.trim();
			if (prefix && !/^\d{3}$/.test(prefix))
				return prefix;
			return DEFAULT_JSON_ERROR_FALLBACK;
		}
		catch
		{
			// Not valid JSON starting at this '{'; continue scanning rightward
		}
	}
	return null;
}

export function formatCleanError(err)
{
	if (!err)
		return 'Unknown error';

	let raw = '';
	if (typeof err === 'string')
	{
		raw = err;
	}
	else if (typeof err === 'object')
	{
		const status = safeGet(() => err.status);
		if (status === 401)
			return 'Invalid API key';

		const candidates = [
			safeGet(() => err.error?.error?.message),
			safeGet(() => err.error?.message),
			safeGet(() => err.message),
			safeGet(() => err.detail),
			safeGet(() => (typeof err.error === 'string' ? err.error : undefined))
		];
		for (const c of candidates)
		{
			const s = safeString(c);
			if (s.trim())
			{
				raw = s;
				break;
			}
		}

		if (!raw.trim())
		{
			if (status)
				return `Request failed (HTTP ${safeString(status) || 'error'})`;
			const str = safeString(err);
			raw = str === '[object Object]' ? '' : str;
		}
	}
	else
	{
		raw = safeString(err);
	}

	let cleaned = stripErrorPrefixes(raw);
	for (let depth = 0; depth < 3; depth++)
	{
		const jsonExtracted = extractMessageFromJsonBlob(cleaned);
		if (jsonExtracted === null)
			break;
		const next = stripErrorPrefixes(jsonExtracted);
		if (next === cleaned)
			break;
		cleaned = next;
	}

	const jsonFragmentMatch = TRUNCATED_JSON_RE.exec(cleaned);
	if (jsonFragmentMatch)
	{
		cleaned = cleaned.slice(0, jsonFragmentMatch.index).replace(/[:\s]+$/, '').trim();
		cleaned = stripErrorPrefixes(cleaned);
		if (/^\d{3}$/.test(cleaned))
			return `Request failed (HTTP ${cleaned})`;
	}

	return cleaned || 'Unknown error';
}

async function sendMessages(handleTool)
{
	aiActivity.set(true);
	try
	{
		const activeClient = await getClient();
		while (!stopFlag)
		{
			var dc = get(displayConfig);
			var tool = dc ? { type: "computer_20250124", name: "computer", display_width_px: dc.width, display_height_px: dc.height, display_number: 1 } : { type: "bash_20250124", name: "bash" }
			const config = {
				max_tokens: 2048,
				messages: messages,
				system: "You are running on a virtualized machine. Wait some extra time after all operations to compensate for slowdown.",
				model: 'claude-3-7-sonnet-20250219',
				tools: [tool],
				tool_choice: {type: "auto", disable_parallel_tool_use: true},
				betas: ["computer-use-2025-01-24"]
			};
			if(get(enableThinking))
				config.thinking = { type: "enabled", budget_tokens: 1024 };
			const response = await activeClient.beta.messages.create(config);
			if(stopFlag)
				break;
			// Remove all the image payloads, we don't want to send them over and over again
			for(var i=0;i<messages.length;i++)
			{
				var c = messages[i].content;
				if(Array.isArray(c) && c.length > 0 && c[0]?.type == "tool_result" && Array.isArray(c[0].content) && c[0].content[0]?.type == "image")
					delete c[0].content;
			}
			var content = response.content || [];
			var didToolUse = false;
			// Be robust to multiple response blocks
			for(var i=0;i<content.length;i++)
			{
				var block = content[i];
				if(block.type == "text")
				{
					addMessageInternal(response.role, block.text);
				}
				else if(block.type == "tool_use")
				{
					addMessageInternal(response.role, [block]);
					var commandResponse = await handleTool(block.input);
					var responseObj = {type: "tool_result", tool_use_id: block.id };
					if(commandResponse != null)
					{
						if(commandResponse instanceof Error)
						{
							console.warn(`Tool error: ${commandResponse.message}`);
							responseObj.content = commandResponse.message;
							responseObj.is_error = true;
						}
						else
						{
							responseObj.content = commandResponse;
						}
					}
					addMessageInternal("user", [responseObj]);
					didToolUse = true;
					if(stopFlag)
						break;
				}
				else if(block.type == "thinking")
				{
					addMessageInternal(response.role, [block]);
				}
				else
				{
					console.warn(`Invalid response type: ${block.type}`);
				}
			}
			if(!didToolUse || stopFlag)
			{
				if(response.stop_reason == "end_turn")
					tryPlausible("ClaudeAI Success");
				break;
			}
		}
	}
	catch(e)
	{
		tryPlausible("ClaudeAI Error");
		if(safeGet(() => e?.status) == 401)
		{
			addMessageInternal('error', 'Invalid API key');
			clearApiKey();
		}
		else
		{
			addMessageInternal('error', formatCleanError(e));
		}
	}
	finally
	{
		aiActivity.set(false);
	}
}

export function addMessage(text, handleTool)
{
	addMessageInternal('user', text);
	return sendMessages(handleTool);
}

export function clearMessageHistory() {
	messages.length = 0;
	messageList.set(messages);
}

export function forceStop() {
    stopFlag = true;
    return new Promise((resolve) => {
        const unsubscribe = aiActivity.subscribe((value) => {
            if (!value) {
                unsubscribe();
				stopFlag = false;
                resolve();
            }
        });
    });
}

export function getMessageDetails(msg) {
	const isToolUse = Array.isArray(msg.content) && msg.content[0].type === "tool_use";
	const isToolResult = Array.isArray(msg.content) && msg.content[0].type === "tool_result";
	const isThinking = Array.isArray(msg.content) && msg.content[0].type === "thinking";
	let icon = "";
	let messageContent = "";

	if (isToolUse) {
		let tool = msg.content[0].input;
		if (tool.action === "screenshot") {
			icon = "fa-desktop";
			messageContent = "Screenshot";
		} else if (tool.action === "mouse_move") {
			icon = "fa-mouse-pointer";
			var coords = tool.coordinate;
			messageContent = `Mouse at (${coords[0]}, ${coords[1]})`;
		} else if (tool.action === "left_click") {
			icon = "fa-mouse-pointer";
			var coords = tool.coordinate;
			messageContent = `Left click at (${coords[0]}, ${coords[1]})`;
		} else if (tool.action === "right_click") {
			icon = "fa-mouse-pointer";
			var coords = tool.coordinate;
			messageContent = `Right click at (${coords[0]}, ${coords[1]})`;
		} else if (tool.action === "wait") {
			icon = "fa-hourglass-half";
			messageContent = "Waiting";
		} else if (tool.action === "key") {
			icon = "fa-keyboard";
			messageContent = `Key press: ${tool.text}`;
		} else if (tool.action === "type") {
			icon = "fa-keyboard";
			messageContent = "Type text";
		} else {
			icon = "fa-screwdriver-wrench";
			messageContent = "Use the system";
		}
	} else if (isThinking) {
		icon = "fa-brain";
		messageContent = "Thinking...";
	} else {
		icon = msg.role === "user" ? "fa-user" : "fa-robot";
		messageContent = msg.content;
	}

	return {
		isToolUse,
		isToolResult,
		icon,
		messageContent,
		role: msg.role
	};
}

async function yieldHelper(timeout)
{
	return new Promise(function(f2, r2)
	{
		setTimeout(f2, timeout);
	});
}

async function kmsSendChar(textArea, charStr)
{
	textArea.value = "_" + charStr;
	var ke = new KeyboardEvent("keydown");
	textArea.dispatchEvent(ke);
	var ke = new KeyboardEvent("keyup");
	textArea.dispatchEvent(ke);
	await yieldHelper(0);
}

function getKmsInputElement()
{
	// Find the CheerpX textare, it's attached to the body element
	for(const node of document.body.children)
	{
		if(node.tagName == "TEXTAREA")
			return node;
	}
	return null;
}

export async function handleToolImpl(tool, term)
{
	if(tool.command)
	{
		if(!term)
			return new Error("Error: Terminal is not initialized");
		var sentinel = "# End of AI command";
		var buffer = term.buffer.active;
		// Track the last finalized line with a persistent IMarker so scrollback trimming shifts it safely
		var scannedMarker = term.registerMarker(0);
		var finalizedLines = [];
		var ret = new Promise(function(f, r)
		{
			var callbackDisposer = term.onWriteParsed(function()
			{
				var cursorLine = Math.min(buffer.baseY + buffer.cursorY, buffer.length - 1);
				var scannedUntil = (!scannedMarker || scannedMarker.isDisposed || scannedMarker.line === -1)
					? -1
					: scannedMarker.line;
				var startIdx = Math.max(0, scannedUntil + 1);
				var lastFinalized = scannedUntil;
				for(var i = startIdx; i <= cursorLine; i++)
				{
					var lineObj = buffer.getLine(i);
					if(!lineObj)
						continue;
					var curLine = lineObj.translateToString(true, 0, term.cols);
					if(curLine.indexOf(sentinel) >= 0)
					{
						// We are done, cleanup and return
						callbackDisposer.dispose();
						if(scannedMarker && !scannedMarker.isDisposed)
							scannedMarker.dispose();
						return f(finalizedLines.length > 0 ? finalizedLines.join("\n") + "\n" : "");
					}
					if(i < cursorLine)
					{
						finalizedLines.push(curLine);
						lastFinalized = i;
					}
				}
				if(lastFinalized > scannedUntil)
				{
					if(scannedMarker && !scannedMarker.isDisposed)
						scannedMarker.dispose();
					var currentCursorAbs = buffer.baseY + buffer.cursorY;
					scannedMarker = term.registerMarker(lastFinalized - currentCursorAbs);
				}
			});
		});
		term.input(tool.command);
		term.input("\n");
		term.input(sentinel);
		term.input("\n");
		return ret;
	}
	else if(tool.action)
	{
		// Desktop control
		// TODO: We should have an explicit API to interact with CheerpX display
		switch(tool.action)
		{
			case "screenshot":
			{
				// Insert a 3 seconds delay unconditionally, the reference implementation uses 2
				await yieldHelper(3000);
				var delayCount = 0;
				var display = document.getElementById("display");
				var dc = get(displayConfig);
				if(screenshotCanvas == null)
				{
					screenshotCanvas = document.createElement("canvas");
					screenshotCtx = screenshotCanvas.getContext("2d");
				}
				if(screenshotCanvas.width != dc.width || screenshotCanvas.height != dc.height)
				{
					screenshotCanvas.width = dc.width;
					screenshotCanvas.height = dc.height;
				}
				while(1)
				{
					// Resize the canvas to a Claude compatible size
					screenshotCtx.drawImage(display, 0, 0, display.width, display.height, 0, 0, dc.width, dc.height);
					var dataUrl = screenshotCanvas.toDataURL("image/png");
					if(dataUrl == lastScreenshot)
					{
						// Delay at most 3 times
						if(delayCount < 3)
						{
							// TODO: Defensive message, validate and remove
							console.warn("Identical screenshot, rate limiting");
							delayCount++;
							// Wait some time and retry
							await yieldHelper(5000);
							continue;
						}
					}
					lastScreenshot = dataUrl;
					// Remove prefix from the encoded data
					dataUrl = dataUrl.substring("data:image/png;base64,".length);
					var imageSrc = { type: "base64", media_type: "image/png", data: dataUrl };
					var contentObj = { type: "image", source: imageSrc };
					return [ contentObj ];
				}
			}
			case "mouse_move":
			{
				var coords = tool.coordinate;
				var dc = get(displayConfig);
				var mouseX = coords[0] / dc.mouseMult;
				var mouseY = coords[1] / dc.mouseMult;
				var display = document.getElementById("display");
				var clientRect = display.getBoundingClientRect();
				var me = new MouseEvent('mousemove', { clientX: mouseX + clientRect.left, clientY: mouseY + clientRect.top });
				display.dispatchEvent(me);
				return null;
			}
			case "left_click":
			{
				var coords = tool.coordinate;
				var dc = get(displayConfig);
				var mouseX = coords[0] / dc.mouseMult;
				var mouseY = coords[1] / dc.mouseMult;
				var display = document.getElementById("display");
				var clientRect = display.getBoundingClientRect();
				var me = new MouseEvent('mousedown', { clientX: mouseX + clientRect.left, clientY: mouseY + clientRect.top, button: 0 });
				display.dispatchEvent(me);
				// This delay prevent X11 logic from debouncing the mouseup
				await yieldHelper(60)
				me = new MouseEvent('mouseup', { clientX: mouseX + clientRect.left, clientY: mouseY + clientRect.top, button: 0 });
				display.dispatchEvent(me);
				return null;
			}
			case "right_click":
			{
				var coords = tool.coordinate;
				var dc = get(displayConfig);
				var mouseX = coords[0] / dc.mouseMult;
				var mouseY = coords[1] / dc.mouseMult;
				var display = document.getElementById("display");
				var clientRect = display.getBoundingClientRect();
				var me = new MouseEvent('mousedown', { clientX: mouseX + clientRect.left, clientY: mouseY + clientRect.top, button: 2 });
				display.dispatchEvent(me);
				// This delay prevent X11 logic from debouncing the mouseup
				await yieldHelper(60)
				me = new MouseEvent('mouseup', { clientX: mouseX + clientRect.left, clientY: mouseY + clientRect.top, button: 2 });
				display.dispatchEvent(me);
				return null;
			}
			case "type":
			{
				var str = tool.text;
				return new Promise(async function(f, r)
				{
					var textArea = getKmsInputElement();
					for(var i=0;i<str.length;i++)
					{
						await kmsSendChar(textArea, str[i]);
					}
					f(null);
				});
			}
			case "key":
			{
				var textArea = getKmsInputElement();
				var key = tool.text;
				// Support arbitrary order of modifiers
				var isCtrl = false;
				var isAlt = false;
				var isShift = false;
				while(1)
				{
					if(key.startsWith("shift+"))
					{
						isShift = true;
						key = key.substr("shift+".length);
						var ke = new KeyboardEvent("keydown", {keyCode: 0x10});
						textArea.dispatchEvent(ke);
						await yieldHelper(0);
						continue;
					}
					else if(key.startsWith("ctrl+"))
					{
						isCtrl = true;
						key = key.substr("ctrl+".length);
						var ke = new KeyboardEvent("keydown", {keyCode: 0x11});
						textArea.dispatchEvent(ke);
						await yieldHelper(0);
						continue;
					}
					else if(key.startsWith("alt+"))
					{
						isAlt = true;
						key = key.substr("alt+".length);
						var ke = new KeyboardEvent("keydown", {keyCode: 0x12});
						textArea.dispatchEvent(ke);
						await yieldHelper(0);
						continue;
					}
					break;
				}
				var ret = null;
				// Dispatch single chars directly and parse the rest
				if(key.length == 1)
				{
					await kmsSendChar(textArea, key);
				}
				else
				{
					switch(tool.text)
					{
						case "Return":
							await kmsSendChar(textArea, "\n");
							break;
						case "Escape":
							var ke = new KeyboardEvent("keydown", {keyCode: 0x1b});
							textArea.dispatchEvent(ke);
							await yieldHelper(0);
							ke = new KeyboardEvent("keyup", {keyCode: 0x1b});
							textArea.dispatchEvent(ke);
							await yieldHelper(0);
							break;
						default:
							// TODO: Support more key combinations
							ret = new Error(`Error: Invalid key '${tool.text}'`);
					}
				}
				if(isShift)
				{
					var ke = new KeyboardEvent("keyup", {keyCode: 0x10});
					textArea.dispatchEvent(ke);
					await yieldHelper(0);
				}
				if(isCtrl)
				{
					var ke = new KeyboardEvent("keyup", {keyCode: 0x11});
					textArea.dispatchEvent(ke);
					await yieldHelper(0);
				}
				if(isAlt)
				{
					var ke = new KeyboardEvent("keyup", {keyCode: 0x12});
					textArea.dispatchEvent(ke);
					await yieldHelper(0);
				}
				return ret;
			}
			case "wait":
			{
				// Wait 2x what the machine expects to compensate for virtualization slowdown
				await yieldHelper(tool.duration * 2 * 1000);
				return null;
			}
			default:
			{
				break;
			}
		}
		return new Error("Error: Invalid action");
	}
	else
	{
		// We can get there due to model hallucinations
		return new Error("Error: Invalid tool syntax");
	}
}

function initialize()
{
	try {
		var savedApiKey = localStorage.getItem("anthropic-api-key");
		if(savedApiKey)
		{
			apiKey = savedApiKey;
			apiState.set("READY");
		}
	} catch {
		// Ignore storage errors
	}
}

export const apiState = writable("KEY_REQUIRED");
export const messageList = writable(messages);
export const currentMessage = writable("");
export const displayConfig = writable(null);
export const enableThinking = writable(false);

if(browser)
	initialize();
