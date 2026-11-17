const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

export function createTerminalBatcher(term, opts = {}) {
	const maxFlushBytes = opts.maxFlushBytes ?? 65536;
	const highWaterBytes = opts.highWaterBytes ?? 262144;
	const hiddenDelayMs = opts.hiddenDelayMs ?? 50;

	let activeTerm = term;
	let queue = [];
	let queuedBytes = 0;
	let rafId = null;
	let timeoutId = null;
	let disposed = false;

	function isHidden() {
		if (typeof opts.isHidden === 'function') {
			return Boolean(opts.isHidden());
		}
		return typeof document !== 'undefined' ? Boolean(document.hidden) : false;
	}

	function cancelScheduledFlush() {
		if (rafId !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	}

	function scheduleFlush() {
		if (disposed || queuedBytes === 0) return;
		if (rafId !== null || timeoutId !== null) return;

		if (!isHidden() && typeof requestAnimationFrame === 'function') {
			rafId = requestAnimationFrame(() => {
				rafId = null;
				flushSlice();
			});
		} else {
			timeoutId = setTimeout(() => {
				timeoutId = null;
				flushSlice();
			}, hiddenDelayMs);
		}
	}

	function dequeueSlice(limitBytes) {
		if (queue.length === 0 || queuedBytes === 0) return null;

		const first = queue[0];
		if (first.byteLength > limitBytes) {
			const headSlice = first.subarray(0, limitBytes);
			queue[0] = first.subarray(limitBytes);
			queuedBytes -= headSlice.byteLength;
			return headSlice;
		}

		if (queue.length === 1 || first.byteLength === limitBytes) {
			queue.shift();
			queuedBytes -= first.byteLength;
			return first;
		}

		const picked = [];
		let total = 0;
		while (queue.length > 0 && total < limitBytes) {
			const next = queue[0];
			const remaining = limitBytes - total;
			if (next.byteLength <= remaining) {
				picked.push(next);
				total += next.byteLength;
				queue.shift();
			} else {
				picked.push(next.subarray(0, remaining));
				queue[0] = next.subarray(remaining);
				total += remaining;
				break;
			}
		}
		queuedBytes -= total;

		if (picked.length === 1) {
			return picked[0];
		}
		const merged = new Uint8Array(total);
		let offset = 0;
		for (let i = 0; i < picked.length; i++) {
			merged.set(picked[i], offset);
			offset += picked[i].byteLength;
		}
		return merged;
	}

	function flushSlice() {
		if (disposed || !activeTerm || queuedBytes === 0) return;
		const slice = dequeueSlice(maxFlushBytes);
		if (slice && slice.byteLength > 0) {
			activeTerm.write(slice);
		}
		if (!disposed && activeTerm && queuedBytes > 0) {
			scheduleFlush();
		}
	}

	function flushAll() {
		if (disposed || !activeTerm) return;
		cancelScheduledFlush();
		while (!disposed && activeTerm && queuedBytes > 0) {
			const slice = dequeueSlice(maxFlushBytes);
			if (!slice || slice.byteLength === 0) break;
			activeTerm.write(slice);
		}
	}

	function enqueueCopy(copy) {
		if (copy.byteLength === 0) return;
		queue.push(copy);
		queuedBytes += copy.byteLength;

		if (queuedBytes >= highWaterBytes) {
			flushAll();
		} else {
			scheduleFlush();
		}
	}

	function write(buf) {
		if (disposed || buf == null) return;
		let copy;
		if (typeof buf === 'string') {
			if (buf.length === 0) return;
			copy = textEncoder.encode(buf);
		} else if (buf instanceof Uint8Array) {
			if (buf.byteLength === 0) return;
			copy = new Uint8Array(buf);
		} else if (ArrayBuffer.isView(buf)) {
			if (buf.byteLength === 0) return;
			copy = new Uint8Array(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
		} else if (
			buf instanceof ArrayBuffer ||
			(typeof SharedArrayBuffer !== 'undefined' && buf instanceof SharedArrayBuffer)
		) {
			if (buf.byteLength === 0) return;
			copy = new Uint8Array(new Uint8Array(buf));
		} else if (Array.isArray(buf) || typeof buf[Symbol.iterator] === 'function') {
			copy = new Uint8Array(buf);
		} else {
			return;
		}

		enqueueCopy(copy);
	}

	function writeText(text) {
		if (disposed || typeof text !== 'string' || text.length === 0) return;
		enqueueCopy(textEncoder.encode(text));
	}

	function printMessage(lines) {
		if (disposed || !lines) return;
		if (typeof lines === 'string') {
			writeText(lines.endsWith('\n') ? lines : `${lines}\n`);
			return;
		}
		if (!Array.isArray(lines) || lines.length === 0) return;
		writeText(`${lines.join('\n')}\n`);
	}

	function setTerminal(nextTerm) {
		activeTerm = nextTerm;
		if (nextTerm && queuedBytes > 0 && !disposed) {
			scheduleFlush();
		}
	}

	function dispose() {
		disposed = true;
		cancelScheduledFlush();
		queue = [];
		queuedBytes = 0;
		activeTerm = null;
	}

	return {
		write,
		writeText,
		printMessage,
		flush: flushSlice,
		flushAll,
		setTerminal,
		getQueuedBytes: () => queuedBytes,
		dispose
	};
}

export function createInputWriter(getCxReadFunc, opts = {}) {
	const chunkSize = opts.chunkSize ?? 128;
	const tickMs = opts.tickMs ?? 4;

	let queue = [];
	let headOffset = 0;
	let timerId = null;
	let disposed = false;

	function stopTimer() {
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
	}

	function drainTick() {
		timerId = null;
		if (disposed) return;

		const readFunc = typeof getCxReadFunc === 'function' ? getCxReadFunc() : null;
		if (!readFunc) {
			queue = [];
			headOffset = 0;
			return;
		}

		let sent = 0;
		while (queue.length > 0 && sent < chunkSize) {
			const head = queue[0];
			while (headOffset < head.length && sent < chunkSize) {
				readFunc(head[headOffset]);
				headOffset++;
				sent++;
			}
			if (headOffset >= head.length) {
				queue.shift();
				headOffset = 0;
			}
		}

		if (queue.length > 0) {
			timerId = setTimeout(drainTick, tickMs);
		}
	}

	function enqueueBytes(bytes) {
		if (disposed || !bytes || bytes.length === 0) return;
		const readFunc = typeof getCxReadFunc === 'function' ? getCxReadFunc() : null;
		if (!readFunc) return;

		if (queue.length === 0 && bytes.length <= chunkSize) {
			for (let i = 0; i < bytes.length; i++) {
				readFunc(bytes[i]);
			}
			return;
		}

		queue.push(bytes);
		if (timerId === null) {
			timerId = setTimeout(drainTick, tickMs);
		}
	}

	function write(str) {
		if (disposed || typeof str !== 'string' || str.length === 0) return;
		enqueueBytes(textEncoder.encode(str));
	}

	function sendBinary(str) {
		if (disposed || typeof str !== 'string' || str.length === 0) return;
		const bytes = new Uint8Array(str.length);
		for (let i = 0; i < str.length; i++) {
			bytes[i] = str.charCodeAt(i) & 0xff;
		}
		enqueueBytes(bytes);
	}

	function clear() {
		stopTimer();
		queue = [];
		headOffset = 0;
	}

	function getPendingBytes() {
		let total = 0;
		for (let i = 0; i < queue.length; i++) {
			total += i === 0 ? queue[0].length - headOffset : queue[i].length;
		}
		return total;
	}

	function dispose() {
		disposed = true;
		clear();
	}

	return {
		write,
		sendBinary,
		clear,
		getPendingBytes,
		dispose
	};
}

export function decodeBase64Utf8(base64Str) {
	const cleaned = String(base64Str || '').replace(/\s+/g, '');
	if (cleaned.length === 0) return '';
	let binary;
	if (typeof atob === 'function') {
		binary = atob(cleaned);
	} else {
		binary = Buffer.from(cleaned, 'base64').toString('binary');
	}
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i) & 0xff;
	}
	return textDecoder.decode(bytes);
}

export function registerOsc52Handler(term, { onCopy, onQuery } = {}) {
	if (!term?.parser?.registerOscHandler) {
		return { dispose() {} };
	}

	return term.parser.registerOscHandler(52, (data) => {
		if (typeof data !== 'string') return false;
		const sepIdx = data.indexOf(';');
		if (sepIdx === -1) return false;

		const selection = data.slice(0, sepIdx) || 'c';
		const payload = data.slice(sepIdx + 1);

		if (payload === '?') {
			if (typeof onQuery === 'function') {
				onQuery(selection);
			}
			return true;
		}

		try {
			const decoded = decodeBase64Utf8(payload);
			if (typeof onCopy === 'function') {
				onCopy(decoded, selection);
			}
			return true;
		} catch {
			return false;
		}
	});
}

export function applyTerminalModifiers(data, { ctrl = false, alt = false } = {}) {
	if (typeof data !== 'string' || data.length === 0 || (!ctrl && !alt)) {
		return { output: data || '', consumedCtrl: false, consumedAlt: false };
	}

	// Ignore terminal focus reporting events (\x1b[I, \x1b[O)
	if (data === '\x1b[I' || data === '\x1b[O') {
		return { output: data, consumedCtrl: false, consumedAlt: false };
	}

	const mod = 1 + (alt ? 2 : 0) + (ctrl ? 4 : 0);

	// CSI arrow keys and Home/End: \x1b[A..D, \x1b[H, \x1b[F
	const csiCursorMatch = data.match(/^\x1b\[([ABCDHF])$/);
	if (csiCursorMatch) {
		return {
			output: `\x1b[1;${mod}${csiCursorMatch[1]}`,
			consumedCtrl: Boolean(ctrl),
			consumedAlt: Boolean(alt)
		};
	}

	// SS3 F1-F4: \x1bOP..\x1bOS -> \x1b[1;${mod}P..S
	const ss3FnMatch = data.match(/^\x1bO([PQRS])$/);
	if (ss3FnMatch) {
		return {
			output: `\x1b[1;${mod}${ss3FnMatch[1]}`,
			consumedCtrl: Boolean(ctrl),
			consumedAlt: Boolean(alt)
		};
	}

	// CSI tilde keys (PgUp/PgDn/Home/End/Ins/Del/F5-F12): \x1b[N~ -> \x1b[N;${mod}~
	const csiTildeMatch = data.match(/^\x1b\[(\d+)~$/);
	if (csiTildeMatch) {
		return {
			output: `\x1b[${csiTildeMatch[1]};${mod}~`,
			consumedCtrl: Boolean(ctrl),
			consumedAlt: Boolean(alt)
		};
	}

	// Ignore other escape sequences and multi-character pastes
	const codePoints = Array.from(data);
	if (codePoints.length !== 1) {
		return { output: data, consumedCtrl: false, consumedAlt: false };
	}

	const ch = codePoints[0];
	const cp = ch.codePointAt(0);
	if (cp < 0x20) {
		return { output: data, consumedCtrl: false, consumedAlt: false };
	}

	let out = ch;
	let consumedCtrl = false;
	let consumedAlt = false;

	if (ctrl && ch.length === 1) {
		const upperCode = ch.toUpperCase().charCodeAt(0);
		if (upperCode >= 64 && upperCode <= 95) {
			out = String.fromCharCode(upperCode - 64);
			consumedCtrl = true;
		} else if (ch === ' ') {
			out = '\x00';
			consumedCtrl = true;
		} else if (ch === '?') {
			out = '\x7f';
			consumedCtrl = true;
		} else if (ch === '/') {
			out = '\x1f';
			consumedCtrl = true;
		}
	}

	if (alt) {
		out = `\x1b${out}`;
		consumedAlt = true;
	}

	return { output: out, consumedCtrl, consumedAlt };
}

export function getCodePointDisplayWidth(cp) {
	if (!Number.isInteger(cp) || cp < 0) return 0;
	if (cp === 0 || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;

	// Combining marks, zero-width chars, and variation selectors
	if (
		cp === 0x200b ||
		cp === 0x200c ||
		cp === 0x200d ||
		cp === 0xfeff ||
		(cp >= 0x0300 && cp <= 0x036f) ||
		(cp >= 0x1160 && cp <= 0x11ff) ||
		(cp >= 0x1ab0 && cp <= 0x1aff) ||
		(cp >= 0x1dc0 && cp <= 0x1dff) ||
		(cp >= 0x20d0 && cp <= 0x20ff) ||
		(cp >= 0xfe00 && cp <= 0xfe0f) ||
		(cp >= 0xfe20 && cp <= 0xfe2f) ||
		(cp >= 0xe0100 && cp <= 0xe01ef)
	) {
		return 0;
	}

	// Wide East Asian & Emoji characters
	if (
		(cp >= 0x1100 && cp <= 0x115f) ||
		cp === 0x231a ||
		cp === 0x231b ||
		cp === 0x2329 ||
		cp === 0x232a ||
		(cp >= 0x23e9 && cp <= 0x23f3) ||
		(cp >= 0x25fd && cp <= 0x25fe) ||
		(cp >= 0x2614 && cp <= 0x2615) ||
		(cp >= 0x2648 && cp <= 0x2653) ||
		cp === 0x267f ||
		cp === 0x2693 ||
		cp === 0x26a1 ||
		(cp >= 0x26aa && cp <= 0x26ab) ||
		(cp >= 0x26bd && cp <= 0x26be) ||
		(cp >= 0x26c4 && cp <= 0x26c5) ||
		cp === 0x26ce ||
		cp === 0x26d4 ||
		cp === 0x26ea ||
		(cp >= 0x26f2 && cp <= 0x26f3) ||
		cp === 0x26f5 ||
		cp === 0x26fa ||
		cp === 0x26fd ||
		cp === 0x2705 ||
		(cp >= 0x270a && cp <= 0x270b) ||
		cp === 0x2728 ||
		cp === 0x274c ||
		cp === 0x274e ||
		(cp >= 0x2753 && cp <= 0x2755) ||
		cp === 0x2757 ||
		(cp >= 0x2795 && cp <= 0x2797) ||
		cp === 0x27b0 ||
		cp === 0x27bf ||
		(cp >= 0x2b1b && cp <= 0x2b1c) ||
		cp === 0x2b50 ||
		cp === 0x2b55 ||
		(cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
		(cp >= 0xac00 && cp <= 0xd7a3) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0xfe10 && cp <= 0xfe19) ||
		(cp >= 0xfe30 && cp <= 0xfe6f) ||
		(cp >= 0xff00 && cp <= 0xff60) ||
		(cp >= 0xffe0 && cp <= 0xffe6) ||
		(cp >= 0x1f300 && cp <= 0x1faff) ||
		(cp >= 0x20000 && cp <= 0x2fffd) ||
		(cp >= 0x30000 && cp <= 0x3fffd)
	) {
		return 2;
	}

	return 1;
}

export function getDisplayWidth(str) {
	if (typeof str !== 'string' || str.length === 0) return 0;
	let width = 0;
	for (const ch of str) {
		width += getCodePointDisplayWidth(ch.codePointAt(0));
	}
	return width;
}
