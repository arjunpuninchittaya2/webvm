import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	createTerminalBatcher,
	createInputWriter,
	registerOsc52Handler
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
});
