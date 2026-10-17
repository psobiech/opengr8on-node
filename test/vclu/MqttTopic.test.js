import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MqttTopic, MQTT_TOPIC_FEATURES, MQTT_TOPIC_METHODS, MQTT_TOPIC_EVENTS } from '../../src/vclu/MqttTopic.js';

function makeMockClient() {
  const client = new EventEmitter();
  client.subscriptions = [];
  client.published = [];
  client.subscribe = (topic, _opts, cb) => { client.subscriptions.push(topic); cb?.(null); };
  client.unsubscribe = (topic) => { client.subscriptions = client.subscriptions.filter(t => t !== topic); };
  client.publish = (topic, payload) => { client.published.push({ topic, payload }); };
  return client;
}

function makeMockSystem(mqttClient, cluState = 1) {
  const clu = { state: cluState, getMqttClient: () => mqttClient };
  return { getVirtualClu: () => clu };
}

function awaitMessage(mqttTopic) {
  return new Promise(resolve => {
    mqttTopic.addEventHandler(MQTT_TOPIC_EVENTS.MESSAGE, () => resolve());
  });
}

function makeTopicWithClient(cluState = 1) {
  const client = makeMockClient();
  const system = makeMockSystem(client, cluState);
  const topic = new MqttTopic(system, 'test');
  return { client, system, topic };
}

describe('MqttTopic', () => {
  it('INDEX is 999', () => {
    assert.equal(MqttTopic.INDEX, 999);
  });

  it('initial TOPIC is null', () => {
    const t = new MqttTopic(null, 'test');
    assert.equal(t.get(MQTT_TOPIC_FEATURES.TOPIC), null);
  });

  it('initial MESSAGE is null', () => {
    const t = new MqttTopic(null, 'test');
    assert.equal(t.get(MQTT_TOPIC_FEATURES.MESSAGE), null);
  });

  it('SUBSCRIBE without client returns false', () => {
    const t = new MqttTopic(null, 'test');
    assert.equal(t.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp'), false);
  });

  it('UNSUBSCRIBE without client returns false', () => {
    const t = new MqttTopic(null, 'test');
    assert.equal(t.execute(MQTT_TOPIC_METHODS.UNSUBSCRIBE, 'home/temp'), false);
  });

  it('PUBLISH without client returns false', () => {
    const t = new MqttTopic(null, 'test');
    assert.equal(t.execute(MQTT_TOPIC_METHODS.PUBLISH, 'home/temp', 'hello'), false);
  });

  it('setup() with CLU state OK fires INIT event', () => {
    return new Promise(resolve => {
      const { topic } = makeTopicWithClient(1);
      topic.addEventHandler(MQTT_TOPIC_EVENTS.INIT, () => resolve());
      topic.setup();
    });
  });

  it('setup() with CLU state != OK does not fire INIT event', () => {
    return new Promise((resolve, reject) => {
      const { topic } = makeTopicWithClient(0);
      topic.addEventHandler(MQTT_TOPIC_EVENTS.INIT, () => reject(new Error('INIT fired unexpectedly')));
      topic.setup();
      setTimeout(resolve, 20);
    });
  });

  it('SUBSCRIBE with client calls client.subscribe', () => {
    const { client, topic } = makeTopicWithClient();
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    assert.ok(client.subscriptions.includes('home/temp'));
  });

  it('SUBSCRIBE returns true with client', () => {
    const { topic } = makeTopicWithClient();
    assert.equal(topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp'), true);
  });

  it('UNSUBSCRIBE with client removes subscription', () => {
    const { client, topic } = makeTopicWithClient();
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    topic.execute(MQTT_TOPIC_METHODS.UNSUBSCRIBE, 'home/temp');
    assert.ok(!client.subscriptions.includes('home/temp'));
  });

  it('PUBLISH returns false when target topic is subscribed (loop prevention)', () => {
    const { topic } = makeTopicWithClient();
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    assert.equal(topic.execute(MQTT_TOPIC_METHODS.PUBLISH, 'home/temp', 'x'), false);
  });

  it('PUBLISH returns true for non-subscribed topic', () => {
    const { topic } = makeTopicWithClient();
    assert.equal(topic.execute(MQTT_TOPIC_METHODS.PUBLISH, 'home/other', 'x'), true);
  });

  it('MESSAGE event fires on incoming message', () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    client.emit('message', 'home/temp', Buffer.from('hello'), {});
    return p;
  });

  it('TOPIC feature set to incoming topic', async () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    client.emit('message', 'home/temp', Buffer.from('hello'), {});
    await p;
    assert.equal(topic.get(MQTT_TOPIC_FEATURES.TOPIC), 'home/temp');
  });

  it('MESSAGE feature set to parsed payload', async () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    client.emit('message', 'home/temp', Buffer.from('hello'), {});
    await p;
    assert.equal(topic.get(MQTT_TOPIC_FEATURES.MESSAGE), 'hello');
  });

  it('JSON payload parsed as object', async () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    client.emit('message', 'home/temp', Buffer.from('{"val":42}'), {});
    await p;
    assert.deepEqual(topic.get(MQTT_TOPIC_FEATURES.MESSAGE), { val: 42 });
  });

  it('plain text payload stays as string', async () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    client.emit('message', 'home/temp', Buffer.from('hello'), {});
    await p;
    assert.equal(typeof topic.get(MQTT_TOPIC_FEATURES.MESSAGE), 'string');
  });

  it('number payload parsed as number (42 → 42)', async () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
    client.emit('message', 'home/temp', Buffer.from('42'), {});
    await p;
    assert.equal(topic.get(MQTT_TOPIC_FEATURES.MESSAGE), 42);
  });

  it('exact match: different topic does not fire event', () => {
    return new Promise((resolve, reject) => {
      const { client, topic } = makeTopicWithClient();
      topic.addEventHandler(MQTT_TOPIC_EVENTS.MESSAGE, () => reject(new Error('event fired for non-matching topic')));
      topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
      client.emit('message', 'home/other', Buffer.from('x'), {});
      setTimeout(resolve, 20);
    });
  });

  it('+ wildcard matches single level', async () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/+/temp');
    client.emit('message', 'home/room1/temp', Buffer.from('1'), {});
    await p;
    assert.equal(topic.get(MQTT_TOPIC_FEATURES.TOPIC), 'home/room1/temp');
  });

  it('# wildcard matches multiple levels', async () => {
    const { client, topic } = makeTopicWithClient();
    const p = awaitMessage(topic);
    topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/#');
    client.emit('message', 'home/a/b/c', Buffer.from('1'), {});
    await p;
    assert.equal(topic.get(MQTT_TOPIC_FEATURES.TOPIC), 'home/a/b/c');
  });

  it('depth mismatch: no event fired', () => {
    return new Promise((resolve, reject) => {
      const { client, topic } = makeTopicWithClient();
      topic.addEventHandler(MQTT_TOPIC_EVENTS.MESSAGE, () => reject(new Error('event fired for depth mismatch')));
      topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
      client.emit('message', 'home/a/temp', Buffer.from('x'), {});
      setTimeout(resolve, 20);
    });
  });

  it('close() clears message queue', () => {
    return new Promise((resolve, reject) => {
      const { client, topic } = makeTopicWithClient();
      topic.execute(MQTT_TOPIC_METHODS.SUBSCRIBE, 'home/temp');
      client.emit('message', 'home/temp', Buffer.from('1'), {});
      client.emit('message', 'home/temp', Buffer.from('2'), {});
      topic.close();
      topic.addEventHandler(MQTT_TOPIC_EVENTS.MESSAGE, () => reject(new Error('event fired after close')));
      setTimeout(resolve, 20);
    });
  });
});
