// EPINOIA GO's location call (epinoia/go/geo.js): precise then coarse, a refusal is final, an insecure page or no geolocation says so, and the help
// for a refusal names the settings of the reader's own device (iPhone, Android, desktop, an in-app browser).
//   node supabase/tests/geo.test.mjs
import fs from 'node:fs';
globalThis.window = globalThis;
const mk=(ua,over={})=>{ Object.defineProperty(globalThis,"navigator",{value:{userAgent:ua,maxTouchPoints:over.touch||0,geolocation:over.geo},configurable:true,writable:true}); globalThis.isSecureContext=over.secure!==false; delete globalThis.EpinoiaGeo; eval(fs.readFileSync(new URL('../../epinoia/go/geo.js', import.meta.url),'utf8')); return globalThis.EpinoiaGeo; };
const IOS='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const AND='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const DESK='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const INAPP='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0';
let n=0,f=0; const ok=(w,c)=>{c?n++:(f++,console.log('FAIL',w))};
let G=mk(IOS); ok('ios safari denied text', /Location Services/.test(G.help('denied'))&&/Safari Websites/.test(G.help('denied')));
G=mk(AND); ok('android denied', /lock icon/.test(G.help('denied'))&&/Permissions/.test(G.help('denied')));
G=mk(DESK); ok('desktop denied', /lock icon/.test(G.help('denied'))&&!/Settings ›/.test(G.help('denied')));
G=mk(INAPP); ok('in-app', G.env().inapp&&/Open this page in Safari/.test(G.help('denied')));
// locate: precise ok
let calls=[]; G=mk(IOS,{geo:{getCurrentPosition:(ok1,err,o)=>{calls.push(o.enableHighAccuracy);ok1({coords:{latitude:1,longitude:2,accuracy:9}})}}});
let r=await G.locate(); ok('precise fix', r.lat===1&&calls.length===1&&calls[0]===true);
// timeout then coarse
calls=[]; G=mk(IOS,{geo:{getCurrentPosition:(ok1,err,o)=>{calls.push(o.enableHighAccuracy); if(o.enableHighAccuracy) err({code:3}); else ok1({coords:{latitude:3,longitude:4,accuracy:900}})}}});
r=await G.locate(); ok('falls back to a coarse fix', r.lat===3&&calls.join()==='true,false');
// denied: no retry
calls=[]; G=mk(IOS,{geo:{getCurrentPosition:(ok1,err,o)=>{calls.push(1);err({code:1})}}});
r=await G.locate(); ok('denied is final', r.error==='denied'&&calls.length===1);
G=mk(IOS,{secure:false,geo:{getCurrentPosition(){}}}); r=await G.locate(); ok('insecure', r.error==='insecure');
G=mk(IOS,{}); r=await G.locate(); ok('no geolocation', r.error==='none');
console.log(String.fromCharCode(10) + n + ' passed, ' + f + ' failed'); process.exit(f ? 1 : 0);
