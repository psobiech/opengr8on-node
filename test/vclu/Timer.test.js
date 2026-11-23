import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Timer,
  TIMER_MODE,
  TIMER_STATE,
  TIMER_FEATURES,
  TIMER_METHODS,
  TIMER_EVENTS,
} from '../../dist/vclu/Timer.js';

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
    const timer = makeTimer();
    assert.equal(timer.get(TIMER_FEATURES.STATE), TIMER_STATE.STOPPED);
    timer.close();
  });

  it('TIME defaults to 1000ms', () => {
    const timer = makeTimer();
    assert.equal(timer.get(TIMER_FEATURES.TIME), 1000);
    timer.close();
  });

  it('MODE defaults to COUNT_DOWN', () => {
    const timer = makeTimer();
    assert.equal(timer.get(TIMER_FEATURES.MODE), TIMER_MODE.COUNT_DOWN);
    timer.close();
  });
});

describe('Timer countdown', () => {
  it('STATE becomes COUNTING after start', () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 500);
    timer.execute(TIMER_METHODS.START);
    assert.equal(timer.get(TIMER_FEATURES.STATE), TIMER_STATE.COUNTING);
    timer.close();
  });

  it('fires START event on start', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 300);
    const fired = awaitEvent(timer, TIMER_EVENTS.START);
    timer.execute(TIMER_METHODS.START);
    await fired;
    timer.close();
  });

  it('fires TIMER event and returns to STOPPED', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 50);
    const fired = awaitEvent(timer, TIMER_EVENTS.TIMER);
    timer.execute(TIMER_METHODS.START);
    await fired;
    assert.equal(timer.get(TIMER_FEATURES.STATE), TIMER_STATE.STOPPED);
    timer.close();
  });

  it('does not fire TIMER again after countdown finishes', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 50);
    let count = 0;
    timer.addEventHandler(TIMER_EVENTS.TIMER, () => count++);
    timer.execute(TIMER_METHODS.START);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    assert.equal(count, 1);
    timer.close();
  });
});

describe('Timer stop', () => {
  it('fires STOP event', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 500);
    timer.execute(TIMER_METHODS.START);
    const stopped = awaitEvent(timer, TIMER_EVENTS.STOP);
    timer.execute(TIMER_METHODS.STOP);
    await stopped;
    assert.equal(timer.get(TIMER_FEATURES.STATE), TIMER_STATE.STOPPED);
    timer.close();
  });

  it('stop on already stopped timer does not crash', () => {
    const timer = makeTimer();
    assert.doesNotThrow(() => timer.execute(TIMER_METHODS.STOP));
    timer.close();
  });
});

describe('Timer interval mode', () => {
  it('fires TIMER event multiple times', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 30);
    timer.set(TIMER_FEATURES.MODE, TIMER_MODE.INTERVAL);
    let fireCount = 0;
    timer.addEventHandler(TIMER_EVENTS.TIMER, () => {
      fireCount++;
      if (fireCount >= 3) timer.execute(TIMER_METHODS.STOP);
    });
    timer.execute(TIMER_METHODS.START);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('interval timeout')), 3000);
      timer.addEventHandler(TIMER_EVENTS.STOP, () => { clearTimeout(timeout); resolve(); });
    });
    assert.ok(fireCount >= 3, `fireCount=${fireCount}`);
    timer.close();
  });

  it('STATE stays COUNTING between fires', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 30);
    timer.set(TIMER_FEATURES.MODE, TIMER_MODE.INTERVAL);
    let stateOnFire;
    timer.addEventHandler(TIMER_EVENTS.TIMER, () => {
      stateOnFire = timer.get(TIMER_FEATURES.STATE);
      timer.execute(TIMER_METHODS.STOP);
    });
    timer.execute(TIMER_METHODS.START);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 2000);
      timer.addEventHandler(TIMER_EVENTS.STOP, () => { clearTimeout(timeout); resolve(); });
    });
    assert.equal(stateOnFire, TIMER_STATE.COUNTING);
    timer.close();
  });
});

describe('Timer pause / resume', () => {
  it('pause changes STATE to PAUSED', () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 500);
    timer.execute(TIMER_METHODS.START);
    timer.execute(TIMER_METHODS.PAUSE);
    assert.equal(timer.get(TIMER_FEATURES.STATE), TIMER_STATE.PAUSED);
    timer.close();
  });

  it('second pause call resumes to COUNTING', () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 500);
    timer.execute(TIMER_METHODS.START);
    timer.execute(TIMER_METHODS.PAUSE);
    timer.execute(TIMER_METHODS.PAUSE);
    assert.equal(timer.get(TIMER_FEATURES.STATE), TIMER_STATE.COUNTING);
    timer.close();
  });

  it('fires PAUSE event on pause', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 500);
    timer.execute(TIMER_METHODS.START);
    const paused = awaitEvent(timer, TIMER_EVENTS.PAUSE);
    timer.execute(TIMER_METHODS.PAUSE);
    await paused;
    timer.close();
  });

  it('timer does not fire while paused', async () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 50);
    timer.execute(TIMER_METHODS.START);
    timer.execute(TIMER_METHODS.PAUSE);
    let fired = false;
    timer.addEventHandler(TIMER_EVENTS.TIMER, () => { fired = true; });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    assert.equal(fired, false);
    timer.close();
  });
});

describe('Timer close', () => {
  it('close clears internal interval without error', () => {
    const timer = makeTimer();
    timer.set(TIMER_FEATURES.TIME, 500);
    timer.execute(TIMER_METHODS.START);
    assert.doesNotThrow(() => timer.close());
  });
});

function makeTimer() {
  return new Timer(null, 'T');
}

function awaitEvent(timer, eventIndex, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => reject(new Error(`Event ${eventIndex} timeout after ${timeoutMs}ms`)), timeoutMs);
    timer.addEventHandler(eventIndex, () => {
      clearTimeout(timeoutHandle);
      resolve();
    });
  });
}
