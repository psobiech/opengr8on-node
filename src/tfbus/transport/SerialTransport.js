import { SerialPort } from 'serialport';
// TFBus transport over a USB–RS485 serial adapter.
// Delivers every valid frame observed on the bus. Makes no assumptions about
// addresses, directions, or who is master — callers interpret what they receive.
export class SerialTransport {
    #port;
    #rxBuf = Buffer.alloc(0);
    #rxQueue = [];
    #waiters = [];
    #rxTimeoutMs;
    constructor(path, { baudRate = 115200, rxTimeoutMs = 200 } = {}) {
        this.#rxTimeoutMs = rxTimeoutMs;
        this.#port = new SerialPort({ path, baudRate, autoOpen: false });
        this.#port.on('data', (chunk) => this.#onData(chunk));
        this.#port.on('error', (err) => process.stderr.write(`serial error: ${err.message}\n`));
    }
    open() {
        return new Promise((resolve, reject) => this.#port.open((err) => (err ? reject(err) : resolve())));
    }
    close() {
        for (const w of this.#waiters)
            w(null);
        this.#waiters = [];
        return new Promise((resolve) => this.#port.close(() => resolve()));
    }
    enqueue(buf) {
        this.#port.write(buf);
    }
    dequeue() {
        if (this.#rxQueue.length > 0)
            return Promise.resolve(this.#rxQueue.shift());
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const idx = this.#waiters.indexOf(resolve);
                if (idx >= 0)
                    this.#waiters.splice(idx, 1);
                resolve(null);
            }, this.#rxTimeoutMs);
            this.#waiters.push((buf) => {
                clearTimeout(timer);
                resolve(buf);
            });
        });
    }
    #onData(chunk) {
        this.#rxBuf = Buffer.concat([this.#rxBuf, chunk]);
        this.#consumeFrames();
    }
    #consumeFrames() {
        while (this.#rxBuf.length >= 4) {
            if (this.#rxBuf[0] !== 0xAA) {
                const idx = this.#rxBuf.indexOf(0xAA, 1);
                if (idx < 0) {
                    this.#rxBuf = Buffer.alloc(0);
                    return;
                }
                this.#rxBuf = this.#rxBuf.subarray(idx);
                continue;
            }
            // Candidate lengths: type-table first (protocol-specific), then remaining_len fallback.
            // Trying type-table first avoids misreading known fixed-size frames as variable payloads.
            const typedLen = this.#typedFrameLen();
            const rlLen = Math.max(4, 3 + this.#rxBuf[2]);
            const candidates = typedLen !== null ? [typedLen] : [];
            if (rlLen !== typedLen)
                candidates.push(rlLen);
            let delivered = false;
            for (const len of candidates) {
                if (len > 33)
                    continue;
                if (this.#rxBuf.length < len)
                    return; // need more data
                let xor = 0;
                for (let i = 0; i < len - 1; i++)
                    xor ^= this.#rxBuf[i];
                if (xor === this.#rxBuf[len - 1]) {
                    this.#deliverFrame(Buffer.from(this.#rxBuf.subarray(0, len)));
                    this.#rxBuf = this.#rxBuf.subarray(len);
                    delivered = true;
                    break;
                }
            }
            if (!delivered)
                this.#rxBuf = this.#rxBuf.subarray(1);
        }
    }
    // Known frame lengths by type byte. No address semantics — applies to any frame.
    #typedFrameLen() {
        const type = this.#rxBuf[2];
        switch (type) {
            case 0x02: return 9; // ADDR_ASSIGN
            case 0x04: return 4; // STATUS_POLL
            case 0x07: return 4; // RESET
            case 0x09: return 5; // ADDR_CONFIRM
            case 0x0A: return 4;
            case 0x0B: return 4; // FORCE_GET_STATUS
            case 0x18: return 7; // LED_CMD / WAKE_UP
            case 0x2A: return 4; // SEEK
            case 0x31: return 26; // TFBUS_CMD
            case 0xF9: return 4; // VERSION_QUERY
            case 0xFB: return 25; // PROVISION
            case 0xFD: return 7;
            case 0xFE: return 7;
            case 0xF0: return this.#rxBuf.length >= 4 ? 4 + this.#rxBuf[3] : null; // MODULE_CMD: plen at [3]
            default: return null;
        }
    }
    #deliverFrame(frame) {
        if (this.#waiters.length > 0) {
            this.#waiters.shift()(frame);
        }
        else {
            this.#rxQueue.push(frame);
        }
    }
}
