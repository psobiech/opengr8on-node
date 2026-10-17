import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Timer,
  TIMER_MODE,
  TIMER_STATE,
  TIMER_FEATURES,
  TIMER_METHODS,
  TIMER_EVENTS,
} from '../../src/vclu/Timer.js';

function makeTimer() {
  return new Timer(null, 'T');
}

function awaitEvent(timer, eventIndex, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Event ${eventIndex} timeout after ${timeoutMs}ms`)), timeoutMs);
    timer.addEventHandler(eventIndex, () => {
      clearTimeout(t);
      resolve();
    });
  });
}

describe('Timer constants', () => {
  it('INDEX is 6', () => assert.equal(Timer.INDEX, 6));

  it('TIMER_MODE.COUNT_DOWN=0, INTERVAL=1', () => {
    assert.equal(TIMER_MODE.COUNT_DOWN, 0);
    assert.equal(TIMER_MODE.INTERVAL, 1);
  });

  it('TIMER_STATE.STOPPED=0, COUNTING=1, PAUSED=2', () => {
    assert.equal(TIMER_STATE.STOPPED, 0);
    assert.equal(TIMER_STATE.COUNTING, 1);
    assert.equal(TIMER_STATE.PAUSED, 2);
  });
});

describe('Timer initial state', () => {
  it('STATE is STOPPED', () => {
    const t = makeTimer();
    assert.equal(t.get(TIMER_FEATURES.STATE), TIMER_STATE.STOPPED);
    t.close();
  });

  it('TIME defaults to 1000ms', () => {
    const t = makeTimer();
    assert.equal(t.get(TIMER_FEATURES.TIME), 1000);
    t.close();
  });

  it('MODE defaults to COUNT_DOWN', () => {
    const t = makeTimer();
    assert.equal(t.get(TIMER_FEATURES.MODE), TIMER_MODE.COUNT_DOWN);
    t.close();
  });
});

describe('Timer countdown', () => {
  it('STATE becomes COUNTING after start', () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 500);
    t.execute(TIMER_METHODS.START);
    assert.equal(t.get(TIMER_FEATURES.STATE), TIMER_STATE.COUNTING);
    t.close();
  });

  it('fires START event on start', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 300);
    const fired = awaitEvent(t, TIMER_EVENTS.START);
    t.execute(TIMER_METHODS.START);
    await fired;
    t.close();
  });

  it('fires TIMER event and returns to STOPPED', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 50);
    const fired = awaitEvent(t, TIMER_EVENTS.TIMER);
    t.execute(TIMER_METHODS.START);
    await fired;
    assert.equal(t.get(TIMER_FEATURES.STATE), TIMER_STATE.STOPPED);
    t.close();
  });

  it('does not fire TIMER again after countdown finishes', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 50);
    let count = 0;
    t.addEventHandler(TIMER_EVENTS.TIMER, () => count++);
    t.execute(TIMER_METHODS.START);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(count, 1);
    t.close();
  });
});

describe('Timer stop', () => {
  it('fires STOP event', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 500);
    t.execute(TIMER_METHODS.START);
    const stopped = awaitEvent(t, TIMER_EVENTS.STOP);
    t.execute(TIMER_METHODS.STOP);
    await stopped;
    assert.equal(t.get(TIMER_FEATURES.STATE), TIMER_STATE.STOPPED);
    t.close();
  });

  it('stop on already stopped timer does not crash', () => {
    const t = makeTimer();
    assert.doesNotThrow(() => t.execute(TIMER_METHODS.STOP));
    t.close();
  });
});

describe('Timer interval mode', () => {
  it('fires TIMER event multiple times', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 30);
    t.set(TIMER_FEATURES.MODE, TIMER_MODE.INTERVAL);
    let fireCount = 0;
    t.addEventHandler(TIMER_EVENTS.TIMER, () => {
      fireCount++;
      if (fireCount >= 3) t.execute(TIMER_METHODS.STOP);
    });
    t.execute(TIMER_METHODS.START);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('interval timeout')), 3000);
      t.addEventHandler(TIMER_EVENTS.STOP, () => { clearTimeout(timeout); resolve(); });
    });
    assert.ok(fireCount >= 3, `fireCount=${fireCount}`);
    t.close();
  });

  it('STATE stays COUNTING between fires', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 30);
    t.set(TIMER_FEATURES.MODE, TIMER_MODE.INTERVAL);
    let stateOnFire;
    t.addEventHandler(TIMER_EVENTS.TIMER, () => {
      stateOnFire = t.get(TIMER_FEATURES.STATE);
      t.execute(TIMER_METHODS.STOP);
    });
    t.execute(TIMER_METHODS.START);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      t.addEventHandler(TIMER_EVENTS.STOP, () => { clearTimeout(timeout); resolve(); });
    });
    assert.equal(stateOnFire, TIMER_STATE.COUNTING);
    t.close();
  });
});

describe('Timer pause / resume', () => {
  it('pause changes STATE to PAUSED', () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 500);
    t.execute(TIMER_METHODS.START);
    t.execute(TIMER_METHODS.PAUSE);
    assert.equal(t.get(TIMER_FEATURES.STATE), TIMER_STATE.PAUSED);
    t.close();
  });

  it('second pause call resumes to COUNTING', () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 500);
    t.execute(TIMER_METHODS.START);
    t.execute(TIMER_METHODS.PAUSE);
    t.execute(TIMER_METHODS.PAUSE);
    assert.equal(t.get(TIMER_FEATURES.STATE), TIMER_STATE.COUNTING);
    t.close();
  });

  it('fires PAUSE event on pause', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 500);
    t.execute(TIMER_METHODS.START);
    const paused = awaitEvent(t, TIMER_EVENTS.PAUSE);
    t.execute(TIMER_METHODS.PAUSE);
    await paused;
    t.close();
  });

  it('timer does not fire while paused', async () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 50);
    t.execute(TIMER_METHODS.START);
    t.execute(TIMER_METHODS.PAUSE);
    let fired = false;
    t.addEventHandler(TIMER_EVENTS.TIMER, () => { fired = true; });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(fired, false);
    t.close();
  });
});

describe('Timer close', () => {
  it('close clears internal interval without error', () => {
    const t = makeTimer();
    t.set(TIMER_FEATURES.TIME, 500);
    t.execute(TIMER_METHODS.START);
    assert.doesNotThrow(() => t.close());
  });
});
