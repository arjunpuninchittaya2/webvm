import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createTerminalBatcher,
	createInputWriter,
	registerOsc52Handler,
	applyTerminalModifiers,
	getCodePointDisplayWidth,
	getDisplayWidth
} from '../../src/lib/vm/terminalIO.js';

describe('terminalIO.js batching, UTF-8 chunked input, and OSC-52', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('coalesces queued Uint8Array copies into a single term.write per frame up to maxFlushBytes', () => {
		const writes = [];
		const mockTerm = { write: vi.fn((data) => writes.push(new Uint8Array(data))) };

		let rafCb = null;
		vi.stubGlobal('requestAnimationFrame', (cb) => {
			rafCb = cb;
			return 1;
		});
		vi.stubGlobal('cancelAnimationFrame', vi.fn());

		const batcher = createTerminalBatcher(mockTerm, {
			maxFlushBytes: 64,
			highWaterBytes: 256,
			isHidden: () => false
		});

		const src1 = new Uint8Array([65, 66, 67]); // ABC
		const src2 = new Uint8Array([68, 69]); // DE
		batcher.write(src1);
		// Mutate source buffer after enqueue to verify safe defensive copy
		src1[0] = 90;
		batcher.write(src2);

		expect(mockTerm.write).not.toHaveBeenCalled();
		expect(typeof rafCb).toBe('function');

		rafCb();
		expect(mockTerm.write).toHaveBeenCalledTimes(1);
		expect(Array.from(writes[0])).toEqual([65, 66, 67, 68, 69]);

		batcher.dispose();
		vi.unstubAllGlobals();
	});

	it('copies ArrayBuffer/SharedArrayBuffer defensively, rejects non-iterables, and handles re-entrant setTerminal(null)', () => {
		const writes = [];
		let batcher;
		const term1 = {
			write: vi.fn((data) => {
				writes.push(new Uint8Array(data));
				// Re-entrantly clear terminal during flushAll loop
				batcher.setTerminal(null);
			})
		};
		const term2 = { write: vi.fn((data) => writes.push(new Uint8Array(data))) };

		batcher = createTerminalBatcher(term1, {
			maxFlushBytes: 4,
			highWaterBytes: 100,
			isHidden: () => true
		});

		// Reject non-iterable numbers/objects without queuing
		batcher.write(123);
		batcher.write({});
		expect(batcher.getQueuedBytes()).toBe(0);

		// Defensive ArrayBuffer copy
		const ab = new ArrayBuffer(4);
		const abView = new Uint8Array(ab);
		abView.set([65, 66, 67, 68]);
		batcher.write(ab);
		abView[0] = 90;

		// Defensive SharedArrayBuffer copy if available
		if (typeof SharedArrayBuffer !== 'undefined') {
			const sab = new SharedArrayBuffer(4);
			const sabView = new Uint8Array(sab);
			sabView.set([69, 70, 71, 72]);
			batcher.write(sab);
			sabView[0] = 90;
		}

		// flushAll stops cleanly when term1 re-entrantly calls setTerminal(null)
		expect(() => batcher.flushAll()).not.toThrow();
		expect(Array.from(writes[0])).toEqual([65, 66, 67, 68]);

		if (typeof SharedArrayBuffer !== 'undefined') {
			expect(batcher.getQueuedBytes()).toBe(4);
			// Re-attaching terminal schedules flush of remaining queued bytes
			batcher.setTerminal(term2);
			vi.advanceTimersByTime(50);
			expect(term2.write).toHaveBeenCalledTimes(1);
			expect(Array.from(writes[1])).toEqual([69, 70, 71, 72]);
		}

		batcher.dispose();
	});

	it('triggers immediate bounded-slice flush at highWaterBytes backpressure and bulk printMessage', () => {
		const sliceSizes = [];
		const mockTerm = { write: vi.fn((data) => sliceSizes.push(data.byteLength)) };

		const batcher = createTerminalBatcher(mockTerm, {
			maxFlushBytes: 100,
			highWaterBytes: 250,
			isHidden: () => true
		});

		const bigBuf = new Uint8Array(260).fill(65);
		batcher.write(bigBuf);

		// Immediate flush in slices <= 100 bytes
		expect(sliceSizes).toEqual([100, 100, 60]);
		expect(batcher.getQueuedBytes()).toBe(0);

		mockTerm.write.mockClear();
		batcher.printMessage(['line 1', 'line 2', 'line 3']);
		vi.advanceTimersByTime(50);
		expect(mockTerm.write).toHaveBeenCalledTimes(1);
		const text = new TextDecoder().decode(mockTerm.write.mock.calls[0][0]);
		expect(text).toBe('line 1\nline 2\nline 3\n');

		batcher.dispose();
	});

	it('encodes multi-byte UTF-8 safely via TextEncoder and chunks large pastes in FIFO order', () => {
		const received = [];
		const writer = createInputWriter(() => (b) => received.push(b), {
			chunkSize: 8,
			tickMs: 4
		});

		// Sync fast path for short UTF-8 string ("é€") -> [0xc3, 0xa9, 0xe2, 0x82, 0xac] (5 bytes <= 8)
		writer.write('é€');
		expect(received).toEqual([0xc3, 0xa9, 0xe2, 0x82, 0xac]);

		// Large paste (> 8 bytes) uses FIFO 4ms chunked queue
		received.length = 0;
		writer.write('abcdefghij'); // 10 bytes
		writer.write('1234'); // 4 bytes queued strictly behind
		expect(received.length).toBe(0);

		vi.advanceTimersByTime(4);
		expect(received.length).toBe(8);
		vi.advanceTimersByTime(4);
		expect(new TextDecoder().decode(new Uint8Array(received))).toBe('abcdefghij1234');

		// Raw binary sequences preserve bytes 0x80..0xff without UTF-8 expansion
		received.length = 0;
		writer.sendBinary('\x1b[M\xff');
		expect(received).toEqual([0x1b, 0x5b, 0x4d, 0xff]);

		writer.dispose();
	});

	it('decodes OSC-52 base64 UTF-8 clipboard writes and handles query', () => {
		let registeredCallback = null;
		const mockTerm = {
			parser: {
				registerOscHandler: vi.fn((ident, cb) => {
					expect(ident).toBe(52);
					registeredCallback = cb;
					return { dispose: vi.fn() };
				})
			}
		};

		const onCopy = vi.fn();
		const onQuery = vi.fn();
		const disp = registerOsc52Handler(mockTerm, { onCopy, onQuery });

		// Base64 for "héllo 🚀"
		const b64 = Buffer.from('héllo 🚀', 'utf8').toString('base64');
		expect(registeredCallback(`c;${b64}`)).toBe(true);
		expect(onCopy).toHaveBeenCalledWith('héllo 🚀', 'c');

		expect(registeredCallback('p;?')).toBe(true);
		expect(onQuery).toHaveBeenCalledWith('p');

		// Malformed base64 handled safely without throwing
		expect(registeredCallback('c;!!!not-base64!!!')).toBe(false);

		disp.dispose();
	});

	it('applies Ctrl/Alt terminal modifiers accurately and ignores focus events and pastes', () => {
		expect(applyTerminalModifiers('c', { ctrl: true, alt: false })).toEqual({
			output: '\x03',
			consumedCtrl: true,
			consumedAlt: false
		});
		expect(applyTerminalModifiers(' ', { ctrl: true, alt: false }).output).toBe('\x00');
		expect(applyTerminalModifiers('?', { ctrl: true, alt: false }).output).toBe('\x7f');
		expect(applyTerminalModifiers('/', { ctrl: true, alt: false }).output).toBe('\x1f');
		expect(applyTerminalModifiers('x', { ctrl: false, alt: true })).toEqual({
			output: '\x1bx',
			consumedCtrl: false,
			consumedAlt: true
		});
		expect(applyTerminalModifiers('x', { ctrl: true, alt: true })).toEqual({
			output: '\x1b\x18',
			consumedCtrl: true,
			consumedAlt: true
		});
		// CSI arrows/Home/End, SS3 F1-F4, CSI tilde
		expect(applyTerminalModifiers('\x1b[D', { ctrl: true, alt: false }).output).toBe('\x1b[1;5D');
		expect(applyTerminalModifiers('\x1b[C', { ctrl: false, alt: true }).output).toBe('\x1b[1;3C');
		expect(applyTerminalModifiers('\x1bOP', { ctrl: true, alt: true }).output).toBe('\x1b[1;7P');
		expect(applyTerminalModifiers('\x1b[5~', { ctrl: true, alt: false }).output).toBe('\x1b[5;5~');
		// Focus events & multi-char pastes ignored
		expect(applyTerminalModifiers('\x1b[I', { ctrl: true, alt: true })).toEqual({
			output: '\x1b[I',
			consumedCtrl: false,
			consumedAlt: false
		});
		expect(applyTerminalModifiers('\x1b[O', { ctrl: true, alt: true })).toEqual({
			output: '\x1b[O',
			consumedCtrl: false,
			consumedAlt: false
		});
		expect(applyTerminalModifiers('echo hi', { ctrl: true, alt: true })).toEqual({
			output: 'echo hi',
			consumedCtrl: false,
			consumedAlt: false
		});
	});

	it('computes Unicode display widths for ASCII, wide emojis/CJK, and combining marks', () => {
		expect(getCodePointDisplayWidth('a'.codePointAt(0))).toBe(1);
		expect(getCodePointDisplayWidth('😀'.codePointAt(0))).toBe(2);
		expect(getCodePointDisplayWidth('漢'.codePointAt(0))).toBe(2);
		expect(getCodePointDisplayWidth(0x0301)).toBe(0);
		expect(getDisplayWidth('a😀漢\u0301')).toBe(5);
	});
});
