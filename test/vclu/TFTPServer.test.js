import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TFTPServer, TFTP_DEFAULT_PORT } from '../../dist/vclu/TFTPServer.js';

// ─── TFTP constants ──────────────────────────────────────────────────────────
const PKT_RRQ   = 1;
const PKT_WRQ   = 2;
const PKT_DATA  = 3;
const PKT_ACK   = 4;
const PKT_ERROR = 5;
const BLOCK_SIZE = 512;

// ─── Packet builders ─────────────────────────────────────────────────────────

function buildReq(opcode, filename) {
  const fn   = Buffer.from(filename + '\0', 'ascii');
  const mode = Buffer.from('octet\0', 'ascii');
  const b    = Buffer.allocUnsafe(2 + fn.length + mode.length);
  b.writeUInt16BE(opcode, 0);
  fn.copy(b, 2);
  mode.copy(b, 2 + fn.length);
  return b;
}

function buildACK(block) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt16BE(PKT_ACK, 0);
  b.writeUInt16BE(block & 0xffff, 2);
  return b;
}

function buildDATA(block, chunk) {
  const b = Buffer.allocUnsafe(4 + chunk.length);
  b.writeUInt16BE(PKT_DATA, 0);
  b.writeUInt16BE(block & 0xffff, 2);
  chunk.copy(b, 4);
  return b;
}

function errCode(msg) {
  const m = msg.message ?? '';
  const match = m.match(/TFTP error (\d+)/);
  return match ? Number(match[1]) : -1;
}

// ─── TFTP client helpers ──────────────────────────────────────────────────────

/**
 * Execute a full TFTP RRQ (read) transfer. Resolves with the received data.
 */
function tftpGet(serverPort, filename, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock   = dgram.createSocket('udp4');
    const chunks = [];
    let nextBlock = 1;
    let settled   = false;

    const done = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.close();
      fn();
    };

    const timer = setTimeout(
      () => done(() => reject(new Error(`tftpGet timeout for ${filename}`))),
      timeoutMs,
    );

    sock.bind(0, () => {
      sock.on('message', (msg, rinfo) => {
        const op = msg.readUInt16BE(0);
        if (op === PKT_ERROR) {
          const code   = msg.readUInt16BE(2);
          const nullAt = msg.indexOf(0, 4);
          const text   = msg.subarray(4, nullAt >= 4 ? nullAt : msg.length).toString();
          done(() => reject(new Error(`TFTP error ${code}: ${text}`)));
          return;
        }
        if (op === PKT_DATA) {
          const block   = msg.readUInt16BE(2);
          const payload = Buffer.from(msg.subarray(4));
          if (block === nextBlock) {
            chunks.push(payload);
            sock.send(buildACK(block), rinfo.port, '127.0.0.1');
            if (payload.length < BLOCK_SIZE) {
              done(() => resolve(Buffer.concat(chunks)));
            } else {
              nextBlock++;
            }
          }
        }
      });
      sock.send(buildReq(PKT_RRQ, filename), serverPort, '127.0.0.1');
    });
  });
}

/**
 * Execute a full TFTP WRQ (write) transfer. Resolves when the server ACKs
 * the last block.
 *
 * Total blocks = floor(data.length / 512) + 1, which handles the
 * zero-padding required when data.length is an exact multiple of 512.
 */
function tftpPut(serverPort, filename, data, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock        = dgram.createSocket('udp4');
    const totalBlocks = Math.floor(data.length / BLOCK_SIZE) + 1;
    let txPort        = null;
    let settled       = false;

    const done = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.close();
      fn();
    };

    const timer = setTimeout(
      () => done(() => reject(new Error(`tftpPut timeout for ${filename}`))),
      timeoutMs,
    );

    const sendBlock = (block) => {
      const offset = (block - 1) * BLOCK_SIZE;
      const chunk  = Buffer.from(data.subarray(offset, offset + BLOCK_SIZE));
      sock.send(buildDATA(block, chunk), txPort, '127.0.0.1');
    };

    sock.bind(0, () => {
      sock.on('message', (msg, rinfo) => {
        const op = msg.readUInt16BE(0);
        if (op === PKT_ERROR) {
          const code   = msg.readUInt16BE(2);
          const nullAt = msg.indexOf(0, 4);
          const text   = msg.subarray(4, nullAt >= 4 ? nullAt : msg.length).toString();
          done(() => reject(new Error(`TFTP error ${code}: ${text}`)));
          return;
        }
        if (op === PKT_ACK) {
          txPort = rinfo.port;
          const ackedBlock = msg.readUInt16BE(2);
          if (ackedBlock < totalBlocks) {
            sendBlock(ackedBlock + 1);
          } else {
            done(() => resolve());
          }
        }
      });
      sock.send(buildReq(PKT_WRQ, filename), serverPort, '127.0.0.1');
    });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TFTPServer', () => {
  it('TFTP_DEFAULT_PORT is 69', () => assert.equal(TFTP_DEFAULT_PORT, 69));

  describe('RRQ (read / download)', () => {
    let tmpRoot;
    let server;

    before(async () => {
      tmpRoot = join(tmpdir(), `vclu-tftp-rrq-${Date.now()}`);
      mkdirSync(tmpRoot, { recursive: true });
      server = new TFTPServer(tmpRoot, 0);
      await server.start();
    });

    after(() => {
      server.stop();
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('server.port is non-zero after start', () => {
      assert.ok(server.port > 0);
    });

    it('downloads a small file', async () => {
      const content = Buffer.from('Hello TFTP World!');
      writeFileSync(join(tmpRoot, 'small.txt'), content);
      const received = await tftpGet(server.port, 'small.txt');
      assert.ok(received.equals(content));
    });

    it('downloads an empty file', async () => {
      writeFileSync(join(tmpRoot, 'empty.bin'), '');
      const received = await tftpGet(server.port, 'empty.bin');
      assert.equal(received.length, 0);
    });

    it('downloads exactly 512 bytes (requires 2 blocks)', async () => {
      const content = Buffer.alloc(512, 0x42);
      writeFileSync(join(tmpRoot, 'exact512.bin'), content);
      const received = await tftpGet(server.port, 'exact512.bin');
      assert.ok(received.equals(content));
    });

    it('downloads a multi-block file (>512 bytes)', async () => {
      const content = Buffer.alloc(1537, 0x55);
      writeFileSync(join(tmpRoot, 'large.bin'), content);
      const received = await tftpGet(server.port, 'large.bin');
      assert.ok(received.equals(content));
    });

    it('returns error code 1 (not found) for missing file', async () => {
      const err = await tftpGet(server.port, 'nonexistent.txt').catch((e) => e);
      assert.ok(err instanceof Error);
      assert.equal(errCode(err), 1);
    });

    it('path traversal sanitized: ../secret.txt resolves inside root (not found)', async () => {
      const err = await tftpGet(server.port, '../secret.txt').catch((e) => e);
      assert.ok(err instanceof Error);
      assert.equal(errCode(err), 1); // sanitized → resolves inside root → NOT FOUND
    });

    it('returns error for ../../etc/passwd', async () => {
      const err = await tftpGet(server.port, '../../etc/passwd').catch((e) => e);
      assert.ok(err instanceof Error);
    });
  });

  describe('WRQ (write / upload)', () => {
    let tmpRoot;
    let server;

    before(async () => {
      tmpRoot = join(tmpdir(), `vclu-tftp-wrq-${Date.now()}`);
      mkdirSync(tmpRoot, { recursive: true });
      server = new TFTPServer(tmpRoot, 0, 'GET_AND_REPLACE');
      await server.start();
    });

    after(() => {
      server.stop();
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('uploads a small file', async () => {
      const data = Buffer.from('Uploaded content');
      await tftpPut(server.port, 'upload.txt', data);
      await new Promise((r) => setTimeout(r, 150));
      const stored = readFileSync(join(tmpRoot, 'upload.txt'));
      assert.ok(stored.equals(data));
    });

    it('uploads an empty file', async () => {
      await tftpPut(server.port, 'empty_up.bin', Buffer.alloc(0));
      await new Promise((r) => setTimeout(r, 150));
      const stored = readFileSync(join(tmpRoot, 'empty_up.bin'));
      assert.equal(stored.length, 0);
    });

    it('uploads exactly 512 bytes', async () => {
      const data = Buffer.alloc(512, 0xAA);
      await tftpPut(server.port, 'exact512_up.bin', data);
      await new Promise((r) => setTimeout(r, 150));
      const stored = readFileSync(join(tmpRoot, 'exact512_up.bin'));
      assert.ok(stored.equals(data));
    });

    it('uploads a multi-block file', async () => {
      const data = Buffer.alloc(1200, 0x55);
      await tftpPut(server.port, 'multi.bin', data);
      await new Promise((r) => setTimeout(r, 150));
      const stored = readFileSync(join(tmpRoot, 'multi.bin'));
      assert.ok(stored.equals(data));
    });

    it('GET_AND_REPLACE allows overwriting existing file', async () => {
      writeFileSync(join(tmpRoot, 'overwrite.txt'), 'old content');
      const newData = Buffer.from('new content');
      await tftpPut(server.port, 'overwrite.txt', newData);
      await new Promise((r) => setTimeout(r, 150));
      const stored = readFileSync(join(tmpRoot, 'overwrite.txt'));
      assert.ok(stored.equals(newData));
    });

    it('path traversal sanitized: ../outside.txt written inside root', async () => {
      await tftpPut(server.port, '../outside.txt', Buffer.from('x'));
      await new Promise((r) => setTimeout(r, 150));
      const stored = readFileSync(join(tmpRoot, 'outside.txt'));
      assert.equal(stored.toString(), 'x');
    });
  });

  describe('Mode restrictions', () => {
    let tmpRoot;
    before(() => {
      tmpRoot = join(tmpdir(), `vclu-tftp-modes-${Date.now()}`);
      mkdirSync(tmpRoot, { recursive: true });
      writeFileSync(join(tmpRoot, 'readable.txt'), 'data');
    });
    after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

    it('GET_ONLY blocks WRQ with error code 2', async () => {
      const s = new TFTPServer(tmpRoot, 0, 'GET_ONLY');
      await s.start();
      try {
        const err = await tftpPut(s.port, 'blocked.txt', Buffer.from('data')).catch((e) => e);
        assert.ok(err instanceof Error);
        assert.equal(errCode(err), 2);
      } finally {
        s.stop();
      }
    });

    it('PUT_ONLY blocks RRQ with error code 2', async () => {
      const s = new TFTPServer(tmpRoot, 0, 'PUT_ONLY');
      await s.start();
      try {
        const err = await tftpGet(s.port, 'readable.txt').catch((e) => e);
        assert.ok(err instanceof Error);
        assert.equal(errCode(err), 2);
      } finally {
        s.stop();
      }
    });

    it('GET_AND_PUT blocks overwrite with error code 6', async () => {
      const s = new TFTPServer(tmpRoot, 0, 'GET_AND_PUT');
      await s.start();
      try {
        const err = await tftpPut(s.port, 'readable.txt', Buffer.from('new')).catch((e) => e);
        assert.ok(err instanceof Error);
        assert.equal(errCode(err), 6);
      } finally {
        s.stop();
      }
    });

    it('GET_AND_PUT allows new file upload', async () => {
      const s = new TFTPServer(tmpRoot, 0, 'GET_AND_PUT');
      await s.start();
      try {
        await tftpPut(s.port, 'new_file.txt', Buffer.from('new file content'));
        await new Promise((r) => setTimeout(r, 150));
        const stored = readFileSync(join(tmpRoot, 'new_file.txt'));
        assert.equal(stored.toString(), 'new file content');
      } finally {
        s.stop();
      }
    });
  });

  describe('Windows path conversion', () => {
    let tmpRoot;
    let server;

    before(async () => {
      tmpRoot = join(tmpdir(), `vclu-tftp-win-${Date.now()}`);
      mkdirSync(join(tmpRoot, 'a'), { recursive: true });
      writeFileSync(join(tmpRoot, 'a', 'file.txt'), 'windows path test');
      server = new TFTPServer(tmpRoot, 0);
      await server.start();
    });

    after(() => {
      server.stop();
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('a:\\file.txt resolves to a/file.txt under root', async () => {
      const received = await tftpGet(server.port, 'a:\\file.txt');
      assert.equal(received.toString(), 'windows path test');
    });

    it('a:/file.txt resolves to a/file.txt under root', async () => {
      const received = await tftpGet(server.port, 'a:/file.txt');
      assert.equal(received.toString(), 'windows path test');
    });
  });

  describe('stop / close', () => {
    it('stop does not throw', async () => {
      const s = new TFTPServer(join(tmpdir(), 'vclu-tftp-stop'), 0);
      await s.start();
      assert.doesNotThrow(() => s.stop());
    });

    it('close is alias for stop', async () => {
      const s = new TFTPServer(join(tmpdir(), 'vclu-tftp-close'), 0);
      await s.start();
      assert.doesNotThrow(() => s.close());
    });
  });
});
