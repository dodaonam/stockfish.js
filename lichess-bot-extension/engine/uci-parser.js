(function () {
  window.LichessCoach.uci = {
    info(message) {
      const depth = /\bdepth\s+(\d+)/.exec(message);
      const multipv = /\bmultipv\s+(\d+)/.exec(message);
      const mate = /\bscore\s+mate\s+(-?\d+)/.exec(message);
      const cp = /\bscore\s+cp\s+(-?\d+)/.exec(message);
      const pv = /\bpv\s+([a-h][1-8][a-h][1-8][nbrq]?(?:\s+[a-h][1-8][a-h][1-8][nbrq]?){0,20})/.exec(message);
      if ((!mate && !cp) || !pv) return null;
      const line = pv[1].trim().split(/\s+/);
      return { depth: Number(depth?.[1] || 0), multipv: Number(multipv?.[1] || 1), scoreType: mate ? 'mate' : 'cp', scoreValue: Number((mate || cp)[1]), move: line[0], pv: line };
    },
    bestMove(message) { return /^bestmove\s+(\S+)/.exec(message)?.[1] || null; }
  };
})();
