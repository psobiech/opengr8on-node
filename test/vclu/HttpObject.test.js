import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HTTP_TYPE,
  httpTypeFromContentType,
  contentTypeForHttpType,
  stringifyBody,
  parseBody,
  urlDecodeQuery,
  urlEncodeObject,
} from '../../src/vclu/HttpObject.js';

describe('HTTP_TYPE', () => {
  it('NONE=0, TEXT=1, JSON=2, XML=3, FORM_DATA=4, OTHER=5', () => {
    assert.equal(HTTP_TYPE.NONE, 0);
    assert.equal(HTTP_TYPE.TEXT, 1);
    assert.equal(HTTP_TYPE.JSON, 2);
    assert.equal(HTTP_TYPE.XML, 3);
    assert.equal(HTTP_TYPE.FORM_DATA, 4);
    assert.equal(HTTP_TYPE.OTHER, 5);
  });
});

describe('httpTypeFromContentType', () => {
  const cases = [
    ['application/json',                HTTP_TYPE.JSON],
    ['application/json; charset=utf-8', HTTP_TYPE.JSON],
    ['text/json',                        HTTP_TYPE.JSON],
    ['Application/JSON',                 HTTP_TYPE.JSON],
    ['application/xml',                  HTTP_TYPE.XML],
    ['text/xml',                         HTTP_TYPE.XML],
    ['text/plain',                       HTTP_TYPE.TEXT],
    ['text/plain; charset=utf-8',        HTTP_TYPE.TEXT],
    ['application/x-www-form-urlencoded', HTTP_TYPE.FORM_DATA],
    ['image/png',                         HTTP_TYPE.OTHER],
    ['multipart/form-data',               HTTP_TYPE.OTHER],
    [null,                                HTTP_TYPE.NONE],
    [undefined,                           HTTP_TYPE.NONE],
    ['',                                  HTTP_TYPE.NONE],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      assert.equal(httpTypeFromContentType(input), expected);
    });
  }
});

describe('contentTypeForHttpType', () => {
  it('JSON → application/json', () => assert.equal(contentTypeForHttpType(HTTP_TYPE.JSON), 'application/json'));
  it('TEXT → text/plain', () => assert.equal(contentTypeForHttpType(HTTP_TYPE.TEXT), 'text/plain'));
  it('XML → application/xml', () => assert.equal(contentTypeForHttpType(HTTP_TYPE.XML), 'application/xml'));
  it('FORM_DATA → application/x-www-form-urlencoded', () => assert.equal(contentTypeForHttpType(HTTP_TYPE.FORM_DATA), 'application/x-www-form-urlencoded'));
  it('NONE → null', () => assert.equal(contentTypeForHttpType(HTTP_TYPE.NONE), null));
  it('OTHER → null', () => assert.equal(contentTypeForHttpType(HTTP_TYPE.OTHER), null));
});

describe('stringifyBody', () => {
  it('NONE → empty string for any value', () => {
    assert.equal(stringifyBody(HTTP_TYPE.NONE, null), '');
    assert.equal(stringifyBody(HTTP_TYPE.NONE, 'anything'), '');
  });

  it('JSON object → JSON.stringify', () => {
    assert.equal(stringifyBody(HTTP_TYPE.JSON, { a: 1 }), '{"a":1}');
  });

  it('JSON array', () => {
    assert.equal(stringifyBody(HTTP_TYPE.JSON, [1, 2, 3]), '[1,2,3]');
  });

  it('JSON null → "null"', () => {
    assert.equal(stringifyBody(HTTP_TYPE.JSON, null), 'null');
  });

  it('TEXT converts to string', () => {
    assert.equal(stringifyBody(HTTP_TYPE.TEXT, 42), '42');
    assert.equal(stringifyBody(HTTP_TYPE.TEXT, true), 'true');
  });

  it('TEXT null → empty string', () => {
    assert.equal(stringifyBody(HTTP_TYPE.TEXT, null), '');
  });

  it('FORM_DATA encodes object', () => {
    const result = stringifyBody(HTTP_TYPE.FORM_DATA, { foo: 'bar', baz: 'qux' });
    const pairs = result.split('&').sort();
    assert.deepEqual(pairs, ['baz=qux', 'foo=bar']);
  });

  it('OTHER → string conversion', () => {
    assert.equal(stringifyBody(HTTP_TYPE.OTHER, 'raw'), 'raw');
  });
});

describe('parseBody', () => {
  it('NONE → null regardless of input', () => {
    assert.equal(parseBody(HTTP_TYPE.NONE, 'anything'), null);
    assert.equal(parseBody(HTTP_TYPE.NONE, ''), null);
  });

  it('JSON valid object', () => {
    assert.deepEqual(parseBody(HTTP_TYPE.JSON, '{"x":1,"y":"hi"}'), { x: 1, y: 'hi' });
  });

  it('JSON valid array', () => {
    assert.deepEqual(parseBody(HTTP_TYPE.JSON, '[1,2,3]'), [1, 2, 3]);
  });

  it('JSON invalid → returns raw string', () => {
    assert.equal(parseBody(HTTP_TYPE.JSON, 'not json'), 'not json');
  });

  it('TEXT string → string', () => {
    assert.equal(parseBody(HTTP_TYPE.TEXT, 'hello world'), 'hello world');
  });

  it('TEXT Buffer → string', () => {
    assert.equal(parseBody(HTTP_TYPE.TEXT, Buffer.from('hello')), 'hello');
  });

  it('FORM_DATA → decoded object', () => {
    assert.deepEqual(parseBody(HTTP_TYPE.FORM_DATA, 'a=1&b=hello'), { a: '1', b: 'hello' });
  });

  it('XML flat → typed object', () => {
    const xml = '<root><num>42</num><str>hello</str><flag>true</flag></root>';
    const result = parseBody(HTTP_TYPE.XML, xml);
    assert.ok(result !== null && typeof result === 'object' && !Array.isArray(result));
    const root = result['root'];
    assert.equal(root['num'], 42);
    assert.equal(root['str'], 'hello');
    assert.equal(root['flag'], true);
  });

  it('XML nested', () => {
    const xml = '<outer><inner><val>99</val></inner></outer>';
    const result = parseBody(HTTP_TYPE.XML, xml);
    assert.ok(result !== null && typeof result === 'object');
    const outer = result['outer'];
    assert.ok(outer !== null && typeof outer === 'object');
    assert.equal(outer['inner']?.['val'], 99);
  });

  it('OTHER → string', () => {
    assert.equal(parseBody(HTTP_TYPE.OTHER, 'raw text'), 'raw text');
  });
});

describe('urlDecodeQuery', () => {
  it('empty string → {}', () => assert.deepEqual(urlDecodeQuery(''), {}));
  it('null → {}', () => assert.deepEqual(urlDecodeQuery(null), {}));
  it('undefined → {}', () => assert.deepEqual(urlDecodeQuery(undefined), {}));

  it('?foo=bar strips leading ?', () => {
    assert.deepEqual(urlDecodeQuery('?foo=bar'), { foo: 'bar' });
  });

  it('key only → { key: "" }', () => {
    assert.deepEqual(urlDecodeQuery('key'), { key: '' });
  });

  it('multiple pairs', () => {
    assert.deepEqual(urlDecodeQuery('a=1&b=2&c=3'), { a: '1', b: '2', c: '3' });
  });

  it('percent-encoded key and value', () => {
    assert.deepEqual(urlDecodeQuery('a%20b=c%2Fd'), { 'a b': 'c/d' });
  });

  it('= in value', () => {
    const result = urlDecodeQuery('key=a%3Db');
    assert.equal(result['key'], 'a=b');
  });
});

describe('urlEncodeObject', () => {
  it('empty object → ""', () => assert.equal(urlEncodeObject({}), ''));
  it('null → ""', () => assert.equal(urlEncodeObject(null), ''));
  it('array → ""', () => assert.equal(urlEncodeObject([]), ''));

  it('single key-value', () => {
    assert.equal(urlEncodeObject({ key: 'value' }), 'key=value');
  });

  it('encodes spaces and slashes', () => {
    assert.equal(urlEncodeObject({ 'a b': 'c/d' }), 'a%20b=c%2Fd');
  });

  it('multiple pairs contain all', () => {
    const result = urlEncodeObject({ a: '1', b: '2' });
    assert.ok(result.includes('a=1'));
    assert.ok(result.includes('b=2'));
    assert.ok(result.includes('&'));
  });
});
