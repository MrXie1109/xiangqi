import fs from 'fs';
const root=new URL('..',import.meta.url).pathname;
const M=new Function(
  fs.readFileSync(root+'engine.js','utf8')+'\n'+fs.readFileSync(root+'mate.js','utf8')+
  `\nreturn {RED,BLK,parseFen,classifyMate,legalMoves,isChecked,findKing,mFeatures,mEscapes};`)();
const {RED,BLK,parseFen,classifyMate,legalMoves,isChecked,findKing,mFeatures}=M;

const labels=JSON.parse(fs.readFileSync(root+'tests/fixtures/labels-100.json','utf8'));
const data=JSON.parse(fs.readFileSync(root+'docs/mate100.json','utf8'));

let pass=0,fail=0;
const wrong=[];
const byLabel={};
for(const d of data){
  const want=labels[String(d.n)];
  if(!want)continue;
  const st=parseFen(d.fen);
  const loser=d.loser==='红'?RED:BLK;
  const got=classifyMate(st.board,loser,null,null).name;
  byLabel[want]=byLabel[want]||{ok:0,total:0};
  byLabel[want].total++;
  if(got===want){pass++;byLabel[want].ok++;}
  else {fail++;wrong.push({n:d.n,want,got,fen:d.fen});}
}
const pct=(pass/(pass+fail)*100).toFixed(1);
console.log(`\n总命中 ${pass} / ${pass+fail}  (${pct}%)\n`);
console.log('按类统计:');
Object.entries(byLabel).sort((a,b)=>b[1].total-a[1].total).forEach(([k,v])=>{
  const p=(v.ok/v.total*100).toFixed(0);
  console.log(`  ${k.padEnd(6)} ${String(v.ok).padStart(2)}/${String(v.total).padEnd(3)} ${p}%`);
});
if(wrong.length){
  console.log('\n判错明细:');
  const g={};
  for(const w of wrong){const k=w.want+' → '+w.got;g[k]=(g[k]||0)+1;}
  Object.entries(g).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k.padEnd(20)} ${v}`));
}
fs.writeFileSync('/tmp/wrong.json',JSON.stringify(wrong,null,1));
