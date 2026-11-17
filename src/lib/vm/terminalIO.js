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
		if (queuedBytes > 0) {
			scheduleFlush();
		}
	}

	function flushAll() {
		if (disposed || !activeTerm) return;
		cancelScheduledFlush();
		while (queuedBytes > 0) {
			const slice = dequeueSlice(maxFlushBytes);
			if (!slice || slice.byteLength === 0) break;
			activeTerm.write(slice);
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
		} else {
			copy = new Uint8Array(buf);
			if (copy.byteLength === 0) return;
		}

		queue.push(copy);
		queuedBytes += copy.byteLength;

		if (queuedBytes >= highWaterBytes) {
			flushAll();
		} else {
			scheduleFlush();
		}
	}

	function writeText(text) {
		if (disposed || typeof text !== 'string' || text.length === 0) return;
		write(textEncoder.encode(text));
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
