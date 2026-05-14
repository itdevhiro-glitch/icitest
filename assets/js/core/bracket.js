import { getRoundKeys } from './utils.js';

export function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function createSingleEliminationBracket(participantIds, mode = 'team', defaultFormat = 1) {
  const entries = shuffle(participantIds).map(id => ({ type: 'seed', id }));
  if (entries.length < 2) throw new Error('Minimal 2 peserta untuk membuat bracket.');

  const bracket = {};
  const N = entries.length;
  const P = Math.pow(2, Math.ceil(Math.log2(N)));
  const prelimCount = N - P / 2;
  let cursor = 0;
  let round = 1;
  let nextPool = [];

  if (prelimCount > 0) {
    bracket.r1 = [];
    for (let i = 0; i < prelimCount; i++) {
      const a = entries[cursor++];
      const b = entries[cursor++];
      bracket.r1.push(makeMatch(`r1_m${i + 1}`, a.id, b.id, mode, round, false, false, false, defaultFormat));
      nextPool.push({ type: 'winner', roundKey: 'r1', index: i });
    }
  }

  while (cursor < entries.length) nextPool.push(entries[cursor++]);
  if (!bracket.r1) round = 1; else round = 2;

  while (nextPool.length > 1) {
    const roundKey = `r${round}`;
    const isSemiFinal = nextPool.length === 4;
    const isFinal = nextPool.length === 2;
    bracket[roundKey] = [];
    const futurePool = [];

    for (let i = 0; i < nextPool.length; i += 2) {
      const a = nextPool[i];
      const b = nextPool[i + 1];
      const matchId = `${roundKey}_m${i / 2 + 1}`;
      const match = makeMatch(matchId, a.type === 'seed' ? a.id : null, b.type === 'seed' ? b.id : null, mode, round, isFinal, isSemiFinal, false, defaultFormat);
      bracket[roundKey].push(match);

      if (a.type === 'winner') bracket[a.roundKey][a.index].nextMatchId = matchId;
      if (b.type === 'winner') bracket[b.roundKey][b.index].nextMatchId = matchId;
      futurePool.push({ type: 'winner', roundKey, index: bracket[roundKey].length - 1 });
    }

    if (isSemiFinal) {
      bracket.bronze = [makeMatch('bronze', null, null, mode, round + 1, false, false, true, defaultFormat)];
      bracket[roundKey][0].bronzeMatchId = 'bronze';
      bracket[roundKey][1].bronzeMatchId = 'bronze';
    }

    nextPool = futurePool;
    round++;
  }

  return bracket;
}

function makeMatch(id, teamA, teamB, mode, round, isFinal = false, isSemiFinal = false, isBronze = false, defaultFormat = 1) {
  const format = mode !== 'team' ? 1 : (isFinal ? Math.max(defaultFormat, 5) : (isSemiFinal || isBronze ? Math.max(defaultFormat, 3) : defaultFormat));
  return { id, teamA, teamB, scoreA: 0, scoreB: 0, format, completed: false, winner: null, round, locked: false };
}

export function findMatchLocation(bracket, targetMatchId) {
  for (const roundKey of getRoundKeys(bracket)) {
    const index = bracket[roundKey].findIndex(match => match.id === targetMatchId);
    if (index >= 0) return { roundKey, index };
  }
  return null;
}
