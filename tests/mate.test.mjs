/* 杀法判定回归测试
 * 样例来自 tests/fixtures/mate-cases.json：
 *   enumerated = 程序穷举确认为真将死的局面
 *   user       = 用户实战棋谱终局
 *   manual     = 人工构造
 * 任何判定逻辑改动前先跑这套。
 */
import fs from 'fs';
const root=new URL('..',import.meta.url).pathname;
const M=new Function(
  fs.readFileSync(root+'engine.js','utf8')+'\n'+fs.readFileSync(root+'mate.js','utf8')+
  `\nreturn {RED,BLK,parseFen,classifyMate,legalMoves,isChecked,findKing,replay,toFen};`)();
const {RED,BLK,parseFen,classifyMate,legalMoves,isChecked} = M;

const fixtures=JSON.parse(fs.readFileSync(root+'tests/fixtures/mate-cases.json','utf8'));

function boardFrom(pieces){
  const b=[];for(let y=0;y<10;y++)b.push(new Array(9).fill(null));
  for(const [s,t,x,y] of pieces) b[y][x]={s,t};
  return b;
}

let pass=0,fail=0;
const fails=[];
for(const c of fixtures.cases){
  const board = c.fen ? parseFen(c.fen).board : boardFrom(c.pieces);
  const mated = legalMoves(board,BLK).length===0;
  const r = classifyMate(board,BLK,c.last,null);
  const good = r.name===c.expect && mated;
  if(good)pass++; else {fail++;fails.push({id:c.id,got:r.name,want:c.expect,mated});}
  console.log(`  ${good?'ok  ':'FAIL'} ${c.id.padEnd(15)} [${c.source.padEnd(10)}] 将死=${mated?1:0} → ${r.name}${good?'':'  ← 期望 '+c.expect}`);
}
console.log(`\n通过 ${pass} / 失败 ${fail}`);
if(fails.length){
  console.log('\n失败明细:');
  for(const f of fails)console.log(`  ${f.id}: 得到 ${f.got}，期望 ${f.want}，将死=${f.mated}`);
}
process.exit(fail?1:0);
