/* ============================================================================
   EPINOIA BOX SCORE — GENERATED FILE, DO NOT EDIT.

   Lifted verbatim from league/score/index.html by
   supabase/tests/extract-boxscore.mjs. Edit the scorer, then re-run:

       node supabase/tests/extract-boxscore.mjs

   CI runs it with --check, so this file cannot fall behind the scorer.

   These are the same functions that draw the statistician's final screen, so
   the public box score is not a second implementation that has to be kept in
   agreement — it is the same code over the same event log.

   Callers must supply two globals the scorer provides for itself:
     S        the game state  {teams, starters, period, clockMs, events, …}
     derive() the replayed game, in the shape league/engine.js returns
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
    {k:'ocTov',l:'tov%',diff:'tovp',inv:true,sep:true}]},
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

function courtSVG(loc){
  const mark = loc ? '<circle cx="'+(loc.x*100)+'" cy="'+(loc.y*94)+'" r="3" fill="var(--amber)" '+
    'stroke="rgba(255,220,150,.5)" stroke-width="2"/>' : '';
  return '<svg viewBox="0 0 100 94" xmlns="http://www.w3.org/2000/svg">'+
    '<rect x="1" y="1" width="98" height="92" rx="4" fill="rgba(140,255,200,.04)" stroke="var(--line-hi)" stroke-width="1"/>'+
    '<line x1="1" y1="62" x2="99" y2="62" stroke="var(--line)" stroke-width=".6" stroke-dasharray="2 2"/>'+
    '<rect x="33" y="1" width="34" height="38" fill="rgba(140,255,200,.06)" stroke="var(--line-hi)" stroke-width="1"/>'+
    '<circle cx="50" cy="39" r="12" fill="none" stroke="var(--line-hi)" stroke-width="1"/>'+
    '<path d="M8 1 V12 A45 45 0 0 0 92 12 V1" fill="none" stroke="var(--line-hi)" stroke-width="1"/>'+
    '<circle cx="50" cy="10" r="2.4" fill="none" stroke="var(--lume)" stroke-width="1.4"/>'+
    '<line x1="44" y1="6.5" x2="56" y2="6.5" stroke="var(--lume)" stroke-width="1.4"/>'+
    mark+'</svg>';
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
    pace: dv(T.possessions+O.possessions, 2) / Math.max(1,T.minutes/5) * 40
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
  const r = {
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
      if(c.pill) return '<td class="'+hid+sep+'"><span class="netpill '+(v>=0?'pos':'neg')+'">'+(v>0?'+':'')+v.toFixed(0)+'</span></td>';
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
  return '<div class="glass bxteam advcard"><h3 style="color:'+(S.teams[t].color||'var(--lume)')+'">'+esc(tname(t))+'</h3>'+
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
    '<div class="bteam">'+esc(tname(0))+'</div>'+
    '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;">'+
    '<div style="display:flex;align-items:center;gap:14px;">'+
    '<div class="bscore">'+d.score[0]+'</div>'+
    '<div class="bmid" style="width:3px;height:44px;border-radius:2px;opacity:.6;background:linear-gradient(180deg,var(--team0),var(--team1))"></div>'+
    '<div class="bscore">'+d.score[1]+'</div></div>'+
    '<div class="pacepill">'+(S.phase==='final'?'final':perName(S.period)+' · '+fmtClock(S.clockMs))+' <span style="opacity:.4">|</span> pace <b>'+TA.pace.toFixed(1)+'</b> / 40</div></div>'+
    '<div class="bteam" style="text-align:right">'+esc(tname(1))+'</div></div>';
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
  return '<div class="glass bxteam"><h3>'+esc(tname(t))+'</h3>'+teamChipsHTML(d,t)+
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
  const col = S.teams[t].color || '#93f2bf';
  const shots = S.events.filter(e=>/^p[23]_/.test(e.t) && e.team===t);
  const withLoc = shots.filter(e=>d.locs[e.id]);
  const dots = withLoc.map(e=>{
    const l = d.locs[e.id], made = e.t.endsWith('made');
    return made
      ? '<circle cx="'+(l.x*100)+'" cy="'+(l.y*94)+'" r="2.4" fill="'+col+'" opacity=".95"/>'
      : '<g stroke="'+col+'" stroke-width="1.1" opacity=".75"><line x1="'+(l.x*100-2)+'" y1="'+(l.y*94-2)+'" x2="'+(l.x*100+2)+'" y2="'+(l.y*94+2)+'"/>'+
        '<line x1="'+(l.x*100-2)+'" y1="'+(l.y*94+2)+'" x2="'+(l.x*100+2)+'" y2="'+(l.y*94-2)+'"/></g>';
  }).join('');
  const zone = (name, pred) => {
    const z = shots.filter(pred); const m = z.filter(e=>e.t.endsWith('made')).length;
    return '<span class="statchip">'+name+'<b>'+m+'/'+z.length+(z.length?' · '+Math.round(100*m/z.length)+'%':'')+'</b></span>';
  };
  const inKey = e => { const l=d.locs[e.id]; return l && l.x>0.33 && l.x<0.67 && l.y<0.42; };
  const chips = '<div class="chiprow">'+
    zone('paint', e=>e.t.startsWith('p2') && (inKey(e) || activeTags(e.id).has('paint')))+
    zone('mid-range', e=>e.t.startsWith('p2') && !(inKey(e) || activeTags(e.id).has('paint')))+
    zone('three', e=>e.t.startsWith('p3'))+
    zone('left side', e=>{ const l=d.locs[e.id]; return l && l.x<0.4; })+
    zone('right side', e=>{ const l=d.locs[e.id]; return l && l.x>0.6; })+
    '</div>';
  const svg = courtSVG(null).replace('</svg>', dots+'</svg>').replace('viewBox="0 0 100 94"','viewBox="0 0 100 62"');
  return '<div class="glass bxteam"><h3 style="color:'+col+'">'+esc(tname(t))+'</h3>'+
    '<div style="max-width:420px;margin:0 auto;">'+svg+'</div>'+
    '<div class="setup-note" style="padding:6px 0 2px">● made · ✕ missed · '+withLoc.length+' of '+shots.length+' shots located</div>'+
    chips+'</div>';
}

function advHTML(d){
  const TA = [teamAdv(d,0), teamAdv(d,1)];
  const c0 = S.teams[0].color||'#93f2bf', c1 = S.teams[1].color||'#8ff5ff';
  const f1 = v=>v.toFixed(1), f0 = v=>v.toFixed(0), f2 = v=>v.toFixed(2);
  // 1. four factors — stacked mirrored bars, fixed maxes, winner tagged
  const FF = [
    {l:'ortg', k:'ortg', max:130, hb:true, f:f1}, {l:'efg%', k:'efg', max:70, hb:true, f:f1},
    {l:'fta rate', k:'ftr', max:50, hb:true, f:f1}, {l:'oreb%', k:'orebp', max:50, hb:true, f:f1},
    {l:'tov%', k:'tovp', max:30, hb:false, f:f1}];
  const ffRows = FF.map(x=>{ const h=TA[0][x.k], a=TA[1][x.k]; const hw = h>a, aw = a>h; const hWin = x.hb?hw:aw, aWin = x.hb?aw:hw;
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
    return '<div class="glass bxteam advcard"><h3 style="color:'+(S.teams[t].color||'var(--lume)')+'">'+esc(tname(t))+'</h3><div class="tblwrap">'+
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

return { PLEN, PMAP, ADV_GROUPS, advSort, esc, perName, fmtClock, fmtMin, tname, pname, mkP, mkOC, mkBox, mkT, cumEl, activeTags, courtSVG, teamTotals, teamAdv, playerAdv, playerAdvTable, lineupAgg, scoreHeadHTML, qstripHTML, teamChipsHTML, bxTeamHTML, pbpHTML, shotChartHTML, advHTML, luNames, lineupsHTML, rebuildPmap };
}));
