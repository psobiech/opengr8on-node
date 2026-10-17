import dgram from 'node:dgram';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
export const TFTP_DEFAULT_PORT = 69;
const BLOCK_SIZE = 512;
const TIMEOUT_MS = 5_000;
const MAX_RETRIES = 3;
const PKT_RRQ = 1;
const PKT_WRQ = 2;
const PKT_DATA = 3;
const PKT_ACK = 4;
const PKT_ERROR = 5;
const ERR_UNDEFINED = 0;
const ERR_NOT_FOUND = 1;
const ERR_ACCESS = 2;
const ERR_ILLEGAL = 4;
const ERR_UNKNOWN_TID = 5;
const ERR_EXISTS = 6;
function ack(block) {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt16BE(PKT_ACK, 0);
    b.writeUInt16BE(block & 0xffff, 2);
    return b;
}
function data(block, chunk) {
    const b = Buffer.allocUnsafe(4 + chunk.length);
    b.writeUInt16BE(PKT_DATA, 0);
    b.writeUInt16BE(block & 0xffff, 2);
    chunk.copy(b, 4);
    return b;
}
function errPkt(code, msg) {
    const msgBuf = Buffer.from(msg + '\0', 'ascii');
    const b = Buffer.allocUnsafe(4 + msgBuf.length);
    b.writeUInt16BE(PKT_ERROR, 0);
    b.writeUInt16BE(code, 2);
    msgBuf.copy(b, 4);
    return b;
}
function parseReq(buf) {
    let pos = 2;
    const fnStart = pos;
    while (pos < buf.length && buf[pos] !== 0)
        pos++;
    const filename = buf.subarray(fnStart, pos).toString('ascii');
    pos++;
    const modeStart = pos;
    while (pos < buf.length && buf[pos] !== 0)
        pos++;
    const mode = buf.subarray(modeStart, pos).toString('ascii').toLowerCase();
    return { filename, mode };
}
function netasciiToOctet(buf) {
    // \r\n → \n, \r\0 → \r  (RFC 783 NETASCII receive)
    const out = [];
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0d) {
            const next = buf[i + 1];
            if (next === 0x0a) {
                out.push(0x0a);
                i++;
            }
            else if (next === 0x00) {
                out.push(0x0d);
                i++;
            }
            else {
                out.push(0x0d);
            }
        }
        else {
            out.push(buf[i]);
        }
    }
    return Buffer.from(out);
}
function octetToNetascii(buf) {
    const out = [];
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) {
            out.push(0x0d, 0x0a);
        }
        else if (buf[i] === 0x0d) {
            out.push(0x0d, 0x00);
        }
        else {
            out.push(buf[i]);
        }
    }
    return Buffer.from(out);
}
function readFile(path) {
    return new Promise((res, rej) => {
        const chunks = [];
        createReadStream(path)
            .on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
            .on('end', () => res(Buffer.concat(chunks)))
            .on('error', rej);
    });
}
function writeFile(path, buf) {
    return new Promise((res, rej) => {
        const ws = createWriteStream(path);
        ws.on('finish', res);
        ws.on('error', rej);
        ws.end(buf);
    });
}
/** Receive one UDP packet from expectedAddr. Returns { msg, port }. */
function recv(sock, timeoutMs, expectedAddr, clientPort) {
    return new Promise((res, rej) => {
        let settled = false;
        const done = (fn) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            sock.removeListener('message', onMsg);
            fn();
        };
        const timer = setTimeout(() => done(() => rej(new Error('timeout'))), timeoutMs);
        const onMsg = (msg, rinfo) => {
            if (settled)
                return;
            if (rinfo.address !== expectedAddr) {
                sock.send(errPkt(ERR_UNKNOWN_TID, 'unknown TID'), rinfo.port, rinfo.address);
                return;
            }
            // If clientPort known, enforce it
            if (clientPort !== null && rinfo.port !== clientPort) {
                sock.send(errPkt(ERR_UNKNOWN_TID, 'unknown TID'), rinfo.port, rinfo.address);
                return;
            }
            done(() => res({ msg, port: rinfo.port }));
        };
        sock.on('message', onMsg);
    });
}
function bindEphemeral() {
    return new Promise((res, rej) => {
        const s = dgram.createSocket('udp4');
        s.once('error', rej);
        s.bind(0, () => {
            s.removeAllListeners('error');
            s.on('error', (e) => console.error('[TFTPServer] transfer socket error:', e));
            res(s);
        });
    });
}
export class TFTPServer {
    _rootDirectory;
    _mode;
    _socket = null;
    _port;
    constructor(rootDirectory, port = TFTP_DEFAULT_PORT, mode = 'GET_AND_REPLACE') {
        this._rootDirectory = resolve(rootDirectory);
        this._port = port;
        this._mode = mode;
    }
    get port() { return this._port; }
    start() {
        return new Promise((res, rej) => {
            const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            this._socket = sock;
            sock.once('error', rej);
            sock.bind(this._port, () => {
                this._port = sock.address().port;
                sock.removeAllListeners('error');
                sock.on('error', (e) => console.error('[TFTPServer] error:', e));
                sock.on('message', (msg, rinfo) => this._onRequest(msg, rinfo.address, rinfo.port));
                res();
            });
        });
    }
    stop() {
        this._socket?.close();
        this._socket = null;
    }
    close() { this.stop(); }
    _onRequest(msg, remoteAddr, remotePort) {
        if (msg.length < 4)
            return;
        const opcode = msg.readUInt16BE(0);
        if (opcode === PKT_RRQ) {
            if (this._mode === 'PUT_ONLY') {
                this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'server is write-only');
                return;
            }
            const { filename, mode } = parseReq(msg);
            const filePath = this._resolvePath(filename);
            if (filePath == null) {
                this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'access denied');
                return;
            }
            if (!existsSync(filePath)) {
                this._errorTo(remoteAddr, remotePort, ERR_NOT_FOUND, 'file not found');
                return;
            }
            void this._sendFile(remoteAddr, remotePort, filePath, mode);
        }
        else if (opcode === PKT_WRQ) {
            if (this._mode === 'GET_ONLY') {
                this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'server is read-only');
                return;
            }
            const { filename, mode } = parseReq(msg);
            const filePath = this._resolvePath(filename);
            if (filePath == null) {
                this._errorTo(remoteAddr, remotePort, ERR_ACCESS, 'access denied');
                return;
            }
            if (this._mode === 'GET_AND_PUT' && existsSync(filePath)) {
                this._errorTo(remoteAddr, remotePort, ERR_EXISTS, 'file exists');
                return;
            }
            void this._receiveFile(remoteAddr, remotePort, filePath, mode);
        }
    }
    /** Resolve a TFTP path within server root. Returns null if outside root. */
    _resolvePath(filename) {
        // Convert Windows path: a:\file.txt or a:/file.txt → a/file.txt
        let normalized = filename.replace(/^([a-z]):[\\\/]/i, '$1/').replace(/\\/g, '/');
        // Strip directory traversal attempts
        normalized = normalized.split('/').filter((p) => p !== '..' && p !== '.').join('/');
        normalized = normalized.replace(/^\/+/, '');
        const full = normalize(resolve(this._rootDirectory, normalized));
        if (full !== this._rootDirectory && !full.startsWith(this._rootDirectory + '/')) {
            return null;
        }
        return full;
    }
    _errorTo(addr, port, code, msg) {
        this._socket?.send(errPkt(code, msg), port, addr);
    }
    /** RRQ: send file to client via ephemeral socket */
    async _sendFile(remoteAddr, remotePort, filePath, mode) {
        const sock = await bindEphemeral();
        const send = (p) => new Promise((r, j) => sock.send(p, remotePort, remoteAddr, (e) => (e ? j(e) : r())));
        try {
            let fileData = await readFile(filePath);
            if (mode === 'netascii')
                fileData = octetToNetascii(fileData);
            // Always at least 1 block; exact multiples of 512 need a trailing zero-length block
            const totalBlocks = Math.floor(fileData.length / BLOCK_SIZE) + 1;
            for (let block = 1; block <= totalBlocks; block++) {
                const offset = (block - 1) * BLOCK_SIZE;
                const chunk = fileData.subarray(offset, Math.min(offset + BLOCK_SIZE, fileData.length));
                const pkt = data(block, chunk);
                let acked = false;
                for (let attempt = 0; attempt < MAX_RETRIES && !acked; attempt++) {
                    await send(pkt);
                    try {
                        const { msg } = await recv(sock, TIMEOUT_MS, remoteAddr, null);
                        if (msg.readUInt16BE(0) === PKT_ACK &&
                            msg.readUInt16BE(2) === (block & 0xffff)) {
                            acked = true;
                        }
                        // duplicate ACK or wrong block: retry
                    }
                    catch {
                        /* timeout — retry */
                    }
                }
                if (!acked) {
                    await send(errPkt(ERR_UNDEFINED, 'timeout waiting for ACK')).catch(() => { });
                    return;
                }
            }
        }
        catch (e) {
            console.error(`[TFTPServer] sendFile error (${filePath}):`, e);
            await send(errPkt(ERR_UNDEFINED, 'server error')).catch(() => { });
        }
        finally {
            sock.close();
        }
    }
    /** WRQ: receive file from client via ephemeral socket */
    async _receiveFile(remoteAddr, remotePort, filePath, mode) {
        const sock = await bindEphemeral();
        const send = (p) => new Promise((r, j) => sock.send(p, remotePort, remoteAddr, (e) => (e ? j(e) : r())));
        const chunks = [];
        try {
            // ACK 0 starts the transfer
            await send(ack(0));
            let block = 1;
            let clientPort = null;
            for (;;) {
                let pkt = null;
                for (let attempt = 0; attempt < MAX_RETRIES && pkt == null; attempt++) {
                    try {
                        const r = await recv(sock, TIMEOUT_MS, remoteAddr, clientPort);
                        pkt = r.msg;
                        if (clientPort == null)
                            clientPort = r.port;
                    }
                    catch {
                        // timeout — retransmit last ACK
                        await send(ack(block - 1)).catch(() => { });
                    }
                }
                if (pkt == null) {
                    await send(errPkt(ERR_UNDEFINED, 'timeout')).catch(() => { });
                    return;
                }
                const opcode = pkt.readUInt16BE(0);
                if (opcode === PKT_ERROR) {
                    const code = pkt.readUInt16BE(2);
                    const msg = pkt.subarray(4, pkt.indexOf(0, 4)).toString('ascii');
                    console.error(`[TFTPServer] client error ${code}: ${msg}`);
                    return;
                }
                if (opcode !== PKT_DATA) {
                    await send(errPkt(ERR_ILLEGAL, 'expected DATA packet')).catch(() => { });
                    return;
                }
                const pktBlock = pkt.readUInt16BE(2);
                const expectedBlock = block & 0xffff;
                if (pktBlock === expectedBlock) {
                    chunks.push(Buffer.from(pkt.subarray(4)));
                    await send(ack(block));
                    const done = pkt.length - 4 < BLOCK_SIZE;
                    block++;
                    if (done)
                        break;
                }
                else if (pktBlock === ((block - 1) & 0xffff)) {
                    // duplicate — re-ack previous
                    await send(ack(block - 1));
                }
                else {
                    await send(errPkt(ERR_ILLEGAL, 'unexpected block number')).catch(() => { });
                    return;
                }
            }
            let fileData = Buffer.concat(chunks);
            if (mode === 'netascii')
                fileData = netasciiToOctet(fileData);
            const dir = dirname(filePath);
            mkdirSync(dir, { recursive: true });
            const tmp = filePath + '.tmp.' + randomBytes(4).toString('hex');
            await writeFile(tmp, fileData);
            renameSync(tmp, filePath);
        }
        catch (e) {
            console.error(`[TFTPServer] receiveFile error (${filePath}):`, e);
            await send(errPkt(ERR_UNDEFINED, 'server error')).catch(() => { });
        }
        finally {
            sock.close();
        }
    }
}
