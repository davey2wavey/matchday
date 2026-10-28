/* Matchday shared helpers: stars, time, fetching, calendar links */
window.MD=(function(){
const TZ='America/Los_Angeles';
const HOSTS=['https://site.api.espn.com/apis','https://site.web.api.espn.com/apis'];
const SPORTS={
  soccer:{name:'Soccer',path:'soccer',leagues:[{id:'eng.1',name:'Premier League'},{id:'uefa.champions',name:'Champions League'},{id:'esp.1',name:'La Liga'}],dur:2,api:l=>`site/v2/sports/soccer/${l}`},
  nba:{name:'NBA',path:'nba',leagues:[{id:'nba',name:'NBA'}],dur:2.5,api:()=>`site/v2/sports/basketball/nba`},
  nfl:{name:'NFL',path:'nfl',leagues:[{id:'nfl',name:'NFL'}],dur:3.25,api:()=>`site/v2/sports/football/nfl`},
};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function laParts(d){const p=new Intl.DateTimeFormat('en-US',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'numeric',minute:'2-digit',hour12:true}).formatToParts(d);const o={};p.forEach(x=>o[x.type]=x.value);return o;}
const ymd=d=>{const p=laParts(d);return `${p.year}-${p.month}-${p.day}`;};
const ymdc=d=>ymd(d).replace(/-/g,'');
const fmtTime=d=>{const p=laParts(d);return `${p.hour}:${p.minute} ${p.dayPeriod.toLowerCase()}`;};
const fmtDate=(d,o)=>new Intl.DateTimeFormat('en-US',Object.assign({timeZone:TZ},o)).format(d);
const addDays=(d,n)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;};
function mondayOf(d){const p=laParts(d);const dow=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday);const back=(dow+6)%7;const base=new Date(Date.UTC(+p.year,+p.month-1,+p.day,12));return addDays(base,-back);}
const todayKey=()=>ymd(new Date());

const cache={};let lastErr='';
async function getJSON(url){if(cache[url]&&Date.now()-cache[url].t<120000)return cache[url].d;const r=await fetch(url);if(!r.ok)throw new Error('ESPN '+r.status);const d=await r.json();cache[url]={t:Date.now(),d};return d;}
async function fetchLimited(fns,n){
  const out=new Array(fns.length);let i=0;
  async function worker(){while(i<fns.length){const k=i++;let d=null;
    for(let a=0;a<4&&!d;a++){const host=HOSTS[a%HOSTS.length];try{d=await fns[k](host);}catch(e){lastErr=e.message;await new Promise(r=>setTimeout(r,400*(a+1)));}}
    out[k]=d;}}
  await Promise.all([...Array(Math.min(n,fns.length))].map(worker));return out;
}
function clearScoreboardCache(){Object.keys(cache).forEach(k=>{if(k.includes('scoreboard'))delete cache[k];});}

/* scoreboard for a sport+league across dates → normalized events */
async function scoreboard(sport,league,dates){
  const sp=SPORTS[sport];
  const res=await fetchLimited(dates.map(d=>host=>getJSON(`${host}/${sp.api(league)}/scoreboard?dates=${ymdc(d)}`)),3);
  const seen=new Set();const failed=res.filter(r=>!r).length;
  const events=res.flatMap(d=>(d&&d.events)||[]).filter(e=>{if(seen.has(e.id))return false;seen.add(e.id);return true;}).map(e=>normalize(e,sport,league));
  return {events,failed};
}
function normalize(e,sport,league){
  const c=e.competitions[0];const home=c.competitors.find(x=>x.homeAway==='home')||c.competitors[0];const away=c.competitors.find(x=>x.homeAway==='away')||c.competitors[1];
  const st=c.status||e.status;const state=st.type.state;
  const bc=(c.broadcasts||e.broadcasts||[]).flatMap(b=>b.names||(b.media&&b.media.shortName?[b.media.shortName]:[]));
  return {id:e.id,sport,league,date:new Date(e.date),home,away,state,completed:st.type.completed,clock:st.displayClock,period:st.period,detail:st.type.shortDetail,
    venue:c.venue,tv:[...new Set(bc)],odds:(c.odds&&c.odds[0])||null,raw:e};
}
function scoreLabel(e){
  if(e.state==='pre')return fmtTime(e.date);
  if(e.sport==='soccer'){if(e.state==='in')return (e.clock||'')+' live';return 'FT';}
  if(e.state==='in'){const p=e.period>4?'OT'+(e.period>5?e.period-4:''):(e.detail&&/half/i.test(e.detail)?'Half':'Q'+e.period);return `${p} ${e.clock||''}`;}
  return e.period>4?'Final/OT':'Final';
}

/* stars */
const KEY='md-stars';
function stars(){try{return JSON.parse(localStorage.getItem(KEY)||'[]');}catch(e){return [];}}
function starKey(sport,league,id){return `${sport}:${league}:${id}`;}
function isStarred(sport,league,id){const k=starKey(sport,league,id);return stars().some(s=>s.k===k);}
function toggleStar(sport,league,team){
  const k=starKey(sport,league,team.id);let list=stars();
  if(list.some(s=>s.k===k))list=list.filter(s=>s.k!==k);
  else list.push({k,sport,league,id:String(team.id),name:team.shortDisplayName||team.displayName||team.name,logo:team.logo||(team.logos&&team.logos[0]&&team.logos[0].href)||''});
  try{localStorage.setItem(KEY,JSON.stringify(list));}catch(e){}
  return list.some(s=>s.k===k);
}
function eventStarred(e){const s=stars();return s.some(x=>x.sport===e.sport&&(x.id==e.home.team.id||x.id==e.away.team.id));}
function pref(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v);}catch(e){return null;}}

function gcalUrl(e,title,desc,loc){
  const f=d=>d.toISOString().replace(/[-:]|\.\d{3}/g,'');
  const end=new Date(e.date.getTime()+(SPORTS[e.sport].dur)*36e5);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(title)+'&dates='+f(e.date)+'/'+f(end)+'&details='+encodeURIComponent(desc)+'&location='+encodeURIComponent(loc)+'&ctz='+TZ;
}
function nav(active){
  const items=[['','My Week'],['tonight','Tonight'],['soccer','Soccer'],['nba','NBA']];
  return `<nav class="mdnav">${items.map(([p,n])=>`<a href="${p?'../'+p+'/':'../'}" ${p===active?'aria-current="page"':''}>${n}</a>`).join('')}</nav>`;
}
return {TZ,SPORTS,esc,ymd,ymdc,fmtTime,fmtDate,addDays,mondayOf,todayKey,getJSON,fetchLimited,clearScoreboardCache,scoreboard,normalize,scoreLabel,stars,isStarred,toggleStar,eventStarred,pref,gcalUrl,nav,lastErr:()=>lastErr};
})();
