import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetFrame, seekFrame, addrAssignFrame, statusPollFrame,
  versionQueryFrame, forceGetStatusFrame,
  ledCmdFrame, LedCmd,
  moduleCmdFrame,
  activateRecord, deactivateRecord, setPositionRecord,
  setRampTimeRecord, dimmerSetValueRecord, featureParamRecord,
  setChannelValueRecord,
  checkAliveFrame, buzzerBeepFrame, printTextFrame, drawFrame,
} from '../../dist/tfbus/TFBusCommands.js';

describe('universal frames', () => {
  it('resetFrame() broadcast = AA FF 07 52', () => {
    assert.deepEqual(resetFrame(), Buffer.from('aaff0752', 'hex'));
  });

  it('resetFrame(dest) unicast = AA 0A 07 A7', () => {
    assert.deepEqual(resetFrame(0x0A), Buffer.from('aa0a07a7', 'hex'));
  });

  it('seekFrame() = AA FF 2A 7F', () => {
    assert.deepEqual(seekFrame(), Buffer.from('aaff2a7f', 'hex'));
  });

  it('forceGetStatusFrame() = AA FF 0B 5E', () => {
    assert.deepEqual(forceGetStatusFrame(), Buffer.from('aaff0b5e', 'hex'));
  });

  it('addrAssignFrame matches wire capture (SN=0x0EF6243C, CH=1)', () => {
    // Wire-confirmed: AA FF 02 3C 24 F6 0E 01 B6
    assert.deepEqual(
      addrAssignFrame(0x0EF6243C, 1),
      Buffer.from('aaff023c24f60e01b6', 'hex'),
    );
  });

  it('statusPollFrame dest=0x03 is 4 bytes starting AA 03 04', () => {
    const f = statusPollFrame(0x03);
    assert.equal(f.length, 4);
    assert.equal(f[0], 0xAA);
    assert.equal(f[1], 0x03);
    assert.equal(f[2], 0x04);
  });

  it('versionQueryFrame dest=0x01 = AA 01 F9 52', () => {
    assert.deepEqual(versionQueryFrame(0x01), Buffer.from('aa01f952', 'hex'));
  });
});

describe('ledCmdFrame', () => {
  it('ShowOK btn1 = AA 14 18 01 00 00 A7', () => {
    assert.deepEqual(
      ledCmdFrame(0x14, 0x01, LedCmd.SHOW_OK),
      Buffer.from('aa1418010000a7', 'hex'),
    );
  });

  it('ShowError btn4 = AA 14 18 08 00 01 AF', () => {
    assert.deepEqual(
      ledCmdFrame(0x14, 0x08, LedCmd.SHOW_ERROR),
      Buffer.from('aa14180800 01af'.replace(/\s/g, ''), 'hex'),
    );
  });

  it('LedSwitchOn btn4 = AA 14 18 08 00 02 AC', () => {
    assert.deepEqual(
      ledCmdFrame(0x14, 0x08, LedCmd.LED_SWITCH_ON),
      Buffer.from('aa141808000 2ac'.replace(/\s/g, ''), 'hex'),
    );
  });

  it('LedSwitchOff btn4 = AA 14 18 08 00 04 AA', () => {
    assert.deepEqual(
      ledCmdFrame(0x14, 0x08, LedCmd.LED_SWITCH_OFF),
      Buffer.from('aa1418080004aa', 'hex'),
    );
  });
});

describe('moduleCmdFrame', () => {
  it('ACTIVATE (light ON) = AA 03 F0 06 01 08 01 01 80 D6', () => {
    assert.deepEqual(
      moduleCmdFrame(0x03, [activateRecord(0x80)]),
      Buffer.from('aa03f006010801018 0d6'.replace(/\s/g, ''), 'hex'),
    );
  });

  it('DEACTIVATE (light OFF) = AA 03 F0 06 01 09 01 01 80 D7', () => {
    assert.deepEqual(
      moduleCmdFrame(0x03, [deactivateRecord(0x80)]),
      Buffer.from('aa03f0060109010180d7', 'hex'),
    );
  });

  it('DEACTIVATE (roller stop) = AA 07 F0 06 01 09 01 01 30 63', () => {
    assert.deepEqual(
      moduleCmdFrame(0x07, [deactivateRecord(0x30)]),
      Buffer.from('aa07f006010901013063', 'hex'),
    );
  });

  it('SET_POSITION (roller 41%) = AA 07 F0 08 01 16 03 00 00 03 29 6B', () => {
    assert.deepEqual(
      moduleCmdFrame(0x07, [setPositionRecord(0x00, 0x03, 0x29)]),
      Buffer.from('aa07f00801160300000329 6b'.replace(/\s/g, ''), 'hex'),
    );
  });

  it('multi-record increases count byte and plen', () => {
    const frame = moduleCmdFrame(0x03, [
      setRampTimeRecord(0),
      dimmerSetValueRecord(500),
    ]);
    // plen = 2 + (3+5) + (3+3) = 2 + 8 + 6 = 16
    assert.equal(frame[3], 16); // plen byte in payload
    assert.equal(frame[4], 2);  // count=2
  });

  it('setRampTimeRecord encodes LE uint16 in data bytes[1..2]', () => {
    const frame = moduleCmdFrame(0x01, [setRampTimeRecord(512)]);
    // frame: AA dest F0 plen count type len meta data[0..4] CRC
    // f[3]=plen, f[4]=count, f[5]=type(0x06), f[6]=len(5), f[7]=meta(0x00)
    // f[8]=data[0]=0x00, f[9]=data[1]=lo(512), f[10]=data[2]=hi(512)
    assert.equal(frame[9], 0x00);  // ramp ms lo (512 & 0xFF = 0x00)
    assert.equal(frame[10], 0x02); // ramp ms hi (512 >> 8 = 0x02)
  });

  it('setChannelValueRecord uses meta=0x10', () => {
    const frame = moduleCmdFrame(0x05, [setChannelValueRecord(0, 115)]);
    // f[5]=type(0x05), f[6]=len(2), f[7]=meta(0x10)
    assert.equal(frame[7], 0x10);
  });

  it('featureParamRecord encodes val as LE uint16 in data bytes[2..3]', () => {
    const frame = moduleCmdFrame(0x05, [featureParamRecord(0, 1, 3000)]);
    // f[5]=type(0x17), f[6]=len(4), f[7]=meta(0x00)
    // f[8]=idx(0), f[9]=channel(1), f[10]=val_lo(0xB8), f[11]=val_hi(0x0B)
    assert.equal(frame[10], 3000 & 0xFF); // 0xB8
    assert.equal(frame[11], 3000 >> 8);   // 0x0B
  });

  it('throws on empty records array', () => {
    assert.throws(() => moduleCmdFrame(0x01, []), RangeError);
  });
});

describe('TFBUS_CMD frames (0x31)', () => {
  it('checkAliveFrame is 26 bytes', () => {
    assert.equal(checkAliveFrame(0x01).length, 26);
  });

  it('checkAliveFrame frame type byte = 0x31', () => {
    assert.equal(checkAliveFrame(0x05)[2], 0x31);
  });

  it('checkAliveFrame cmd byte = 0x00 at payload[0]', () => {
    assert.equal(checkAliveFrame(0x01)[3], 0x00);
  });

  it('drawFrame is 26 bytes with cmd=0x19', () => {
    const f = drawFrame(0x0A);
    assert.equal(f.length, 26);
    assert.equal(f[3], 0x19);
  });

  it('buzzerBeepFrame encodes freq/dur/vol as LE uint16', () => {
    const f = buzzerBeepFrame(0x0A, 440, 1000, 8);
    // payload: [0x0F, freq_lo, freq_hi, dur_lo, dur_hi, vol_lo, vol_hi, ...]
    assert.equal(f[3], 0x0F); // cmd
    assert.equal(f[4], 440 & 0xFF);    // freq lo = 0xB8
    assert.equal(f[5], 440 >> 8);      // freq hi = 0x01
    assert.equal(f[6], 1000 & 0xFF);   // dur lo = 0xE8
    assert.equal(f[7], 1000 >> 8);     // dur hi = 0x03
    assert.equal(f[8], 8 & 0xFF);      // vol lo = 0x08
    assert.equal(f[9], 8 >> 8);        // vol hi = 0x00
  });

  it('printTextFrame encodes x/y/font and text bytes', () => {
    const f = printTextFrame(0x0A, 0, 1, 2, 'Hello');
    assert.equal(f[3], 0x0A); // cmd
    assert.equal(f[4], 0);    // x
    assert.equal(f[5], 1);    // y
    assert.equal(f[6], 2);    // font
    assert.equal(f[7], 0x48); // 'H'
    assert.equal(f[8], 0x65); // 'e'
  });

  it('printTextFrame truncates text to 16 chars', () => {
    const f = printTextFrame(0x0A, 0, 0, 0, 'A'.repeat(20));
    // text starts at f[7], 16 bytes (f[7]..f[22]), then zeros
    assert.equal(f[7 + 16], 0x00); // byte after 16-char text field = 0
  });
});
