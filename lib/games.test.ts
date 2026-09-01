import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatPointsMatrix,
  GAME_FORMATS,
  MAX_PLACEMENTS,
  parseGameForm,
  parsePointsMatrix,
  pointsForPlacement,
  scoresByWins,
} from './games';

describe('parsePointsMatrix', () => {
  it('parses a comma-separated list into placement keys', () => {
    const result = parsePointsMatrix('100, 70, 50, 30');
    assert.ok(result.ok);
    assert.deepEqual(result.matrix, { '1': 100, '2': 70, '3': 50, '4': 30 });
  });

  it('accepts spaces, tabs, or a mix of separators', () => {
    for (const input of ['100 70 50 30', '100,70,50,30', '100,  70 , 50,30', '100\t70 50,30']) {
      const result = parsePointsMatrix(input);
      assert.ok(result.ok, input);
      assert.deepEqual(result.matrix, { '1': 100, '2': 70, '3': 50, '4': 30 });
    }
  });

  it('handles the 8 placements beer pong needs', () => {
    const result = parsePointsMatrix('200,160,130,100,80,60,40,20');
    assert.ok(result.ok);
    assert.equal(Object.keys(result.matrix).length, 8);
    assert.equal(result.matrix['1'], 200);
    assert.equal(result.matrix['8'], 20);
  });

  it('allows zero points and equal points', () => {
    const result = parsePointsMatrix('10, 10, 0, 0');
    assert.ok(result.ok);
    assert.deepEqual(result.matrix, { '1': 10, '2': 10, '3': 0, '4': 0 });
  });

  it('rejects an empty entry', () => {
    for (const input of ['', '   ', ',,,']) {
      assert.equal(parsePointsMatrix(input).ok, false, JSON.stringify(input));
    }
  });

  it('rejects non-numbers', () => {
    for (const input of ['100, seventy', '100, 70.5', '100, 1e3', 'a,b,c']) {
      const result = parsePointsMatrix(input);
      assert.equal(result.ok, false, input);
    }
  });

  it('rejects negative points', () => {
    assert.equal(parsePointsMatrix('100, -10').ok, false);
  });

  // 1st paying less than 2nd would quietly invert that game's standings.
  it('rejects a matrix where a worse placement pays more', () => {
    const result = parsePointsMatrix('50, 70, 30');
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /pays more/.test(result.error));
  });

  it('rejects more placements than it supports', () => {
    const tooMany = Array.from({ length: MAX_PLACEMENTS + 1 }, () => '10').join(',');
    assert.equal(parsePointsMatrix(tooMany).ok, false);
  });

  it('accepts exactly the maximum', () => {
    const exact = Array.from({ length: MAX_PLACEMENTS }, () => '10').join(',');
    assert.ok(parsePointsMatrix(exact).ok);
  });

  it('round-trips through formatPointsMatrix', () => {
    const parsed = parsePointsMatrix('100, 70, 50, 30');
    assert.ok(parsed.ok);
    assert.equal(formatPointsMatrix(parsed.matrix), '100, 70, 50, 30');
  });

  it('formats placements in numeric order, not string order', () => {
    // "10" sorts before "2" as a string, which would scramble the field.
    const matrix: Record<string, number> = {};
    for (let i = 1; i <= 10; i += 1) matrix[String(i)] = 110 - i * 10;
    assert.equal(formatPointsMatrix(matrix), '100, 90, 80, 70, 60, 50, 40, 30, 20, 10');
  });

  it('formats junk as empty rather than throwing', () => {
    for (const junk of [null, undefined, 'nope', 42, [], {}]) {
      assert.equal(typeof formatPointsMatrix(junk), 'string');
    }
  });
});

describe('pointsForPlacement', () => {
  const matrix = { '1': 100, '2': 70, '3': 50, '4': 30 };

  it('looks up a placement', () => {
    assert.equal(pointsForPlacement(matrix, 1), 100);
    assert.equal(pointsForPlacement(matrix, 4), 30);
  });

  // A bracket can produce more placements than the matrix defines.
  it('is zero beyond the end of the matrix', () => {
    assert.equal(pointsForPlacement(matrix, 5), 0);
    assert.equal(pointsForPlacement(matrix, 99), 0);
  });

  it('is zero for junk instead of throwing', () => {
    for (const junk of [null, undefined, 'nope', 42]) {
      assert.equal(pointsForPlacement(junk, 1), 0);
    }
  });
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

const VALID = {
  name: 'Beer Pong',
  format: 'DOUBLE_ELIM',
  entriesPerTeam: '2',
  pointsMatrix: '200,160,130,100,80,60,40,20',
  entryAggregation: 'SUM',
};

describe('parseGameForm', () => {
  it('accepts a complete beer pong configuration', () => {
    const result = parseGameForm(
      form({ ...VALID, entrySize: '2', station: 'Pong Table — Patio', spansMultipleDays: 'on' }),
    );
    assert.ok(result.ok, !result.ok ? result.errors.join(' | ') : '');
    assert.equal(result.game.name, 'Beer Pong');
    assert.equal(result.game.format, 'DOUBLE_ELIM');
    assert.equal(result.game.entriesPerTeam, 2);
    assert.equal(result.game.entrySize, 2);
    assert.equal(result.game.spansMultipleDays, true);
    assert.equal(result.game.station, 'Pong Table — Patio');
    assert.equal(result.game.pointsMatrix['1'], 200);
  });

  // Round robin scores by wins, so it needs points_per_win and no matrix.
  // Every other format is the other way round. SPEC.md §6.3.
  it('accepts every format with the scoring field that format uses', () => {
    for (const format of GAME_FORMATS) {
      const fields = scoresByWins(format)
        ? { ...VALID, format, pointsMatrix: '', pointsPerWin: '50' }
        : { ...VALID, format };
      const result = parseGameForm(form(fields));
      assert.ok(result.ok, `${format}: ${!result.ok ? result.errors.join(' | ') : ''}`);
      assert.equal(result.game.format, format);

      if (scoresByWins(format)) {
        assert.equal(result.game.pointsPerWin, 50);
        assert.deepEqual(result.game.pointsMatrix, {}, 'a round robin has no matrix');
      } else {
        assert.equal(result.game.pointsPerWin, null);
        assert.equal(result.game.pointsMatrix['1'], 200);
      }
    }
  });

  it('rejects a round robin with no points per win', () => {
    const result = parseGameForm(
      form({ ...VALID, format: 'ROUND_ROBIN', pointsMatrix: '', pointsPerWin: '' }),
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.some((e) => /points per win/i.test(e)));
  });

  it('does not require a points matrix for a round robin', () => {
    const result = parseGameForm(
      form({ ...VALID, format: 'ROUND_ROBIN', pointsMatrix: '', pointsPerWin: '25' }),
    );
    assert.ok(result.ok, !result.ok ? result.errors.join(' | ') : '');
  });

  it('still requires a points matrix for the placement formats', () => {
    for (const format of GAME_FORMATS.filter((f) => !scoresByWins(f))) {
      const result = parseGameForm(
        form({ ...VALID, format, pointsMatrix: '', pointsPerWin: '50' }),
      );
      assert.equal(result.ok, false, `${format} should need a matrix`);
    }
  });

  it('rejects a negative points-per-win', () => {
    const result = parseGameForm(
      form({ ...VALID, format: 'ROUND_ROBIN', pointsMatrix: '', pointsPerWin: '-5' }),
    );
    assert.equal(result.ok, false);
  });

  it('accepts zero points per win', () => {
    const result = parseGameForm(
      form({ ...VALID, format: 'ROUND_ROBIN', pointsMatrix: '', pointsPerWin: '0' }),
    );
    assert.ok(result.ok);
    assert.equal(result.game.pointsPerWin, 0);
  });

  it('defaults entries per team to 1 and sort order to 0', () => {
    const result = parseGameForm(form({ ...VALID, entriesPerTeam: '' }));
    assert.ok(result.ok);
    assert.equal(result.game.entriesPerTeam, 1);
    assert.equal(result.game.sortOrder, 0);
  });

  it('treats an unticked checkbox as false', () => {
    const result = parseGameForm(form(VALID));
    assert.ok(result.ok);
    assert.equal(result.game.spansMultipleDays, false);
  });

  it('requires a name and a valid format', () => {
    assert.equal(parseGameForm(form({ ...VALID, name: '' })).ok, false);
    assert.equal(parseGameForm(form({ ...VALID, name: '   ' })).ok, false);
    assert.equal(parseGameForm(form({ ...VALID, format: 'KNOCKOUT' })).ok, false);
  });

  it('holds scheduled day to 1-3, matching the check constraint', () => {
    assert.equal(parseGameForm(form({ ...VALID, scheduledDay: '0' })).ok, false);
    assert.equal(parseGameForm(form({ ...VALID, scheduledDay: '4' })).ok, false);
    const ok = parseGameForm(form({ ...VALID, scheduledDay: '3' }));
    assert.ok(ok.ok);
    assert.equal(ok.game.scheduledDay, 3);
  });

  it('leaves optional numbers null when blank', () => {
    const result = parseGameForm(form(VALID));
    assert.ok(result.ok);
    assert.equal(result.game.scheduledDay, null);
    assert.equal(result.game.entrySize, null);
    assert.equal(result.game.station, null);
  });

  it('reports every problem at once', () => {
    const result = parseGameForm(
      form({ name: '', format: 'NOPE', entriesPerTeam: 'x', pointsMatrix: 'bad' }),
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.errors.length >= 3, `got ${!result.ok ? result.errors.length : 0}`);
  });

  it('rejects a bad points matrix even when everything else is fine', () => {
    const result = parseGameForm(form({ ...VALID, pointsMatrix: '10, 20, 30' }));
    assert.equal(result.ok, false);
  });
});
