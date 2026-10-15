import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readJson, roundState, roundHasScores, roundProgress, mergeRounds } from '../scripts/sync-core.mjs';
import { collectRounds } from '../scripts/mister-client.mjs';

const config = await readJson(new URL('../mister-sync.config.json', import.meta.url));
const panel = await readJson(new URL('../mister-datos.json', import.meta.url));
const metadata = () => ({ gameweekStatus: 'ongoing', games: Array.from({length:10}, (_,i)=>({id:i+1, status:i<7?'played':'postponed'})) });
const scores = Object.fromEntries(Object.values(config.managerIds).map((id,i)=>[id,i===0?0:i===1?-4:i*5]));

test('imports started rounds but leaves future and entirely postponed rounds empty', () => {
  assert.equal(roundState(metadata(), config), 'pending');
  assert.equal(roundHasScores(metadata(), config), true);
  const future = metadata();
  future.gameweekStatus = 'unstarted';
  future.games.forEach(g=>g.status='scheduled');
  assert.equal(roundHasScores(future, config), false);
  future.games.forEach(g=>g.status='postponed');
  assert.equal(roundHasScores(future, config), false);
  assert.equal(roundHasScores({gameweekStatus:'unstarted'}, config), false);
  const invalid = metadata(); invalid.games[0].status='unknown';
  assert.throws(()=>roundHasScores(invalid, config), /desconocido/);
  assert.throws(()=>roundHasScores({...metadata(), games:metadata().games.slice(1)}, config), /partidos/);
  const duplicate = metadata(); duplicate.games[0].id=duplicate.games[1].id;
  assert.throws(()=>roundHasScores(duplicate, config), /duplicados/);
});

test('replaces provisional scores, preserves zero/negative values and settles only on closure', () => {
  const item = {round:6, id:'4047', state:'pending', points:scores};
  const first = mergeRounds(panel, config, [item]);
  assert.equal(first.output.points.Iñ[5], 0);
  assert.equal(first.output.points.Eg[5], -4);
  assert.equal(first.output.sync.rounds[6].status, 'pending');
  const corrected = {...item, points:{...scores, [config.managerIds.Iñ]:12}};
  const next = mergeRounds(first.output, config, [corrected]);
  assert.equal(next.output.points.Iñ[5], 12);
  assert.equal(next.changes.length, 1);
  const reopened = mergeRounds(next.output, config, [{round:6,id:'4047',state:'pending'}]);
  assert.deepEqual(reopened.output.points, next.output.points);
  const closed = mergeRounds(next.output, config, [{...corrected,state:'closed'}]);
  assert.equal(closed.output.sync.rounds[6].status, 'closed');
  assert.deepEqual(closed.output.points, next.output.points);
  assert.throws(()=>mergeRounds(panel, config, [{...item,points:{}}]), /Faltan/);
});

// Exercise the complete collector with browser-boundary responses; no account/session is needed.
function browserFixture(meta, mismatch = false) {
  let url;
  const visited = [];
  const roundLinks = [1,4,6].map(round=>({text:`J${round}`, href:`/standings?gw=${round===6?'4047':config.seasonAnchors[round]}`}));
  const rows = Object.entries(scores).map(([id,p])=>({href:`/users/${id}/name`,text:`Name ${p} PTS`}));
  return {visited, page:{
    async goto(next) {url=next; visited.push(next);return {ok:()=>true};},
    url:()=>url,
    locator(selector) {return {
      filter(){return this;}, first(){return this;}, async waitFor(){},
      async evaluateAll(){return selector.includes('standings?gw=')?roundLinks:rows;}
    };},
    async evaluate(_fn, args) {
      if(args.endpoint==='/ajax/sw/gameweek') return {data:meta};
      const id=args.form.id;
      return {data:{userInfo:{id_community:config.leagueId}, userGameWeeks:{4047:{id_gameweek:'4047',points:String(scores[id]+(mismatch?1:0))}}}};
    }
  }};
}

test('collector cross-checks provisional standings against all ten histories', async () => {
  const fixture = browserFixture(metadata());
  const result = await collectRounds(fixture.page, config, 6);
  assert.deepEqual(result, [{round:6,id:'4047',state:'pending',points:scores,progress:roundProgress(metadata())}]);
  assert.ok(fixture.visited.some(url=>url.endsWith('standings?gw=4047')));
  await assert.rejects(collectRounds(browserFixture(metadata(),true).page, config, 6), /no coinciden/);
  const future = metadata(); future.games.forEach(g=>g.status='scheduled');
  const untouched = browserFixture(future);
  assert.deepEqual(await collectRounds(untouched.page,config,6), [{round:6,id:'4047',state:'pending',progress:roundProgress(future)}]);
  assert.ok(!untouched.visited.some(url=>url.endsWith('standings?gw=4047')));
});

test('preview diagnostics contain only recognized statuses and match counts', () => {
  assert.deepEqual(roundProgress(metadata()),{misterStatus:'ongoing',matches:{played:7,postponed:3}});
  assert.deepEqual(roundProgress({gameweekStatus:'private-payload',games:[{status:'private-payload',token:'secret'}]}),
    {misterStatus:'unknown',matches:{unknown:1}});
});

test('dashboard includes provisional points in totals and chart while keeping sprint payments provisional', async () => {
  const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
  const elements = new Map();
  const element = selector => {
    if(!elements.has(selector)) elements.set(selector,{textContent:'',innerHTML:'',hidden:true});
    return elements.get(selector);
  };
  const context = vm.createContext({
    document:{querySelector:element,querySelectorAll:()=>[],getElementById:()=>null},
    window:{}, console, Intl, Date
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\binit\(\);\s*$/, ''),context);
  const data = structuredClone(panel);
  // A complete five-round sprint with one provisional jornada must stay open.
  for(const [i,p] of data.players.entries()) data.points[p.id]=Array(38).fill(null).map((v,j)=>j<10?i+1:null);
  data.sync.rounds=Object.fromEntries(Array.from({length:10},(_,i)=>[i+1,{status:i===5?'pending':'closed'}]));
  context.data=data;
  vm.runInContext('render(data)', context);
  assert.match(element('#tableWrap').innerHTML,/J6 \*/);
  assert.match(element('#provisionalRounds').textContent,/J6/);
  assert.equal(element('#provisionalRounds').hidden,false);
  assert.match(element('#rankTotal').innerHTML,/100<\/span>/);
  const sprint2 = element('#sprintGrid').innerHTML.split('Sprint 2')[1].split('Sprint 3')[0];
  assert.match(sprint2,/En curso/);
  assert.doesNotMatch(sprint2,/Completado|>paga/);
  assert.equal(vm.runInContext('computeFilledAll(data.points,data.players,38)',context),10);
  assert.equal(vm.runInContext('computeFilledAll(data.points,data.players,38,data.sync.rounds)',context),5);
  data.sync.rounds[6].status='closed';
  vm.runInContext('render(data)',context);
  assert.equal(element('#provisionalRounds').hidden,true);
  assert.match(element('#sprintGrid').innerHTML.split('Sprint 2')[1].split('Sprint 3')[0],/Completado/);
});
