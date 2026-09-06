/* ============================================================================
   EPINOIA BOX SCORE — GENERATED FILE, DO NOT EDIT.

   Lifted verbatim from epinoia/score/index.html by
   supabase/tests/extract-boxscore.mjs. Edit the scorer, then re-run:

       node supabase/tests/extract-boxscore.mjs

   CI runs it with --check, so this file cannot fall behind the scorer.

   These are the same functions that draw the statistician's final screen, so
   the public box score is not a second implementation that has to be kept in
   agreement — it is the same code over the same event log.

   Callers must supply two globals the scorer provides for itself:
     S        the game state  {teams, starters, period, clockMs, events, …}
     derive() the replayed game, in the shape epinoia/engine.js returns
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaBox = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
'use strict';

/* S and derive are deliberately NOT declared here. The extracted functions
   read them as free variables, so they resolve to whatever the host page has
   defined at call time — the scorer's own state in the scorer, and the
   replayed game in the viewer. Declaring them here would shadow both. */

const PLEN = p => p <= 4 ? 600000 : 300000;

let PMAP = {};         // pid -> {team, p}

const ADV_GROUPS = [
  {key:'scoring', label:'scoring', cols:[
    {k:'fgm',l:'made',f:v=>v.toFixed(0)},
    {k:'ast',l:'ast',f:v=>v.toFixed(0)},
    {k:'pts',l:'pts',f:v=>v.toFixed(0)},
    {k:'ptsAst',l:'+ast',f:v=>v.toFixed(0)},
    {k:'tpc',l:'tpc',f:v=>v.toFixed(0),bar:'mins'},
    {k:'ppp',l:'ppp',f:v=>v.toFixed(2),bar:'shooting',sep:true}]},
  {key:'usage', label:'usage', cols:[
    {k:'usg',l:'usg',f:v=>v.toFixed(1),bar:'mins'},
    {k:'au',l:'a/u',f:v=>v.toFixed(2),bar:'playmaking'},
    {k:'min',l:'min',f:(v,r)=>r.minTxt,bar:'mins',sep:true}]},
  {key:'shotdist', label:'shot distribution', cols:[
    {k:'rimA',l:'rim',f:v=>v.toFixed(0),shot:true},
    {k:'rimP',l:'rim%',f:v=>v.toFixed(0)},
    {k:'midA',l:'mid',f:v=>v.toFixed(0),shot:true},
    {k:'midP',l:'mid%',f:v=>v.toFixed(0)},
    {k:'p3a',l:'3pt',f:v=>v.toFixed(0),shot:true},
    {k:'p3P',l:'3pt%',f:v=>v.toFixed(0),sep:true}]},
  {key:'offcourt', label:'offensive on-court', cols:[
    {k:'ocOrtg',l:'ortg',diff:'ortg'},
    {k:'ocEfg',l:'efg',diff:'efg'},
    {k:'ocOreb',l:'orb%',diff:'orebp'},
    {k:'ocTov',l:'tov%',diff:'tovp',inv:true},
    /* pace with the player on minus pace with them off (both teams' possessions per 40) */
    {k:'pacePM',l:'pace±',pill:true,dec:1,sep:true}]},
  {key:'defcourt', label:'defensive on-court', cols:[
    {k:'ocDrtg',l:'drtg',diff:'ortg',inv:true},
    {k:'ocOppEfg',l:'opp efg',diff:'efg',inv:true},
    {k:'ocOppOreb',l:'opp orb',diff:'orebp',inv:true},
    {k:'ocTovF',l:'tov frc',diff:'tovp'},
    {k:'net',l:'net',pill:true,sep:true}]},
  {key:'individual', label:'individual', cols:[
    {k:'ts',l:'ts%',f:v=>v.toFixed(1),bar:'shooting'},
    {k:'astPct',l:'ast%',f:v=>v.toFixed(1),bar:'playmaking'},
    {k:'tovP',l:'to%',f:v=>v.toFixed(1),bar:'handling',invbar:true},
    {k:'stlP',l:'stl%',f:v=>v.toFixed(1),bar:'defense'},
    {k:'blkP',l:'blk%',f:v=>v.toFixed(1),bar:'defense'},
    {k:'ftr',l:'ft rate',f:v=>v.toFixed(0),bar:'shooting'},
    {k:'orebP',l:'orb%',f:v=>v.toFixed(1),bar:'rebounding'},
    {k:'drebP',l:'drb%',f:v=>v.toFixed(1),bar:'rebounding'}]}
];

let advSort = {k:'min', dir:-1}, advHidden = new Set();

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

const COLOUR_OK = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([0-9eE.,%\/\s+-]+\)|var\(--[a-z0-9-]+\))$/i;

function safeColour(v, fallback){
  /* NOTHING BUT A COLOUR REACHES A STYLE ATTRIBUTE.

     Names in this file all go through esc(). Club colours did not: they were
     concatenated straight into style="color:'+c+'" in strings handed to
     innerHTML. The value comes from teams.colour, and neither the column nor
     admin_update_team validated it — that function checks the slug against a
     pattern and writes the colour through untouched. So a league administrator
     could store

         #fff" onmouseover="...

     and every visitor to any box score in that league would be served the
     markup, on the public game page.

     The page's CSP is script-src 'self' with no unsafe-inline, so an injected
     handler would not have run — that lock held. But it was the only lock, and
     CSP does not stop injected MARKUP: a link, an image, a panel over the
     score. A policy is the net, not the floor.

     AN ALLOW-LIST, NOT AN ESCAPE. Escaping the quotes would stop the breakout
     and still allow arbitrary CSS through the property, and CSS in an
     attacker's hands is its own problem — a background-image is a request to
     somewhere, with a referer on it. So the value has to LOOK like a colour or
     it is not used: three, six or eight hex digits, a functional notation with
     nothing but numbers and separators inside it, or one of our own custom
     properties. Anything carrying a quote, a bracket or a semicolon falls back.

     Migration 0056 fits the other lock and validates these on the way in. This
     one is the floor, because it also covers rows written before it. */
  const c = String(v == null ? '' : v).trim();
  return COLOUR_OK.test(c) ? c : (fallback || 'var(--lume)');
}

function perName(p){ return p<=4 ? 'q'+p : 'ot'+(p-4); }

function fmtClock(ms){ const s=Math.ceil(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

function fmtMin(ms){ const s=Math.round(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }

function tname(t){ return S.teams[t].name || (t? 'team two':'team one'); }

function pname(pid){ const m = PMAP[pid]; if(!m) return 'team'; return (m.p.num!==''&&m.p.num!=null?('#'+m.p.num+' '):'')+m.p.name; }

function mkP(){ return {pts:0,p2m:0,p2a:0,p3m:0,p3a:0,ftm:0,fta:0,or:0,dr:0,ast:0,stl:0,blk:0,to:0,pf:0,fd:0,pm:0,min:0,t:0,u:0,dq:false,
  ptsAst:0, rimA:0, rimM:0, midA:0, midM:0, oc:mkOC()}; }

function mkOC(){ return {tFGA:0,tFGM:0,t3M:0,tFTA:0,tTOV:0,tOR:0,tDR:0,tPTS:0, oFGA:0,oFGM:0,o3M:0,oFTA:0,oTOV:0,oOR:0,oDR:0,oPTS:0}; }

function mkBox(){ return {fga:0,fgm:0,f3m:0,fta:0,tov:0,or:0,dr:0,pts:0}; }

function mkT(){ return {pts:0,teamRebO:0,teamRebD:0,teamTo:0,toTot:0,foulTot:0,foulsP:{},paint:0,fast:0,
  sc:0,pot:0,bench:0,lead:0,tos:{h1:0,h2:0,last2:0,ot:{}}}; }

function cumEl(p, clk){ let s=0; for(let q=1;q<p;q++) s+=PLEN(q); return s+(PLEN(p)-clk); }

function activeTags(id){
  const s = new Set();
  S.events.forEach(ev=>{ if(ev.t==='tag' && ev.ref===id){ s.has(ev.tag)?s.delete(ev.tag):s.add(ev.tag); } });
  return s;
}

const COURT = (function(){
  const C = {
    W:1500, H:1400,            // half of 28 x 15 m, in centimetres
    RIM_X:750, RIM_Y:157.5,    // centre of the ring
    RIM_R:22.5,                // 45 cm diameter
    BOARD_Y:120, BOARD_HALF:90,// backboard face, 1.80 m wide
    KEY_HALF:245, KEY_LEN:580, // 4.90 m x 5.80 m
    FT_R:180, RA_R:125, ARC_R:675, CORNER_X:90, CENTRE_R:180
  };
  /* where the corner straight meets the arc — solved, not eyeballed */
  C.CORNER_Y = C.RIM_Y + Math.sqrt(C.ARC_R*C.ARC_R - Math.pow(C.RIM_X - C.CORNER_X, 2));
  return C;
}());

function courtSVG(loc, opts){
  const C = COURT, o = opts || {};
  const kL = C.RIM_X - C.KEY_HALF, kR = C.RIM_X + C.KEY_HALF;     // 505 / 995
  const cy = +C.CORNER_Y.toFixed(2);                              // 299.01
  const arcR = C.ARC_R;
  /* THE FALLBACK IS NOT DECORATION. This court is drawn on three surfaces now
     — the scorer, the public box score and the season shot chart on a player
     profile — and only the first two load a stylesheet that defines --line-hi.
     On the player page every line resolved to `stroke: none`, so the court was
     not faint, it was absent: bins floating on an empty rectangle. A var()
     fallback makes the drawing portable to whatever page it is dropped on,
     which is what a shared component has to be. Same value as the token. */
  const line = 'var(--line-hi, rgba(190,255,225,.38))';

  /* Lane space marks, outside the lane lines, at the FIBA distances from the
     baseline. Dropped on the small chart, where four ticks a side become a
     smudge rather than information. */
  const ticks = o.plain ? '' : [175, 215, 300, 385].map(y =>
    '<path d="M '+kL+' '+y+' h -22 M '+kR+' '+y+' h 22" stroke="'+line+'" stroke-width="6"/>'
  ).join('');

  const mark = loc
    ? '<circle cx="'+(loc.x*C.W)+'" cy="'+(loc.y*C.H)+'" r="38" fill="var(--amber)" '+
      'stroke="rgba(255,220,150,.5)" stroke-width="18"/>'
    : '';

  return '<svg viewBox="0 0 '+C.W+' '+C.H+'" xmlns="http://www.w3.org/2000/svg" '+
      'preserveAspectRatio="xMidYMid meet">'+
    '<rect x="0" y="0" width="'+C.W+'" height="'+C.H+'" fill="rgba(140,255,200,.04)"/>'+
    /* the boundary, stroked so its INNER edge is the playing area */
    '<rect x="3" y="3" width="'+(C.W-6)+'" height="'+(C.H-6)+'" fill="none" '+
      'stroke="'+line+'" stroke-width="6"/>'+

    /* three point: 0.90 m in from each sideline, then 6.75 m about the ring */
    '<path d="M '+C.CORNER_X+' 0 V '+cy+' A '+arcR+' '+arcR+' 0 0 0 '+(C.W-C.CORNER_X)+' '+cy+
      ' V 0" fill="none" stroke="'+line+'" stroke-width="6"/>'+

    /* the key */
    '<rect x="'+kL+'" y="0" width="'+(C.KEY_HALF*2)+'" height="'+C.KEY_LEN+'" '+
      'fill="rgba(140,255,200,.06)" stroke="'+line+'" stroke-width="6"/>'+
    ticks+

    /* free-throw circle: solid away from the basket, dashed within the key */
    '<path d="M '+(C.RIM_X-C.FT_R)+' '+C.KEY_LEN+' A '+C.FT_R+' '+C.FT_R+' 0 0 0 '+
      (C.RIM_X+C.FT_R)+' '+C.KEY_LEN+'" fill="none" stroke="'+line+'" stroke-width="6"/>'+
    '<path d="M '+(C.RIM_X-C.FT_R)+' '+C.KEY_LEN+' A '+C.FT_R+' '+C.FT_R+' 0 0 1 '+
      (C.RIM_X+C.FT_R)+' '+C.KEY_LEN+'" fill="none" stroke="'+line+'" stroke-width="5" '+
      'stroke-dasharray="34 26"/>'+

    /* restricted area, closed back to the backboard as the rule book draws it */
    '<path d="M '+(C.RIM_X-C.RA_R)+' '+C.BOARD_Y+' V '+C.RIM_Y+
      ' A '+C.RA_R+' '+C.RA_R+' 0 0 0 '+(C.RIM_X+C.RA_R)+' '+C.RIM_Y+
      ' V '+C.BOARD_Y+'" fill="none" stroke="'+line+'" stroke-width="5"/>'+

    /* centre circle — only the half inside this end of the floor exists here */
    '<path d="M '+(C.RIM_X-C.CENTRE_R)+' '+C.H+' A '+C.CENTRE_R+' '+C.CENTRE_R+
      ' 0 0 1 '+(C.RIM_X+C.CENTRE_R)+' '+C.H+'" fill="none" stroke="'+line+'" stroke-width="6"/>'+

    /* backboard, its arm, and the ring */
    '<line x1="'+(C.RIM_X-C.BOARD_HALF)+'" y1="'+C.BOARD_Y+'" x2="'+(C.RIM_X+C.BOARD_HALF)+
      '" y2="'+C.BOARD_Y+'" stroke="var(--lume)" stroke-width="11" stroke-linecap="round"/>'+
    '<line x1="'+C.RIM_X+'" y1="'+C.BOARD_Y+'" x2="'+C.RIM_X+'" y2="'+(C.RIM_Y-C.RIM_R)+
      '" stroke="var(--lume)" stroke-width="6"/>'+
    '<circle cx="'+C.RIM_X+'" cy="'+C.RIM_Y+'" r="'+C.RIM_R+'" fill="none" '+
      'stroke="var(--lume)" stroke-width="7"/>'+
    mark+'</svg>';
}

function arcSide(nx, ny){
  const C = COURT, px = nx*C.W, py = ny*C.H;
  if(px <= C.CORNER_X || px >= C.W - C.CORNER_X) return true;      // outside a straight
  return Math.hypot(px - C.RIM_X, py - C.RIM_Y) > C.ARC_R;
}

function snapToValue(nx, ny, wantThree){
  if(arcSide(nx, ny) === !!wantThree) return {x:nx, y:ny, moved:false};
  const C = COURT, STEP = 25;                                      // 25cm past the line
  const px = nx*C.W, py = ny*C.H;
  const cand = [];

  /* on the arc, radially from the ring — valid only where the arc is the
     boundary, i.e. beyond where it meets the straights */
  const dx = px - C.RIM_X, dy = py - C.RIM_Y;
  const d  = Math.hypot(dx, dy) || 1;
  const r  = C.ARC_R + (wantThree ? STEP : -STEP);
  const ax = C.RIM_X + dx/d*r, ay = C.RIM_Y + dy/d*r;
  if(ay >= C.CORNER_Y) cand.push({x:ax, y:ay});

  /* On either straight, at this shot's own depth. NEAR SIDE FIRST, because
     the two are equidistant from anything down the middle and a tie that
     always resolves left would invent a left-corner hot spot out of the
     shots whose location was nonsense to begin with — a three logged under
     the ring has no right answer, but it should at least stay on the half of
     the floor it was taken on. */
  const depth = Math.max(STEP, Math.min(C.CORNER_Y, py));
  const inset = wantThree ? -STEP : STEP;
  const near  = {x:C.CORNER_X + inset,       y:depth};
  const far   = {x:C.W - C.CORNER_X - inset, y:depth};
  cand.push(px < C.RIM_X ? near : far);
  cand.push(px < C.RIM_X ? far  : near);

  const best = cand.reduce((a,b)=>
    Math.hypot(b.x-px, b.y-py) < Math.hypot(a.x-px, a.y-py) ? b : a);
  return {
    x: +Math.max(0.01, Math.min(0.99, best.x/C.W)).toFixed(3),
    y: +Math.max(0.01, Math.min(0.99, best.y/C.H)).toFixed(3),
    moved: true
  };
}

const OFFICIAL_ROLES = [
  ['referee',          'referee'],
  ['umpire1',          'umpire 1'],
  ['umpire2',          'umpire 2'],
  ['commissioner',     'commissioner'],
  ['scorer',           'scorer'],
  ['assistant_scorer', 'assistant scorer'],
  ['timekeeper',       'timekeeper'],
  ['shot_clock',       'shot clock']
];

function matchDetailsHTML(){
  const D0 = (typeof S === 'object' && S && S.details) ? S.details : {};
  const off = D0.officials || {};
  const bits = [];

  const crew = OFFICIAL_ROLES
    .filter(([k]) => off[k])
    .map(([k, label]) => '<span class="mdrole">' + label + '</span> ' + esc(off[k]));
  if(crew.length) bits.push(['officials', crew.join('<span class="mdsep">·</span>')]);

  const place = [];
  if(D0.venue)   place.push(esc(D0.venue));
  if(D0.address) place.push('<span class="mddim">' + esc(D0.address) + '</span>');
  if(place.length) bits.push(['venue', place.join('<span class="mdsep">·</span>')]);

  /* Attendance next to capacity, because attendance alone is a number and
     attendance against capacity is a competition telling you it filled the
     hall — which is the only reason to record capacity at all. */
  if(D0.attendance != null || D0.capacity != null){
    const a = D0.attendance != null ? Number(D0.attendance).toLocaleString() : '—';
    const c = D0.capacity   != null ? Number(D0.capacity).toLocaleString()   : null;
    const pct = (D0.attendance != null && D0.capacity)
      ? ' <span class="mddim">(' + Math.round(100 * D0.attendance / D0.capacity) + '% full)</span>' : '';
    bits.push(['attendance', a + (c ? '<span class="mdsep">of</span>' + c : '') + pct]);
  }

  if(!bits.length) return '';
  return '<div class="glass mdcard">' + bits.map(b =>
    '<div class="mdrow"><span class="mdk">' + b[0] + '</span><span class="mdv">' + b[1] + '</span></div>'
  ).join('') + '</div>';
}

const FOUL_MARK = { personal:'P', shooting:'P', floor:'P', offensive:'P',
                    tech:'T', unsport:'U', disq:'D' };

function foulMarksByPlayer(){
  const marks = {};
  (S.events || []).forEach(ev => {
    if(ev.t !== 'foul' || !ev.pid) return;
    (marks[ev.pid] = marks[ev.pid] || []).push(FOUL_MARK[ev.kind] || 'P');
  });
  return marks;
}

function scoresheetHTML(d){
  const marks = foulMarksByPlayer();
  const maxP  = Math.max(4, S.period);
  const D0    = S.details || {};
  const off   = D0.officials || {};
  const won   = d.score[0] === d.score[1] ? null : (d.score[0] > d.score[1] ? 0 : 1);

  const cell = v => '<td>' + (v == null ? '' : v) + '</td>';
  const meta = (k, v) => v ? '<div class="mi"><span>' + k + '</span>' + esc(String(v)) + '</div>' : '';

  /* ---- one team block ---- */
  const teamBlock = t => {
    const T = d.team[t];
    const rows = S.teams[t].players.map(p => {
      const s = d.stats[p.id];
      const played = s.min > 0 || s.pts || s.pf || s.or || s.dr || s.ast;
      const fm = (marks[p.id] || []).join(' ');
      return '<tr' + (s.dq ? ' class="dq"' : '') + '>' +
        cell(esc(p.num)) + '<td class="nm">' + esc(p.name) + (s.dq ? ' <b>DQ</b>' : '') + '</td>' +
        cell(played ? fmtMin(s.min) : '—') +
        cell(s.p2m + '-' + s.p2a) + cell(s.p3m + '-' + s.p3a) + cell(s.ftm + '-' + s.fta) +
        cell(s.or) + cell(s.dr) + cell(s.or + s.dr) +
        cell(s.ast) + cell(s.to) + cell(s.stl) + cell(s.blk) +
        '<td class="fouls">' + (fm || '') + '</td>' +
        cell(s.fd) + '<td class="pts">' + s.pts + '</td>' + '</tr>';
    }).join('');

    const tot = S.teams[t].players.reduce((a, p) => {
      const s = d.stats[p.id];
      ['pts','p2m','p2a','p3m','p3a','ftm','fta','or','dr','ast','to','stl','blk','pf','fd']
        .forEach(k => a[k] += s[k]);
      return a;
    }, {pts:0,p2m:0,p2a:0,p3m:0,p3a:0,ftm:0,fta:0,or:0,dr:0,ast:0,to:0,stl:0,blk:0,pf:0,fd:0});

    /* team fouls per period, drawn as the four boxes a scoresheet has — the
       fifth is the bonus, and seeing the row fill is the point of the row */
    const tfRow = [];
    for(let p = 1; p <= maxP; p++){
      const n = (T.foulsP && T.foulsP[p > 4 ? 4 : p]) || 0;
      const boxes = [1,2,3,4].map(i =>
        '<span class="fb' + (i <= n ? ' on' : '') + '">' + i + '</span>').join('');
      tfRow.push('<span class="tfp"><i>' + perName(p) + '</i>' + boxes +
                 (n > 4 ? '<span class="fb on more">+' + (n - 4) + '</span>' : '') + '</span>');
    }

    return '<div class="team">' +
      '<div class="th"><span class="tn">' + esc(tname(t)) + '</span>' +
        '<span class="tsc">' + d.score[t] + '</span>' +
        (won === t ? '<span class="win">winner</span>' : '') + '</div>' +
      '<table class="bx"><thead><tr>' +
        ['no','player','min','2pt','3pt','ft','or','dr','reb','ast','to','stl','blk','fouls','fd','pts']
          .map(h => '<th>' + h + '</th>').join('') +
      '</tr></thead><tbody>' + rows +
      '<tr class="tot"><td></td><td class="nm">team totals</td>' +
        cell('') + cell(tot.p2m + '-' + tot.p2a) + cell(tot.p3m + '-' + tot.p3a) +
        cell(tot.ftm + '-' + tot.fta) +
        cell(tot.or + T.teamRebO) + cell(tot.dr + T.teamRebD) +
        cell(tot.or + tot.dr + T.teamRebO + T.teamRebD) +
        cell(tot.ast) + cell(tot.to + T.teamTo) + cell(tot.stl) + cell(tot.blk) +
        '<td class="fouls">' + tot.pf + '</td>' + cell(tot.fd) +
        '<td class="pts">' + d.score[t] + '</td></tr>' +
      '</tbody></table>' +
      '<div class="tfoot"><div class="tfl"><span>team fouls</span>' + tfRow.join('') + '</div></div>' +
      '</div>';
  };

  /* ---- period scores ---- */
  let ph = '<th></th>', r0 = '<td class="nm">' + esc(tname(0)) + '</td>',
      r1 = '<td class="nm">' + esc(tname(1)) + '</td>';
  for(let p = 1; p <= maxP; p++){
    ph += '<th>' + perName(p) + '</th>';
    r0 += '<td>' + (d.perQ[0][p] || 0) + '</td>';
    r1 += '<td>' + (d.perQ[1][p] || 0) + '</td>';
  }
  ph += '<th>final</th>';
  r0 += '<td class="pts">' + d.score[0] + '</td>';
  r1 += '<td class="pts">' + d.score[1] + '</td>';

  const when = S.details && S.details.tipoff ? S.details.tipoff : null;
  const sig = n => '<div class="sg"><span class="ln"></span><i>' + n + '</i></div>';

  return '<div class="sheet">' +
    '<div class="head">' +
      '<div class="brand">EPINOIΛ</div>' +
      '<div class="ttl">Official scoresheet</div>' +
      '<div class="comp">' + esc(S.competition || 'Friendly') + '</div>' +
    '</div>' +

    '<div class="metagrid">' +
      meta('date', when || (typeof EP_SHEET_DATE === 'string' ? EP_SHEET_DATE : '')) +
      meta('venue', D0.venue) +
      meta('address', D0.address) +
      meta('attendance', D0.attendance != null
        ? Number(D0.attendance).toLocaleString() +
          (D0.capacity ? ' of ' + Number(D0.capacity).toLocaleString() : '')
        : (D0.capacity != null ? 'capacity ' + Number(D0.capacity).toLocaleString() : '')) +
    '</div>' +

    '<div class="officials">' + OFFICIAL_ROLES.map(([k, label]) =>
      '<div class="oi"><span>' + label + '</span>' + (off[k] ? esc(off[k]) : '<i class="blank"></i>') + '</div>'
    ).join('') + '</div>' +

    teamBlock(0) + teamBlock(1) +

    '<div class="periods"><table><thead><tr>' + ph + '</tr></thead>' +
      '<tbody><tr>' + r0 + '</tr><tr>' + r1 + '</tr></tbody></table>' +
      (won == null
        ? '<div class="result">Tied ' + d.score[0] + '–' + d.score[1] + '</div>'
        : '<div class="result">' + esc(tname(won)) + ' won ' +
          Math.max(d.score[0], d.score[1]) + '–' + Math.min(d.score[0], d.score[1]) + '</div>') +
    '</div>' +

    '<div class="sigs">' + sig('Scorer') + sig('Assistant scorer') + sig('Timekeeper') +
      sig('Shot clock') + sig('Crew chief') + sig('Captain (in case of protest)') + '</div>' +

    '<div class="foot">Derived from the match event log. Fouls are shown in the order ' +
      'they were committed: P personal · T technical · U unsportsmanlike · D disqualifying.</div>' +
    '</div>';
}

function scoresheetDoc(d, title){
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
    '<style>' +
    '@page{size:A4 portrait;margin:11mm}' +
    '*{box-sizing:border-box}' +
    'body{margin:0;background:#fff;color:#111;' +
      'font:10px/1.45 ui-sans-serif,system-ui,"Segoe UI",Helvetica,Arial,sans-serif}' +
    '.sheet{max-width:190mm;margin:0 auto}' +
    '.head{display:flex;align-items:baseline;gap:12px;border-bottom:2px solid #111;padding-bottom:6px}' +
    '.brand{font-weight:800;letter-spacing:.06em;font-size:15px}' +
    '.ttl{font-size:12px;text-transform:uppercase;letter-spacing:.18em}' +
    '.comp{margin-left:auto;font-size:11px;font-weight:600}' +
    '.metagrid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 14px;margin:7px 0 8px}' +
    '.mi{font-size:10px}.mi span{display:block;font-size:7.5px;text-transform:uppercase;' +
      'letter-spacing:.14em;color:#666}' +
    '.officials{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 14px;' +
      'border:1px solid #bbb;padding:6px 8px;margin-bottom:9px}' +
    '.oi{font-size:10px}.oi span{display:block;font-size:7.5px;text-transform:uppercase;' +
      'letter-spacing:.14em;color:#666}' +
    '.oi .blank{display:block;border-bottom:1px solid #999;height:11px}' +
    '.team{margin-bottom:9px;break-inside:avoid}' +
    '.th{display:flex;align-items:baseline;gap:9px;background:#111;color:#fff;padding:3px 7px}' +
    '.tn{font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em}' +
    '.tsc{margin-left:auto;font-weight:800;font-size:14px}' +
    '.win{font-size:7.5px;text-transform:uppercase;letter-spacing:.16em;border:1px solid #fff;padding:1px 5px}' +
    'table.bx{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}' +
    'table.bx th{font-size:7px;text-transform:uppercase;letter-spacing:.08em;color:#444;' +
      'border-bottom:1px solid #111;padding:3px 2px;text-align:right}' +
    'table.bx th:nth-child(2){text-align:left}' +
    'table.bx td{padding:2px;border-bottom:1px solid #e2e2e2;text-align:right;font-size:9px}' +
    'table.bx td.nm{text-align:left;text-transform:capitalize}' +
    'table.bx td.pts{font-weight:700}' +
    'table.bx td.fouls{text-align:center;letter-spacing:.12em;font-weight:600}' +
    'table.bx tr.dq{background:#f6f6f6}' +
    'table.bx tr.tot td{border-top:1.5px solid #111;border-bottom:none;font-weight:700;padding-top:3px}' +
    '.tfoot{margin-top:4px}' +
    '.tfl{display:flex;align-items:center;gap:9px;flex-wrap:wrap;font-size:7.5px;' +
      'text-transform:uppercase;letter-spacing:.14em;color:#666}' +
    '.tfp{display:inline-flex;align-items:center;gap:2px}' +
    '.tfp i{font-style:normal;margin-right:3px;color:#111}' +
    '.fb{display:inline-block;width:11px;height:11px;line-height:10px;text-align:center;' +
      'border:1px solid #999;font-size:7px;color:#bbb}' +
    '.fb.on{background:#111;color:#fff;border-color:#111}' +
    '.fb.more{width:auto;padding:0 3px}' +
    '.periods{display:flex;align-items:flex-end;gap:14px;margin:6px 0 10px;break-inside:avoid}' +
    '.periods table{border-collapse:collapse;font-variant-numeric:tabular-nums}' +
    '.periods th{font-size:7px;text-transform:uppercase;letter-spacing:.1em;color:#444;' +
      'padding:2px 7px;border-bottom:1px solid #111}' +
    '.periods td{padding:2px 7px;text-align:right;font-size:10px;border-bottom:1px solid #e2e2e2}' +
    '.periods td.nm{text-align:left;text-transform:capitalize;font-weight:600}' +
    '.periods td.pts{font-weight:800}' +
    '.result{font-size:11px;font-weight:700;padding-bottom:3px}' +
    '.sigs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 18px;margin-top:12px;' +
      'break-inside:avoid}' +
    '.sg .ln{display:block;border-bottom:1px solid #111;height:20px}' +
    '.sg i{font-style:normal;font-size:7.5px;text-transform:uppercase;letter-spacing:.14em;color:#666}' +
    '.foot{margin-top:11px;padding-top:5px;border-top:1px solid #ccc;font-size:7.5px;color:#666}' +
    '</style></head><body>' + scoresheetHTML(d) + '</body></html>';
}

function printScoresheet(){
  const d = (typeof derive === 'function') ? derive() : null;
  if(!d) return;
  const title = [tname(0), 'v', tname(1)].join(' ') + ' — scoresheet';
  const old = document.getElementById('epSheetFrame');
  if(old) old.remove();
  const f = document.createElement('iframe');
  f.id = 'epSheetFrame';
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';
  document.body.appendChild(f);
  const doc = f.contentDocument || f.contentWindow.document;
  doc.open(); doc.write(scoresheetDoc(d, title)); doc.close();
  /* the fonts and the layout have to settle before the dialog opens, or the
     preview is measured against an empty document */
  const go = () => { try{ f.contentWindow.focus(); f.contentWindow.print(); }catch(_){ } };
  if(doc.readyState === 'complete') setTimeout(go, 60);
  else f.onload = () => setTimeout(go, 60);
}

function teamTotals(d,t){
  const T = d.team[t];
  const P = S.teams[t].players.map(p=>d.stats[p.id]);
  const s = k => P.reduce((a,x)=>a+x[k],0);
  const o = {pts:T.pts, fgm:s('p2m')+s('p3m'), fga:s('p2a')+s('p3a'), fg3m:s('p3m'), fg3a:s('p3a'),
    fg2m:s('p2m'), fg2a:s('p2a'), ftm:s('ftm'), fta:s('fta'),
    oreb:s('or')+T.teamRebO, dreb:s('dr')+T.teamRebD, ast:s('ast'), stl:s('stl'), blk:s('blk'),
    tov:T.toTot, rimA:s('rimA'), rimM:s('rimM'), midA:s('midA'), midM:s('midM'), ptsAst:s('ptsAst'),
    minutes: cumEl(S.period,S.clockMs)/60000*5};
  o.possessions = 0.96*(o.fga + o.tov + 0.44*o.fta - o.oreb);
  o.tsa = o.fga + 0.44*o.fta;
  return o;
}

function teamAdv(d,t){
  const T = teamTotals(d,t), O = teamTotals(d,1-t);
  const dv = (a,b)=> b ? a/b : 0;
  return Object.assign(T, {
    ortg: dv(T.pts,T.possessions)*100, drtg: dv(O.pts,O.possessions)*100,
    ppp: dv(T.pts,T.possessions),
    efg: dv(T.fgm+0.5*T.fg3m,T.fga)*100, ts: dv(T.pts,2*T.tsa)*100,
    tovp: dv(T.tov,T.fga+0.44*T.fta+T.tov)*100,
    orebp: dv(T.oreb,T.oreb+O.dreb)*100, drebp: dv(T.dreb,T.dreb+O.oreb)*100,
    ftr: dv(T.fta,T.fga)*100, ftp: dv(T.ftm,T.fta)*100,
    astp: dv(T.ast,T.fgm)*100, astTo: T.tov?T.ast/T.tov:T.ast,
    stlp: dv(T.stl,O.possessions)*100, blkp: dv(T.blk,O.fga-O.fg3a)*100,
    rimp: dv(T.rimM,T.rimA)*100, rimr: dv(T.rimA,T.fga)*100,
    midp: dv(T.midM,T.midA)*100,
    p3p: dv(T.fg3m,T.fg3a)*100, p3r: dv(T.fg3a,T.fga)*100,
    astPtsP: dv(T.ptsAst, T.pts-T.ftm)*100,
    tsaPer100: dv(T.tsa,T.possessions)*100,
    /* game pace: the two teams' possessions averaged, per 40 minutes of game clock
       (T.minutes is five players' worth, so /5 is the game's elapsed minutes) */
    pace: dv(T.possessions+O.possessions, 2) / Math.max(1,T.minutes/5) * 40,
    /* this team's OWN pace — its possessions per 40 — which can differ from the
       opponent's by a possession or two (end-of-period leftovers) */
    paceOwn: T.possessions / Math.max(1,T.minutes/5) * 40
  });
}

function playerAdv(d,t,p,TT,OT,gameAvg){
  const s = d.stats[p.id], mins = s.min/60000;
  const dv = (a,b)=> b ? a/b : 0;
  const fga = s.p2a+s.p3a, fgm = s.p2m+s.p3m;
  const gameMinutes = Math.max(1, TT.minutes/5);
  const pPoss = fga + 0.44*s.fta + s.to;
  const teamPoss = TT.fga + 0.44*TT.fta + TT.tov;
  const usg = mins ? 100*(pPoss*gameMinutes)/(mins*teamPoss||1) : 0;
  const estTeamFgm = (mins/gameMinutes)*TT.fgm;
  const astPct = Math.max(0, estTeamFgm - fgm) > 0 ? 100*s.ast/(estTeamFgm - fgm) : 0;
  const oppPoss = OT.fga + 0.44*OT.fta - OT.oreb + OT.tov;
  const oc = s.oc;
  const ocPoss = 0.96*(oc.tFGA + oc.tTOV + 0.44*oc.tFTA - oc.tOR);
  const ocOppPoss = 0.96*(oc.oFGA + oc.oTOV + 0.44*oc.oFTA - oc.oOR);
  /* pace on the floor / off it — both teams' possessions per 40, the game-pace definition;
     off = the game's possessions and minutes less the player's; overtime is in TT.minutes */
  const ocPossAvg = (ocPoss + ocOppPoss) / 2;
  const gamePossAvg = ((TT.possessions || 0) + (OT.possessions || 0)) / 2;
  const paceOn = mins > 0 ? ocPossAvg / mins * 40 : 0;
  const offMin = Math.max(0, gameMinutes - mins);
  const paceOff = offMin > 1 ? Math.max(0, gamePossAvg - ocPossAvg) / offMin * 40 : 0;
  const pacePM = (paceOn > 0 && paceOff > 0) ? paceOn - paceOff : 0;
  const r = {
    paceOn, paceOff, pacePM,
    id:p.id, num:p.num, name:p.name, min:mins, minTxt:fmtMin(s.min),
    fgm, ast:s.ast, pts:s.pts, ptsAst:s.ptsAst, tpc:s.pts+s.ptsAst,
    ppp: dv(s.pts,pPoss), usg, astPct,
    rimA:s.rimA, rimP:dv(s.rimM,s.rimA)*100, midA:s.midA, midP:dv(s.midM,s.midA)*100,
    p3a:s.p3a, p3P:dv(s.p3m,s.p3a)*100,
    ocOrtg: dv(oc.tPTS,ocPoss)*100, ocEfg: dv(oc.tFGM+0.5*oc.t3M,oc.tFGA)*100,
    ocOreb: dv(oc.tOR,oc.tOR+oc.oDR)*100, ocTov: dv(oc.tTOV,oc.tFGA+0.44*oc.tFTA+oc.tTOV)*100,
    ocDrtg: dv(oc.oPTS,ocOppPoss)*100, ocOppEfg: dv(oc.oFGM+0.5*oc.o3M,oc.oFGA)*100,
    ocOppOreb: dv(oc.oOR,oc.oOR+oc.tDR)*100, ocTovF: dv(oc.oTOV,oc.oFGA+0.44*oc.oFTA+oc.oTOV)*100,
    ts: dv(s.pts,2*(fga+0.44*s.fta))*100,
    tovP: dv(s.to,fga+0.44*s.fta+s.to)*100,
    stlP: mins ? 100*(s.stl*gameMinutes)/(mins*oppPoss||1) : 0,
    blkP: mins ? 100*(s.blk*gameMinutes)/(mins*(OT.fga-OT.fg3a)||1) : 0,
    ftr: dv(s.fta,fga)*100,
    orebP: mins ? 100*(s.or*gameMinutes)/(mins*(TT.oreb+OT.dreb)||1) : 0,
    drebP: mins ? 100*(s.dr*gameMinutes)/(mins*(TT.dreb+OT.oreb)||1) : 0,
    pm:s.pm
  };
  r.au = r.usg ? r.astPct/r.usg : 0;
  r.net = r.ocOrtg - r.ocDrtg;
  return r;
}

function playerAdvTable(d,t,TA,gameAvg,ranges){
  const TT = TA[t], OT = TA[1-t];
  let rows = S.teams[t].players.map(p=>playerAdv(d,t,p,TT,OT,gameAvg)).filter(r=>r.min>0);
  rows.sort((a,b)=>{ const va=a[advSort.k], vb=b[advSort.k];
    return (typeof va==='string' ? va.localeCompare(vb) : va-vb)*advSort.dir; });
  const barW = (v,k)=>{ const r=ranges[k]; if(!r || r.max===r.min) return 0; return Math.max(0,Math.min(100,(v-r.min)/(r.max-r.min)*100)); };
  const diffTxt = (v,avg,inv)=>{ const dff=v-avg; const good = inv ? dff<0 : dff>0;
    const cls = Math.abs(dff)<0.5 ? '' : (good?'pos':'neg'); return {cls, txt:(dff>0?'+':'')+dff.toFixed(0), dff}; };
  const head1 = '<tr><th class="name"></th>'+ADV_GROUPS.map(g=>{
    const hid = advHidden.has(g.key);
    return '<th class="grp'+(hid?' col-hidden':'')+'" colspan="'+g.cols.length+'" data-grp="'+g.key+'">'+g.label+' ▾</th>';
  }).join('')+'</tr>';
  const head2 = '<tr><th class="name" data-k="name">player</th>'+ADV_GROUPS.map(g=>g.cols.map(c=>
    '<th class="'+(advHidden.has(g.key)?'col-hidden ':'')+(c.sep?'sep ':'')+(advSort.k===c.k?'sorted':'')+'" data-k="'+c.k+'">'+c.l+(advSort.k===c.k?(advSort.dir<0?' ▼':' ▲'):'')+'</th>').join('')).join('')+'</tr>';
  const body = rows.map(r=>'<tr><td class="name"><small>'+esc(r.num)+'</small>'+esc(r.name)+'</td>'+
    ADV_GROUPS.map(g=>g.cols.map(c=>{
      const hid = (advHidden.has(g.key)?'col-hidden ':'')+'g-'+g.key+' ';
      const sep = c.sep?'sep':'';
      const v = r[c.k];
      if(c.pill) return '<td class="'+hid+sep+'"><span class="netpill '+(v>=0?'pos':'neg')+'">'+(v>0?'+':'')+v.toFixed(c.dec!=null?c.dec:0)+'</span></td>';
      if(c.diff){ const D=diffTxt(v,gameAvg[c.diff],c.inv); const eff = c.inv?-D.dff:D.dff;
        const w = Math.max(0,Math.min(100,50+(eff/15)*50)); const left=Math.min(50,w), right=Math.max(50,w);
        return '<td class="'+hid+sep+'"><span class="dcell"><span class="v '+D.cls+'">'+D.txt+'</span><span class="track"></span>'+
          '<span class="fill '+(D.cls||'')+'" style="left:'+left+'%;width:'+(right-left)+'%;background:'+(D.cls==='pos'?'var(--green)':(D.cls==='neg'?'var(--red)':'rgba(170,255,215,.3)'))+'"></span></span></td>'; }
      if(c.shot) return '<td class="'+hid+sep+'"><span class="cell"><span class="v">'+v+'</span><span class="bar shooting" style="width:'+Math.min(100,v/10*100)+'%"></span></span></td>';
      if(c.bar){ let w = barW(v,c.k); if(c.invbar) w = 100-w;
        return '<td class="'+hid+sep+'"><span class="cell"><span class="v">'+c.f(v,r)+'</span><span class="bar '+c.bar+'" style="width:'+w+'%"></span></span></td>'; }
      return '<td class="'+hid+sep+'">'+c.f(v,r)+'</td>';
    }).join('')).join('')+'</tr>').join('');
  const chips = [...advHidden].map(k=>{ const g=ADV_GROUPS.find(x=>x.key===k); return '<span class="stchip" data-show="'+k+'">+ '+g.label+'</span>'; }).join('');
  return '<div class="glass bxteam advcard"><h3 data-team-slot="'+t+'" style="color:'+safeColour(S.teams[t].color)+'">'+esc(tname(t))+'</h3>'+
    (chips?'<div class="grpchips">'+chips+'</div>':'')+
    '<div class="tblwrap"><table class="adv" data-team="'+t+'">'+head1+head2+body+'</table></div>'+
    '<div class="setup-note" style="text-align:left;padding-top:8px">on-court columns = diff vs game average · a/u = ast% ÷ usg% · possessions = 0.96 × (fga + tov + 0.44 fta − oreb)</div></div>';
}

function lineupAgg(d,t){
  const agg = {};
  d.lineups[t].forEach(l=>{
    const k=l.ids.join(','); const a=agg[k]=agg[k]||{ids:l.ids,dur:0,pf:0,pa:0,off:mkBox(),def:mkBox()};
    a.dur+=l.dur; a.pf+=l.pf; a.pa+=l.pa;
    for(const kk in l.off){ a.off[kk]+=l.off[kk]; a.def[kk]+=l.def[kk]; }
  });
  return Object.values(agg).sort((a,b)=>b.dur-a.dur).map(l=>{
    const o=l.off, D=l.def, dv=(a,b)=>b?a/b:0;
    const poss = 0.96*(o.fga+o.tov+0.44*o.fta-o.or), dposs = 0.96*(D.fga+D.tov+0.44*D.fta-D.or);
    l.poss = poss; l.dposs = dposs;
    l.ortg = dv(o.pts,poss)*100; l.efg = dv(o.fgm+0.5*o.f3m,o.fga)*100;
    l.tovp = dv(o.tov,o.fga+0.44*o.fta+o.tov)*100; l.orebp = dv(o.or,o.or+D.dr)*100;
    l.ftr = dv(o.fta,o.fga)*100;
    l.drtg = dv(D.pts,dposs)*100; l.oefg = dv(D.fgm+0.5*D.f3m,D.fga)*100;
    l.tovf = dv(D.tov,D.fga+0.44*D.fta+D.tov)*100; l.oreba = dv(D.or,D.or+o.dr)*100; l.oftr = dv(D.fta,D.fga)*100;
    l.net = l.ortg-l.drtg; l.pm = l.pf-l.pa;
    return l;
  });
}

function scoreHeadHTML(d){
  const TA = teamAdv(d,0);
  return '<div class="glass bx-scorehead hero-stripe">'+
    '<div class="bteam" data-team-slot="0">'+esc(tname(0))+'</div>'+
    '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">'+
    '<div style="display:flex;align-items:center;gap:14px;">'+
    '<div class="bscore">'+d.score[0]+'</div>'+
    '<div class="bmid" style="width:3px;height:44px;border-radius:2px;opacity:.6;background:linear-gradient(180deg,var(--team0),var(--team1))"></div>'+
    '<div class="bscore">'+d.score[1]+'</div></div>'+
    '<div class="pacepill">'+(S.phase==='final'?'final':perName(S.period)+' · '+fmtClock(S.clockMs))+' <span style="opacity:.4">|</span> pace <b>'+TA.pace.toFixed(1)+'</b> / 40</div></div>'+
    '<div class="bteam" data-team-slot="1" style="text-align:right">'+esc(tname(1))+'</div></div>';
}

function qstripHTML(d){
  const maxP = Math.max(4, S.period);
  let head='<th></th>', r0='<td>'+esc(tname(0))+'</td>', r1='<td>'+esc(tname(1))+'</td>';
  for(let p=1;p<=maxP;p++){
    head+='<th>'+perName(p)+'</th>';
    r0+='<td>'+(d.perQ[0][p]||0)+'</td>'; r1+='<td>'+(d.perQ[1][p]||0)+'</td>';
  }
  head+='<th>tot</th>'; r0+='<td><b>'+d.score[0]+'</b></td>'; r1+='<td><b>'+d.score[1]+'</b></td>';
  return '<div class="glass qstrip" style="padding:6px 8px;"><table><tr>'+head+'</tr><tr>'+r0+'</tr><tr>'+r1+'</tr></table></div>';
}

function teamChipsHTML(d,t){
  const T = d.team[t];
  return '<div class="chiprow">'+
    '<span class="statchip">paint<b>'+T.paint+'</b></span>'+
    '<span class="statchip">transition<b>'+T.fast+'</b></span>'+
    '<span class="statchip">2nd chance<b>'+T.sc+'</b></span>'+
    '<span class="statchip">off turnovers<b>'+T.pot+'</b></span>'+
    '<span class="statchip">bench<b>'+T.bench+'</b></span>'+
    '<span class="statchip">biggest lead<b>'+T.lead+'</b></span>'+
    '<span class="statchip">team reb<b>'+(T.teamRebO+T.teamRebD)+'</b></span>'+
    '<span class="statchip">turnovers<b>'+T.toTot+'</b></span>'+
    '<span class="statchip">fouls<b>'+T.foulTot+'</b></span>'+
    '<span class="statchip">t/o used<b>'+(T.tos.h1+T.tos.h2+Object.values(T.tos.ot).reduce((a,b)=>a+b,0))+'</b></span></div>';
}

function bxTeamHTML(d,t){
  const T = d.team[t];
  const cols = ['min','pts','2fg','3fg','ft','or','dr','reb','ast','to','stl','blk','pf','fd','+/-'];
  let rows = S.teams[t].players.map(p=>{
    const s = d.stats[p.id];
    const onc = d.onCourt[t].includes(p.id);
    return '<tr data-pid="'+p.id+'"'+(onc?' class="oncourt"':'')+'><td>'+esc(p.num)+'</td><td>'+esc(p.name)+'</td>'+
      '<td>'+fmtMin(s.min)+'</td><td>'+s.pts+'</td>'+
      '<td>'+s.p2m+'-'+s.p2a+'</td><td>'+s.p3m+'-'+s.p3a+'</td><td>'+s.ftm+'-'+s.fta+'</td>'+
      '<td>'+s.or+'</td><td>'+s.dr+'</td><td>'+(s.or+s.dr)+'</td>'+
      '<td>'+s.ast+'</td><td>'+s.to+'</td><td>'+s.stl+'</td><td>'+s.blk+'</td><td>'+s.pf+'</td>'+
      '<td>'+s.fd+'</td><td>'+(s.pm>0?'+':'')+s.pm+'</td></tr>';
  }).join('');
  if(T.teamRebO+T.teamRebD+T.teamTo>0){
    rows += '<tr><td></td><td>team</td><td></td><td></td><td></td><td></td><td></td>'+
      '<td>'+T.teamRebO+'</td><td>'+T.teamRebD+'</td><td>'+(T.teamRebO+T.teamRebD)+'</td>'+
      '<td></td><td>'+T.teamTo+'</td><td></td><td></td><td></td><td></td><td></td></tr>';
  }
  const tot = S.teams[t].players.reduce((a,p)=>{
    const s=d.stats[p.id];
    for(const k of ['pts','p2m','p2a','p3m','p3a','ftm','fta','or','dr','ast','to','stl','blk','pf','fd','min']) a[k]+=s[k];
    return a;
  }, {pts:0,p2m:0,p2a:0,p3m:0,p3a:0,ftm:0,fta:0,or:0,dr:0,ast:0,to:0,stl:0,blk:0,pf:0,fd:0,min:0});
  rows += '<tr class="tot"><td></td><td>totals</td><td>'+fmtMin(tot.min)+'</td><td>'+T.pts+'</td>'+
    '<td>'+tot.p2m+'-'+tot.p2a+'</td><td>'+tot.p3m+'-'+tot.p3a+'</td><td>'+tot.ftm+'-'+tot.fta+'</td>'+
    '<td>'+(tot.or+T.teamRebO)+'</td><td>'+(tot.dr+T.teamRebD)+'</td>'+
    '<td>'+(tot.or+tot.dr+T.teamRebO+T.teamRebD)+'</td>'+
    '<td>'+tot.ast+'</td><td>'+T.toTot+'</td><td>'+tot.stl+'</td><td>'+tot.blk+'</td><td>'+T.foulTot+'</td>'+
    '<td>'+tot.fd+'</td><td></td></tr>';
  return '<div class="glass bxteam"><h3 data-team-slot="'+t+'">'+esc(tname(t))+'</h3>'+teamChipsHTML(d,t)+
    '<div class="tblwrap"><table class="bx"><tr><th>#</th><th>player</th>'+
    cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>'+rows+'</table></div></div>';
}

function pbpHTML(d){
  let html = '<div class="pbplist">', lastP = null;
  d.pbp.forEach(e=>{
    if(e.period!==lastP){ lastP=e.period; html+='<div class="pbpq">'+perName(e.period)+'</div>'; }
    html += '<div class="pbprow"><span class="pt">'+fmtClock(e.clock)+'</span>'+
      '<span class="px">'+esc(e.txt)+'</span><span class="ps">'+e.s[0]+'–'+e.s[1]+'</span></div>';
  });
  return html+'</div>';
}

function shotChartHTML(d,t){
  const col = safeColour(S.teams[t].color, '#93f2bf');
  const shots = S.events.filter(e=>/^p[23]_/.test(e.t) && e.team===t);
  const withLoc = shots.filter(e=>d.locs[e.id]);
  /* Locations are stored NORMALISED (0..1 across the court's own box), which
     is what lets the court be redrawn to real FIBA dimensions without
     rewriting a single stored shot — the fractions still mean the same place
     on the floor. They are scaled to centimetres here, at the point of use. */
  const CW = COURT.W, CH = COURT.H;
  /* Games scored before recordLoc enforced it — and anything arriving through
     the CSV or LiveStats importers, which set locations of their own — can
     still carry a three in the paint. The chart is read for where points come
     from, so it draws each shot on the side of the line it was worth. */
  let moved = 0;
  const at = e => {
    const l = d.locs[e.id];
    const fix = snapToValue(l.x, l.y, e.t[1]==='3');
    if(fix.moved) moved++;
    return fix;
  };
  const dots = withLoc.map(e=>{
    const l = at(e), made = e.t.endsWith('made');
    const x = l.x*CW, y = l.y*CH, a = 26;
    return made
      ? '<circle cx="'+x+'" cy="'+y+'" r="30" fill="'+col+'" opacity=".95"/>'
      : '<g stroke="'+col+'" stroke-width="14" stroke-linecap="round" opacity=".8">'+
        '<line x1="'+(x-a)+'" y1="'+(y-a)+'" x2="'+(x+a)+'" y2="'+(y+a)+'"/>'+
        '<line x1="'+(x-a)+'" y1="'+(y+a)+'" x2="'+(x+a)+'" y2="'+(y-a)+'"/></g>';
  }).join('');
  const zone = (name, pred) => {
    const z = shots.filter(pred); const m = z.filter(e=>e.t.endsWith('made')).length;
    return '<span class="statchip">'+name+'<b>'+m+'/'+z.length+(z.length?' · '+Math.round(100*m/z.length)+'%':'')+'</b></span>';
  };
  /* the paint, taken from the court's own measurements rather than from three
     round numbers that happened to sit near them */
  const KX0 = (COURT.RIM_X-COURT.KEY_HALF)/COURT.W, KX1 = (COURT.RIM_X+COURT.KEY_HALF)/COURT.W;
  const KY  = COURT.KEY_LEN/COURT.H;
  const inKey = e => { const l=d.locs[e.id]; return l && l.x>KX0 && l.x<KX1 && l.y<KY; };
  const chips = '<div class="chiprow">'+
    zone('paint', e=>e.t.startsWith('p2') && (inKey(e) || activeTags(e.id).has('paint')))+
    zone('mid-range', e=>e.t.startsWith('p2') && !(inKey(e) || activeTags(e.id).has('paint')))+
    zone('three', e=>e.t.startsWith('p3'))+
    zone('left side', e=>{ const l=d.locs[e.id]; return l && l.x<0.4; })+
    zone('right side', e=>{ const l=d.locs[e.id]; return l && l.x>0.6; })+
    '</div>';
  /* No crop. The old chart rewrote the viewBox to cut the floor off at 66% of
     its depth, which on a real half court would slice through the top of the
     three-point arc and leave the centre circle hanging. A half court is the
     shape a shot chart is read in — the empty metres past the arc are part of
     knowing where a shot came from. `plain` drops the lane ticks, which are
     detail this size cannot carry. */
  const svg = courtSVG(null, {plain:true}).replace('</svg>', dots+'</svg>');
  return '<div class="glass bxteam"><h3 data-team-slot="'+t+'" style="color:'+col+'">'+esc(tname(t))+'</h3>'+
    '<div style="max-width:420px;margin:0 auto;">'+svg+'</div>'+
    '<div class="setup-note" style="padding:6px 0 2px">● made · ✕ missed · '+withLoc.length+' of '+shots.length+' shots located'+
      (moved ? ' · '+moved+' moved to the side of the arc they were worth' : '')+'</div>'+
    chips+'</div>';
}

function advHTML(d){
  const TA = [teamAdv(d,0), teamAdv(d,1)];
  const c0 = safeColour(S.teams[0].color, '#93f2bf'),
        c1 = safeColour(S.teams[1].color, '#8ff5ff');
  const f1 = v=>v.toFixed(1), f0 = v=>v.toFixed(0), f2 = v=>v.toFixed(2);
  // 1. four factors — stacked mirrored bars, fixed maxes, winner tagged
  const FF = [
    {l:'ortg', k:'ortg', max:130, hb:true, f:f1}, {l:'efg%', k:'efg', max:70, hb:true, f:f1},
    {l:'fta rate', k:'ftr', max:50, hb:true, f:f1}, {l:'oreb%', k:'orebp', max:50, hb:true, f:f1},
    {l:'tov%', k:'tovp', max:30, hb:false, f:f1},
    /* possessions and each team's own pace (per 40); the header carries the game pace */
    {l:'possessions', k:'possessions', max:110, hb:null, f:f0}, {l:'pace / 40', k:'paceOwn', max:100, hb:null, f:f1}];
  const ffRows = FF.map(x=>{ const h=TA[0][x.k], a=TA[1][x.k]; const hw = h>a, aw = a>h;
    const hWin = x.hb==null ? false : (x.hb?hw:aw), aWin = x.hb==null ? false : (x.hb?aw:hw);   // hb null = neither is "better"
    return '<div class="ffrow"><span class="ffval'+(hWin?' winner':'')+'">'+x.f(h)+'</span>'+
      '<div class="ffmid"><div class="ffbar"><i style="width:'+Math.min(100,h/x.max*100)+'%;background:'+c0+'"></i></div>'+
      '<div class="ffbar"><i style="width:'+Math.min(100,a/x.max*100)+'%;background:'+c1+'"></i></div><div class="fflabel">'+x.l+'</div></div>'+
      '<span class="ffval r'+(aWin?' winner':'')+'">'+x.f(a)+'</span></div>'; }).join('');
  const ffCard = '<div class="glass ffcard"><h3>offensive rating & four factors <span style="color:var(--faint);letter-spacing:.14em;font-size:10px">· pace '+f1(TA[0].pace)+' / 40</span></h3>'+
    '<div style="display:flex;justify-content:space-between;font-size:10px;letter-spacing:.2em;padding:0 0 6px;"><span style="color:'+c0+'">'+esc(tname(0))+'</span><span style="color:'+c1+'">'+esc(tname(1))+'</span></div>'+ffRows+'</div>';
  // 2. true shot attempts strip
  const tsaCell = t=>{ const T=TA[t]; const win = TA[t].ts>TA[1-t].ts;
    return '<div class="tsacell'+(win?' winner':'')+'"><div class="fflabel" style="color:'+(t?c1:c0)+'">'+esc(tname(t))+'</div>'+
      '<div class="big">'+f1(T.tsa)+' <span style="font-size:11px;color:var(--dim)">tsa</span> · '+f1(T.ts)+'<span style="font-size:11px;color:var(--dim)">% ts</span></div>'+
      '<div class="fm">'+T.fga+' fga + 0.44 × '+T.fta+' fta</div></div>'; };
  const tsaCard = '<div class="glass ffcard"><h3>true shot attempts</h3><div class="tsastrip">'+tsaCell(0)+tsaCell(1)+'</div></div>';
  // 3. mirrored metric rows (+ shot zones), then situational tug-of-war
  const MR = [
    {l:'true shooting %', k:'ts', max:100, f:f1}, {l:'ast / to', k:'astTo', max:4, f:f2},
    {l:'team ast %', k:'astp', max:100, f:f1}, {l:'free throw %', k:'ftp', max:100, f:f1},
    {l:'% pts off ast', k:'astPtsP', max:100, f:f1}, {l:'ppp', k:'ppp', max:1.6, f:f2},
    {sep:'shot zones'},
    {l:'rim %', k:'rimp', max:100, f:f1}, {l:'rima / fga', k:'rimr', max:100, f:f1},
    {l:'mid %', k:'midp', max:100, f:f1},
    {l:'3pt %', k:'p3p', max:100, f:f1}, {l:'3pta / fga', k:'p3r', max:100, f:f1},
    {sep:'defence & control'},
    {l:'stl %', k:'stlp', max:20, f:f1}, {l:'blk %', k:'blkp', max:20, f:f1},
    {l:'dreb %', k:'drebp', max:100, f:f1}, {l:'tsa / 100', k:'tsaPer100', max:120, f:f1}];
  const mrRows = MR.map(x=>{ if(x.sep) return '<div class="mrsep">— '+x.sep+' —</div>';
    const h=TA[0][x.k], a=TA[1][x.k];
    return '<div class="mrrow"><span class="ffval'+(h>a?' winner':'')+'">'+x.f(h)+'</span>'+
      '<div><div class="mrbars"><div class="l"><i style="width:'+Math.min(100,h/x.max*100)+'%;background:'+c0+'"></i></div>'+
      '<div class="r"><i style="width:'+Math.min(100,a/x.max*100)+'%;background:'+c1+'"></i></div></div><div class="mrlabel">'+x.l+'</div></div>'+
      '<span class="ffval r'+(a>h?' winner':'')+'">'+x.f(a)+'</span></div>'; }).join('');
  const SIT = [['paint pts','paint'],['transition pts','fast'],['2nd chance pts','sc'],['pts off turnovers','pot'],['bench pts','bench'],['biggest lead','lead']];
  const sitRows = SIT.map(([l,k])=>{ const h=d.team[0][k], a=d.team[1][k]; const tot=h+a||1;
    return '<div class="mrrow"><span class="ffval'+(h>a?' winner':'')+'">'+h+'</span>'+
      '<div><div class="tug"><i style="width:'+(h/tot*100)+'%;background:'+c0+'"></i><i style="width:'+(a/tot*100)+'%;background:'+c1+'"></i></div><div class="mrlabel">'+l+'</div></div>'+
      '<span class="ffval r'+(a>h?' winner':'')+'">'+a+'</span></div>'; }).join('');
  const mrCard = '<div class="glass ffcard"><h3>additional metrics</h3>'+mrRows+'<div class="mrsep">— situational —</div>'+sitRows+'</div>';
  // 4. player tables — game-relative bar ranges across both rosters, on-court diffs vs game average
  const gameAvg = {ortg:(TA[0].ortg+TA[1].ortg)/2, efg:(TA[0].efg+TA[1].efg)/2,
    orebp:(TA[0].orebp+TA[1].orebp)/2, tovp:(TA[0].tovp+TA[1].tovp)/2};
  const all = [0,1].flatMap(t=>S.teams[t].players.map(p=>playerAdv(d,t,p,TA[t],TA[1-t],gameAvg))).filter(r=>r.min>0);
  const ranges = {};
  ADV_GROUPS.forEach(g=>g.cols.forEach(c=>{ if(c.bar){ const vs=all.map(r=>r[c.k]); ranges[c.k]={min:Math.min(...vs,0),max:Math.max(...vs,0)}; } }));
  return ffCard+tsaCard+mrCard+playerAdvTable(d,0,TA,gameAvg,ranges)+playerAdvTable(d,1,TA,gameAvg,ranges);
}

function luNames(t, ids){
  return ids.map(pid=>PMAP[pid]?PMAP[pid].p:null).filter(Boolean)
    .sort((a,b)=>(+a.num||0)-(+b.num||0))
    .map(p=>'<span class="luname'+(t?' t1':'')+'"><span style="opacity:.55;font-family:var(--f-mono);margin-right:4px">'+esc(p.num)+'</span>'+esc(p.name)+'</span>').join('');
}

function lineupsHTML(){
  const d = derive();
  const gv = (v,good,bad,lower)=>{ if(lower) return v<=good?'good':(v>=bad?'bad':''); return v>=good?'good':(v<=bad?'bad':''); };
  const bg = net=>{ const c=Math.max(-30,Math.min(30,net)), i=Math.abs(c)/30*0.18;
    return c>=0?'rgba(99,255,160,'+i+')':'rgba(255,95,107,'+i+')'; };
  const teamHTML = t => {
    const list = lineupAgg(d,t).filter(l=>l.dur>=30000 || l.pf||l.pa).slice(0,15);
    const rows = list.map(l=>{
      return '<tr style="background:'+bg(l.net)+'"><td style="text-align:left"><div class="lunums">'+luNames(t,l.ids)+'</div></td>'+
        '<td>'+fmtMin(l.dur)+'</td><td>'+l.poss.toFixed(1)+'</td><td>'+l.pf+'-'+l.pa+'</td>'+
        '<td class="blk-o '+gv(l.ortg,110,95)+'">'+l.ortg.toFixed(1)+'</td><td class="'+gv(l.efg,52,45)+'">'+l.efg.toFixed(1)+'</td>'+
        '<td class="'+gv(l.tovp,12,18,true)+'">'+l.tovp.toFixed(1)+'</td><td class="'+gv(l.orebp,30,20)+'">'+l.orebp.toFixed(1)+'</td>'+
        '<td class="'+gv(l.ftr,30,15)+'">'+l.ftr.toFixed(0)+'</td>'+
        '<td class="blk-d '+gv(l.drtg,100,115,true)+'">'+l.drtg.toFixed(1)+'</td><td class="'+gv(l.oefg,45,52,true)+'">'+l.oefg.toFixed(1)+'</td>'+
        '<td class="'+gv(l.tovf,18,12)+'">'+l.tovf.toFixed(1)+'</td><td class="'+gv(l.oreba,20,30,true)+'">'+l.oreba.toFixed(1)+'</td>'+
        '<td class="'+gv(l.oftr,15,30,true)+'">'+l.oftr.toFixed(0)+'</td>'+
        '<td class="blk-n"><span class="netpill '+(l.net>=0?'pos':'neg')+'">'+(l.net>0?'+':'')+l.net.toFixed(1)+'</span></td>'+
        '<td class="'+(l.pm>0?'pos':(l.pm<0?'neg':''))+'">'+(l.pm>0?'+':'')+l.pm+'</td></tr>';
    }).join('') || '<tr><td colspan="16" style="text-align:left;color:var(--faint)">no lineup data yet</td></tr>';
    return '<div class="glass bxteam advcard"><h3 data-team-slot="'+t+'" style="color:'+safeColour(S.teams[t].color)+'">'+esc(tname(t))+'</h3><div class="tblwrap">'+
      '<table class="bx lu" style="min-width:980px"><tr><th style="text-align:left">lineup</th><th>min</th><th>poss</th><th>pts</th>'+
      '<th class="blk-o">ortg</th><th>efg%</th><th>tov%</th><th>orb%</th><th>ft rate</th>'+
      '<th class="blk-d">drtg</th><th>opp efg</th><th>tov frc</th><th>orb alwd</th><th>opp ftr</th>'+
      '<th class="blk-n">net</th><th>+/-</th></tr>'+
      rows+'</table></div></div>';
  };
  return teamHTML(0)+teamHTML(1)+
    '<div class="setup-note" style="padding:4px 0 10px">row tint = net rating · sorted by minutes · thresholds: ortg 110/95 · efg 52/45 · tov 12/18 · orb 30/20 · ft rate 30/15 · drtg 100/115 · opp efg 45/52 · tov frc 18/12 · orb alwd 20/30 · opp ftr 15/30</div>';
}

/* Not lifted from the scorer: PMAP is a mutable pid -> {team, player} lookup
   that the scorer refills in buildPmap(), which also writes CSS custom
   properties to the document. Only the lookup half belongs here, so this is
   that half. Call it after setting S and before rendering. */
function rebuildPmap() {
  PMAP = {};
  S.teams.forEach((tm, t) => tm.players.forEach(p => { PMAP[p.id] = { team: t, p }; }));
  return PMAP;
}

return { PLEN, PMAP, ADV_GROUPS, advSort, esc, COLOUR_OK, safeColour, perName, fmtClock, fmtMin, tname, pname, mkP, mkOC, mkBox, mkT, cumEl, activeTags, COURT, courtSVG, arcSide, snapToValue, OFFICIAL_ROLES, matchDetailsHTML, FOUL_MARK, foulMarksByPlayer, scoresheetHTML, scoresheetDoc, printScoresheet, teamTotals, teamAdv, playerAdv, playerAdvTable, lineupAgg, scoreHeadHTML, qstripHTML, teamChipsHTML, bxTeamHTML, pbpHTML, shotChartHTML, advHTML, luNames, lineupsHTML, rebuildPmap };
}));
