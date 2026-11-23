import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpRequest, HTTP_REQUEST_FEATURES, HTTP_REQUEST_METHODS, HTTP_REQUEST_EVENTS } from '../../dist/vclu/HttpRequest.js';

const FEATURES = HTTP_REQUEST_FEATURES;
const METHODS = HTTP_REQUEST_METHODS;
const EVENTS = HTTP_REQUEST_EVENTS;

describe('HttpRequest', () => {
  it('INDEX is 121', () => {
    assert.equal(HttpRequest.INDEX, 121);
  });

  it('initial state: HOST, PATH, METHOD, TIMEOUT, ACTIVE', () => {
    const req = new HttpRequest(null, 'r');
    assert.equal(req.get(FEATURES.HOST), '');
    assert.equal(req.get(FEATURES.PATH), '/');
    assert.equal(req.get(FEATURES.METHOD), 'GET');
    assert.equal(req.get(FEATURES.TIMEOUT), 30);
    assert.equal(req.get(FEATURES.ACTIVE), false);
  });

  it('SEND_REQUEST fires REQUEST_SENT event', async () => {
    const { server, port } = await makeTestServer((_req, res) => res.end('{}'));
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    try {
      const eventPromise = awaitEvent(req, EVENTS.REQUEST_SENT);
      req.execute(METHODS.SEND_REQUEST, null);
      await eventPromise;
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('SEND_REQUEST fires RESPONSE event after server responds', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    try {
      const eventPromise = awaitEvent(req, EVENTS.RESPONSE);
      req.execute(METHODS.SEND_REQUEST, null);
      await eventPromise;
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('RESPONSE_STATUS set to server status code', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    try {
      const eventPromise = awaitEvent(req, EVENTS.RESPONSE);
      req.execute(METHODS.SEND_REQUEST, null);
      await eventPromise;
      assert.equal(req.get(FEATURES.RESPONSE_STATUS), 200);
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('RESPONSE_BODY set after JSON response', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"hello":"world"}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    try {
      const eventPromise = awaitEvent(req, EVENTS.RESPONSE);
      req.execute(METHODS.SEND_REQUEST, null);
      await eventPromise;
      assert.deepEqual(req.get(FEATURES.RESPONSE_BODY), { hello: 'world' });
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('RESPONSE_HEADERS not null after response', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    try {
      const eventPromise = awaitEvent(req, EVENTS.RESPONSE);
      req.execute(METHODS.SEND_REQUEST, null);
      await eventPromise;
      const headers = req.get(FEATURES.RESPONSE_HEADERS);
      assert.notEqual(headers, null);
      assert.equal(typeof headers, 'object');
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('POST request: server sees POST with JSON body', async () => {
    let seenMethod = null;
    let seenBody = '';
    const { server, port } = await makeTestServer((sreq, res) => {
      seenMethod = sreq.method;
      const chunks = [];
      sreq.on('data', chunk => chunks.push(chunk));
      sreq.on('end', () => {
        seenBody = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    req.set(FEATURES.METHOD, 'POST');
    req.set(FEATURES.REQUEST_TYPE, 2);
    req.set(FEATURES.REQUEST_BODY, { foo: 'bar' });
    try {
      const eventPromise = awaitEvent(req, EVENTS.RESPONSE);
      req.execute(METHODS.SEND_REQUEST, null);
      await eventPromise;
      assert.equal(seenMethod, 'POST');
      assert.deepEqual(JSON.parse(seenBody), { foo: 'bar' });
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('ABORT_REQUEST clears RESPONSE_STATUS', async () => {
    const { server, port } = await makeTestServer((_req, _res) => {});
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    try {
      req.execute(METHODS.SEND_REQUEST, null);
      req.execute(METHODS.ABORT_REQUEST, null);
      await new Promise(resolveClose => setTimeout(resolveClose, 200));
      assert.equal(req.get(FEATURES.RESPONSE_STATUS), null);
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('CLEAR resets RESPONSE_STATUS, RESPONSE_BODY, REQUEST_BODY to null', () => {
    const req = new HttpRequest(null, 'r');
    req.setValue(FEATURES.RESPONSE_STATUS, 200);
    req.setValue(FEATURES.RESPONSE_BODY, { x: 1 });
    req.setValue(FEATURES.REQUEST_BODY, { y: 2 });
    req.execute(METHODS.CLEAR, null);
    assert.equal(req.get(FEATURES.RESPONSE_STATUS), null);
    assert.equal(req.get(FEATURES.RESPONSE_BODY), null);
    assert.equal(req.get(FEATURES.REQUEST_BODY), null);
  });

  it('ACTIVE is false after request completes', async () => {
    const { server, port } = await makeTestServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const req = new HttpRequest(null, 'r');
    req.set(FEATURES.HOST, `http://127.0.0.1:${port}`);
    try {
      const eventPromise = awaitEvent(req, EVENTS.RESPONSE);
      req.execute(METHODS.SEND_REQUEST, null);
      await eventPromise;
      await new Promise(resolveClose => setTimeout(resolveClose, 50));
      assert.equal(req.get(FEATURES.ACTIVE), false);
    } finally {
      await new Promise(resolveClose => server.close(resolveClose));
    }
  });

  it('close() does not throw', () => {
    const req = new HttpRequest(null, 'r');
    assert.doesNotThrow(() => req.close());
  });
});

function makeTestServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve({ server, port: server.address().port })
  ));
}

function awaitEvent(obj, eventIndex, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => reject(new Error(`event ${eventIndex} timeout`)), timeoutMs);
    obj.addEventHandler(eventIndex, () => { clearTimeout(timeoutHandle); resolve(); });
  });
}
