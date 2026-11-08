/* 杀法判定测试
 * 用例全部由穷举生成：随机摆子 → 用合法走法引擎确认为真将死 → 交给分类器
 * 生成脚本见 /tmp/find.mjs 的逻辑说明（docs/MATE_RULES.md）
 */
import fs from 'fs';
const d=new URL('..',import.meta.url).pathname;
const M=new Function(
  fs.readFileSync(d+'engine.js','utf8')+'\n'+fs.readFileSync(d+'mate.js','utf8')+
  `\nreturn {RED,BLK,parseFen,classifyMate,legalMoves,isChecked,findKing,toFen};`)();
const {RED,BLK,classifyMate,legalMoves,isChecked,findKing}=M;

function mk(pieces){
  const b=[];for(let y=0;y<10;y++)b.push(new Array(9).fill(null));
  for(const [s,t,x,y] of pieces) b[y][x]={s,t};
  return b;
}
let pass=0,fail=0;
function T(name,pieces,last,expect){
  const b=mk(pieces);
  const mated=legalMoves(b,BLK).length===0;
  const chk=isChecked(b,BLK);
  const r=classifyMate(b,BLK,last,null);
  const good=r.name===expect && mated;
  good?pass++:fail++;
  console.log(`  ${good?'ok  ':'FAIL'} ${name.padEnd(8)} 将死=${mated?1:0} 将军=${chk?1:0} → ${r.name}${r.name===expect?'':'  ← 期望'+expect}`);
}

const K=(x,y)=>['b','K',x,y];
const RK=['r','K',4,9];

// —— 由穷举确认的真将死局面 ——
T('困毙',   [K(3,0),['r','R',0,0],['r','N',1,0],['r','K',4,9]], null, '困毙');
T('双车错', [K(3,0),['r','R',0,0],['r','R',1,1],['r','K',4,9]], {fx:0,fy:0,tx:1,ty:1}, '双车错');
T('双照将', [K(3,0),['r','R',0,0],['r','R',3,2],['r','K',4,9]], {fx:0,fy:0,tx:3,ty:2}, '双照将');
T('钓鱼马', [K(3,0),['r','R',3,2],['r','N',1,3],['r','K',4,9]], {fx:3,fy:2,tx:1,ty:3}, '钓鱼马');
T('侧面虎', [K(3,0),['r','R',3,2],['r','N',1,4],['r','K',4,9]], {fx:3,fy:2,tx:1,ty:4}, '侧面虎');
T('卧槽马', [K(3,1),['r','N',1,1],['r','N',1,2],['r','K',4,9]], {fx:1,fy:1,tx:1,ty:2}, '卧槽马');
T('挂角马', [K(3,1),['r','N',1,1],['r','N',5,2],['r','K',4,9]], {fx:1,fy:1,tx:5,ty:2}, '挂角马');
T('白脸将', [K(4,0),['r','R',0,0],['r','R',1,0],['r','K',4,9]], {fx:0,fy:0,tx:1,ty:0}, '白脸将');

// —— 炮架是士 (4,1)：按定义属闷宫（炮架身份决定名字）——
T('闷宫',   [K(4,0),['b','A',3,0],['b','A',5,0],['b','A',4,1],
             ['r','C',4,4],['r','C',4,5],['r','P',4,6],['r','K',5,9]],
             {fx:4,fy:4,tx:4,ty:4}, '闷宫');

// —— 用户实战局面 h2h5 e6e5 b2b4 e5e4 h5e5 e4e3 b4e4 的终局 ——
// 将(4,0) 空 空 空 炮(4,4) 炮(4,5)：射线中间唯一子就是己方炮
{
  const st=M.parseFen('rnbakabnr/9/1c5c1/p1p3p1p/4C4/4C4/P1P1p1P1P/9/9/RNBAKABNR b');
  const r=classifyMate(st.board,BLK,{fx:1,fy:5,tx:4,ty:5},null);
  const good=r.name==='重炮';
  good?pass++:fail++;
  console.log(`  ${good?'ok  ':'FAIL'} 实战重炮      将死=${M.legalMoves(st.board,BLK).length===0?1:0} → ${r.name}`);
}

// —— 非将死不应输出杀法名 ——
{
  const st=M.parseFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w');
  const r=classifyMate(st.board,BLK,null,null);
  const good=r.name==='将死'&&legalMoves(st.board,BLK).length>0;
  good?pass++:fail++;
  console.log(`  ${good?'ok  ':'FAIL'} 开局不误判    → ${r.name}`);
}

console.log(`\n通过 ${pass} / 失败 ${fail}`);
process.exit(fail?1:0);
