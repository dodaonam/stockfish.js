(function () {
  const root = window.LichessCoach;
  const config = root.config;

  function color(value) {
    if (value === 'white' || value === 'w') return 'white';
    if (value === 'black' || value === 'b') return 'black';
    return null;
  }
  function turnColor(ply) { return Number(ply) % 2 === 0 ? 'white' : 'black'; }
  function engineFen(fen, side, ply) {
    const parts = String(fen || '').trim().split(/\s+/);
    if (!parts[0]) return '';
    return `${parts[0]} ${side === 'black' ? 'b' : 'w'} ${parts[2] || '-'} ${parts[3] || '-'} ${parts[4] || '0'} ${parts[5] || Math.max(1, Math.floor((Number(ply) || 0) / 2) + 1)}`;
  }
  function legalDests(value) {
    const map = new Map();
    if (typeof value === 'string') {
      for (const item of value.split(' ')) {
        if (item.length < 4) continue;
        map.set(item.slice(0, 2), item.slice(2).match(/.{2}/g) || []);
      }
    } else if (value && typeof value === 'object') {
      for (const [from, encoded] of Object.entries(value)) {
        if (typeof encoded === 'string') map.set(from, encoded.match(/.{2}/g) || []);
      }
    }
    return map;
  }
  function sameUci(a, b) { return typeof a === 'string' && typeof b === 'string' && a.slice(0, 5) === b.slice(0, 5); }
  function isLegalMove(uci, destinations) {
    if (typeof uci !== 'string' || uci.length < 4 || !(destinations instanceof Map)) return false;
    return (destinations.get(uci.slice(0, 2)) || []).includes(uci.slice(2, 4));
  }
  function guard(data) {
    const variant = data?.game?.variant?.key || null;
    const ai = Number.isInteger(data?.opponent?.ai) || data?.game?.source === 'ai';
    const spectator = !!data?.player?.spectator;
    const standard = variant === 'standard';
    const canCoach = !spectator && (!config.standardOnly || standard) && (!config.strictAiOnly || ai);
    return { variant, ai, spectator, standard, canCoach, reason: spectator ? 'Spectator mode' : !standard ? `Variant ${variant || 'unknown'}` : !ai ? 'Human game' : 'AI game' };
  }
  root.session = {
    async bootstrap(fullId) {
      const response = await fetch(`/${fullId}`, { cache: 'no-cache', credentials: 'same-origin', headers: { Accept: 'application/web.lichess+json', 'X-Requested-With': 'XMLHttpRequest' } });
      if (!response.ok) throw new Error(`Bootstrap failed (${response.status})`);
      const data = await response.json();
      const last = Array.isArray(data.steps) && data.steps.length ? data.steps[data.steps.length - 1] : null;
      const ply = Number.isFinite(last?.ply) ? Number(last.ply) : Number(data?.game?.turns || 0);
      const side = turnColor(ply);
      const myColor = color(data?.player?.color);
      return { fullId, gameId: data?.game?.id || fullId.split('/')[0], myColor, turnColor: side, fen: last?.fen || data?.game?.fen || '', engineFen: engineFen(last?.fen || data?.game?.fen, side, ply), ply, legalDests: side === myColor ? legalDests(data?.possibleMoves) : new Map(), lastMove: last?.uci || null, pendingMove: null, pendingSince: 0, pendingTimer: null, guard: guard(data), status: 'active', desyncReason: null };
    },
    isMyTurn(session) { return !!session && session.turnColor === session.myColor && !session.pendingMove; },
    updateFromMove(session, move) {
      if (!move?.fen || !Number.isFinite(Number(move.ply))) return false;
      session.ply = Number(move.ply); session.turnColor = turnColor(session.ply); session.fen = move.fen;
      session.engineFen = engineFen(session.fen, session.turnColor, session.ply); session.lastMove = move.uci || null;
      session.legalDests = session.turnColor === session.myColor ? legalDests(move.dests) : new Map();
      if (session.pendingMove && (!move.uci || sameUci(session.pendingMove, move.uci))) {
        session.pendingMove = null;
        session.pendingSince = 0;
      } else if (session.pendingMove && session.turnColor === session.myColor) {
        session.pendingMove = null;
        session.pendingSince = 0;
      }
      session.status = 'active';
      session.desyncReason = null;
      return true;
    },
    sameUci,
    isLegalMove,
    parseLegalDests: legalDests
  };
})();
