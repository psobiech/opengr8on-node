import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpRequest, HTTP_REQUEST_FEATURES, HTTP_REQUEST_METHODS, HTTP_REQUEST_EVENTS } from '../../dist/vclu/HttpRequest.js';

const F = HTTP_REQUEST_FEATURES;
const M = HTTP_REQUEST_METHODS;
const E = HTTP_REQUEST_EVENTS;

function makeTestServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve({ server, port: server.address().port })
  ));
}

function awaitEvent(obj, eventIndex, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`event ${eventIndex} timeout`)), timeoutMs);
    obj.addEventHandler(eventIndex, () => { clearTimeout(t); resolve(); });
  });
}

describe('HttpRequest', () => {
  it('INDEX is 121', () => {
    assert.equal(HttpRequest.INDEX, 121);
  });

  it('initial state: HOST, PATH, METHOD, TIMEOUT, ACTIVE', () => {
    const req = new HttpRequest(null, 'r');
    assert.equal(req.get(F.HOST), '');
    assert.equal(req.get(F.PATH), '/');
    assert.equal(req.get(F.METHOD), 'GET');
    assert.equal(req.get(F.TIMEOUT), 30);
    assert.equal(req.get(F.ACTIVE), false);
  });

  it('SEND_REQUEST fires REQUEST_SENT event', async () => {
    const { server, port } = await makeTestServer((_req, res) => res.end('{}'));
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    try {
      const p = awaitEvent(req, E.REQUEST_SENT);
      req.execute(M.SEND_REQUEST, null);
      await p;
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('SEND_REQUEST fires RESPONSE event after server responds', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    try {
      const p = awaitEvent(req, E.RESPONSE);
      req.execute(M.SEND_REQUEST, null);
      await p;
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('RESPONSE_STATUS set to server status code', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    try {
      const p = awaitEvent(req, E.RESPONSE);
      req.execute(M.SEND_REQUEST, null);
      await p;
      assert.equal(req.get(F.RESPONSE_STATUS), 200);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('RESPONSE_BODY set after JSON response', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"hello":"world"}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    try {
      const p = awaitEvent(req, E.RESPONSE);
      req.execute(M.SEND_REQUEST, null);
      await p;
      assert.deepEqual(req.get(F.RESPONSE_BODY), { hello: 'world' });
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('RESPONSE_HEADERS not null after response', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    try {
      const p = awaitEvent(req, E.RESPONSE);
      req.execute(M.SEND_REQUEST, null);
      await p;
      const headers = req.get(F.RESPONSE_HEADERS);
      assert.notEqual(headers, null);
      assert.equal(typeof headers, 'object');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('POST request: server sees POST with JSON body', async () => {
    let seenMethod = null;
    let seenBody = '';
    const { server, port } = await makeTestServer((sreq, res) => {
      seenMethod = sreq.method;
      const chunks = [];
      sreq.on('data', c => chunks.push(c));
      sreq.on('end', () => {
        seenBody = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    req.set(F.METHOD, 'POST');
    req.set(F.REQUEST_TYPE, 2);
    req.set(F.REQUEST_BODY, { foo: 'bar' });
    try {
      const p = awaitEvent(req, E.RESPONSE);
      req.execute(M.SEND_REQUEST, null);
      await p;
      assert.equal(seenMethod, 'POST');
      assert.deepEqual(JSON.parse(seenBody), { foo: 'bar' });
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('ABORT_REQUEST clears RESPONSE_STATUS', async () => {
    const { server, port } = await makeTestServer((_req, _res) => {});
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    try {
      req.execute(M.SEND_REQUEST, null);
      req.execute(M.ABORT_REQUEST, null);
      await new Promise(r => setTimeout(r, 200));
      assert.equal(req.get(F.RESPONSE_STATUS), null);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('CLEAR resets RESPONSE_STATUS, RESPONSE_BODY, REQUEST_BODY to null', () => {
    const req = new HttpRequest(null, 'r');
    req.setValue(F.RESPONSE_STATUS, 200);
    req.setValue(F.RESPONSE_BODY, { x: 1 });
    req.setValue(F.REQUEST_BODY, { y: 2 });
    req.execute(M.CLEAR, null);
    assert.equal(req.get(F.RESPONSE_STATUS), null);
    assert.equal(req.get(F.RESPONSE_BODY), null);
    assert.equal(req.get(F.REQUEST_BODY), null);
  });

  it('ACTIVE is false after request completes', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(F.HOST, `http://127.0.0.1:${port}`);
    try {
      const p = awaitEvent(req, E.RESPONSE);
      req.execute(M.SEND_REQUEST, null);
      await p;
      await new Promise(r => setTimeout(r, 50));
      assert.equal(req.get(F.ACTIVE), false);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  it('close() does not throw', () => {
    const req = new HttpRequest(null, 'r');
    assert.doesNotThrow(() => req.close());
  });
});
