import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { HttpListener, HTTP_LISTENER_FEATURES, HTTP_LISTENER_METHODS, HTTP_LISTENER_EVENTS } from '../../src/vclu/HttpListener.js';
import { HTTP_TYPE } from '../../src/vclu/HttpObject.js';

const F = HTTP_LISTENER_FEATURES;
const M = HTTP_LISTENER_METHODS;
const E = HTTP_LISTENER_EVENTS;

async function makeListener() {
  const listener = new HttpListener(null, 'L', 0);
  await new Promise(r => listener._server.once('listening', r));
  const port = listener._server.address().port;
  return { listener, port };
}

function httpReq(method, port, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyBuf = body != null ? Buffer.from(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { ...headers },
    };
    if (bodyBuf != null) {
      opts.headers['Content-Length'] = String(bodyBuf.length);
    }
    const req = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (bodyBuf != null) req.write(bodyBuf);
    req.end();
  });
}

describe('HttpListener', () => {
  it('INDEX is 120', () => {
    assert.equal(HttpListener.INDEX, 120);
  });

  it('DEFAULT_PORT is 80', () => {
    assert.equal(HttpListener.DEFAULT_PORT, 80);
  });

  it('no REQUEST handler → 404', async () => {
    const { listener, port } = await makeListener();
    try {
      const res = await httpReq('GET', port, '/');
      assert.equal(res.status, 404);
    } finally {
      listener.close();
    }
  });

  it('GET: PATH feature matches request path', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('GET', port, '/hello/world');
      assert.equal(listener.get(F.PATH), '/hello/world');
    } finally {
      listener.close();
    }
  });

  it('GET: METHOD feature is GET', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('GET', port, '/');
      assert.equal(listener.get(F.METHOD), 'GET');
    } finally {
      listener.close();
    }
  });

  it('GET: QUERY feature parsed (foo=bar)', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('GET', port, '/?foo=bar');
      const query = listener.get(F.QUERY);
      assert.equal(query?.foo, 'bar');
    } finally {
      listener.close();
    }
  });

  it('GET: REQUEST_HEADERS not null', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('GET', port, '/');
      assert.notEqual(listener.get(F.REQUEST_HEADERS), null);
    } finally {
      listener.close();
    }
  });

  it('GET: REQUEST_TYPE is NONE for no body', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('GET', port, '/');
      assert.equal(listener.get(F.REQUEST_TYPE), HTTP_TYPE.NONE);
    } finally {
      listener.close();
    }
  });

  it('POST JSON: REQUEST_TYPE is JSON', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('POST', port, '/', JSON.stringify({ x: 1 }), { 'Content-Type': 'application/json' });
      assert.equal(listener.get(F.REQUEST_TYPE), HTTP_TYPE.JSON);
    } finally {
      listener.close();
    }
  });

  it('POST JSON: REQUEST_BODY parsed as object', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('POST', port, '/', JSON.stringify({ hello: 'world' }), { 'Content-Type': 'application/json' });
      const body = listener.get(F.REQUEST_BODY);
      assert.deepEqual(body, { hello: 'world' });
    } finally {
      listener.close();
    }
  });

  it('POST text/plain: REQUEST_TYPE is TEXT', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, null);
      });
      await httpReq('POST', port, '/', 'hello', { 'Content-Type': 'text/plain' });
      assert.equal(listener.get(F.REQUEST_TYPE), HTTP_TYPE.TEXT);
    } finally {
      listener.close();
    }
  });

  it('SEND_RESPONSE sends 200 JSON by default', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.execute(M.SEND_RESPONSE, { ok: true });
      });
      const res = await httpReq('GET', port, '/');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('application/json'));
      assert.deepEqual(JSON.parse(res.body), { ok: true });
    } finally {
      listener.close();
    }
  });

  it('RESPONSE_STATUS set to 201 → response is 201', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.set(F.RESPONSE_STATUS, 201);
        listener.execute(M.SEND_RESPONSE, null);
      });
      const res = await httpReq('POST', port, '/');
      assert.equal(res.status, 201);
    } finally {
      listener.close();
    }
  });

  it('RESPONSE_TYPE TEXT → content-type includes text/plain', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.set(F.RESPONSE_TYPE, HTTP_TYPE.TEXT);
        listener.execute(M.SEND_RESPONSE, 'plain text response');
      });
      const res = await httpReq('GET', port, '/');
      assert.ok(res.headers['content-type']?.includes('text/plain'));
      assert.equal(res.body, 'plain text response');
    } finally {
      listener.close();
    }
  });

  it('CLEAR resets REQUEST_BODY to null and RESPONSE_STATUS to 200', async () => {
    const { listener, port } = await makeListener();
    try {
      listener.addEventHandler(E.REQUEST, () => {
        listener.set(F.RESPONSE_STATUS, 204);
        listener.execute(M.CLEAR);
        listener.execute(M.SEND_RESPONSE, null);
      });
      const res = await httpReq('POST', port, '/', JSON.stringify({ a: 1 }), { 'Content-Type': 'application/json' });
      assert.equal(listener.get(F.REQUEST_BODY), null);
      assert.equal(listener.get(F.RESPONSE_STATUS), 200);
      assert.equal(res.status, 200);
    } finally {
      listener.close();
    }
  });

  it('after close(), server no longer accepts connections', async () => {
    const { listener, port } = await makeListener();
    listener.close();
    try {
      await httpReq('GET', port, '/');
      assert.fail('expected connection error');
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  });
});
