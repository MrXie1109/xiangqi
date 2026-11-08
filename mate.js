/* 杀法判定：特征打分
 *
 * 不再用 if-else 硬判，而是让每种杀法按盘面特征累加分数，取最高分。
 * 规则依据：docs/MATE_RULES.md
 * 权重依据：用户 53 条标注（tests/fixtures/labels-53.json）
 */
/* ---------- 工具 ---------- */
function mBetween(board,ax,ay,bx,by){
  var n=0,x,y;
  if(ax===bx){
    for(y=Math.min(ay,by)+1;y<Math.max(ay,by);y++) if(board[y][ax])n++;
    return n;
  }
  if(ay===by){
    for(x=Math.min(ax,bx)+1;x<Math.max(ax,bx);x++) if(board[ay][x])n++;
    return n;
  }
  return -1;
}
function mAttackers(board,side,k){
  var ms=genPseudo(board,side),out=[],i,q;
  for(i=0;i<ms.length;i++){
    if(ms[i].tx===k.x&&ms[i].ty===k.y){
      q=board[ms[i].fy][ms[i].fx];
      if(q)out.push({t:q.t,x:ms[i].fx,y:ms[i].fy});
    }
  }
  return out;
}
function mInPalace(side,x,y){
  if(x<3||x>5)return false;
  return side===RED?(y>=7&&y<=9):(y>=0&&y<=2);
}

/* ---------- 逃路归因 ---------- */
// 逐格试走，看每条逃路因何失效
function mEscapes(board,loser,k){
  var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  var face=0,self=0,ctl=0,out=0,i;
  for(i=0;i<4;i++){
    var tx=k.x+dirs[i][0], ty=k.y+dirs[i][1];
    if(!mInPalace(loser,tx,ty)){out++;continue;}
    var q=board[ty][tx];
    if(q&&q.s===loser){self++;continue;}
    var cap=board[ty][tx];
    board[ty][tx]=board[k.y][k.x];
    board[k.y][k.x]=null;
    var isFace=kingsFace(board);
    var stillCk=isChecked(board,loser);
    board[k.y][k.x]=board[ty][tx];
    board[ty][tx]=cap;
    if(isFace)face++;
    else if(stillCk)ctl++;
  }
  return {face:face,self:self,ctl:ctl,out:out};
}

/* ---------- 局面特征 ---------- */
// 把盘面拆成一组可比较的量，供各杀法打分
function mFeatures(board,loser,last){
  var k=findKing(board,loser);
  var win=(loser===RED?BLK:RED);
  var esc=mEscapes(board,loser,k);
  var atk=mAttackers(board,win,k);
  var lastPiece=null,lastType='';
  if(last&&board[last.ty]&&board[last.ty][last.tx]){
    lastPiece=board[last.ty][last.tx];
    lastType=lastPiece.t;
  }
  // 同列/同行上的己方炮，及其中"隔一子将军"的炮
  var liveCannon=0,cannonCount=0,cannonNearKing=0,y,q;
  for(y=0;y<10;y++){
    q=board[y][k.x];
    if(q&&q.s===win&&q.t==='C'){
      cannonCount++;
      if(mBetween(board,k.x,y,k.x,k.y)===1)liveCannon++;
      if(Math.abs(y-k.y)<=2)cannonNearKing++;
    }
  }
  for(var x=0;x<9;x++){
    q=board[k.y][x];
    if(q&&q.s===win&&q.t==='C'){
      cannonCount++;
      if(mBetween(board,x,k.y,k.x,k.y)===1)liveCannon++;
    }
  }
  // 车
  var rooks=[],rN=0,rx,ry;
  for(ry=0;ry<10;ry++)for(rx=0;rx<9;rx++){
    q=board[ry][rx];
    if(q&&q.s===win&&q.t==='R'){rooks.push({x:rx,y:ry});rN++;}
  }
  var rookChecking=false,rookOnMid=false,rookDeep=0;
  for(var i=0;i<rooks.length;i++){
    var r=rooks[i];
    if(mAttackers.length){} // 占位
    for(var j=0;j<atk.length;j++) if(atk[j].x===r.x&&atk[j].y===r.y) rookChecking=true;
    if(r.x===k.x)rookOnMid=true;
    if((loser===BLK)?(r.y<=4):(r.y>=5))rookDeep++;
  }
  // 马位
  var horseNear=false,horseCheck=false,hy;
  for(hy=0;hy<10;hy++)for(var hx=0;hx<9;hx++){
    q=board[hy][hx];
    if(q&&q.s===win&&q.t==='N'){
      if(Math.abs(hx-k.x)<=2&&Math.abs(hy-k.y)<=2)horseNear=true;
      for(var j2=0;j2<atk.length;j2++) if(atk[j2].x===hx&&atk[j2].y===hy) horseCheck=true;
    }
  }
  // 己方士
  var advisorNear=false,ay;
  for(ay=0;ay<10;ay++)for(var ax2=0;ax2<9;ax2++){
    q=board[ay][ax2];
    if(q&&q.s===loser&&q.t==='A'&&(Math.abs(ax2-k.x)+Math.abs(ay-k.y))===1)advisorNear=true;
  }
  return {
    _board:board, _cap:null, _lastMid:0,
    esc:esc, atk:atk, atkN:atk.length, atkTypes:atk.map(function(a){return a.t;}).sort().join(''),
    lastType:lastType, lastPiece:lastPiece,
    liveCannon:liveCannon, cannonCount:cannonCount, cannonNearKing:cannonNearKing,
    rookN:rN, rookChecking:rookChecking, rookOnMid:rookOnMid, rookDeep:rookDeep, rooks:rooks,
    horseNear:horseNear, horseCheck:horseCheck, advisorNear:advisorNear,
    k:k, win:win
  };
}

/* ---------- 打分器 ---------- */
// 每个函数返回 {name, score}，score 为 0 表示该杀法不成立
// 攻击方视角的马位（ax=路0..8，ay=线0..9，ay=0 为对方底线）
function mHorseSpotsOf(f){
  var out=[],y,x,p;
  for(y=0;y<10;y++)for(x=0;x<9;x++){
    p=f._board[y][x];
    if(!p||p.s!==f.win||p.t!=='N')continue;
    out.push({ax:(f.win===BLK)?x:8-x, ay:(f.win===BLK)?y:9-y});
  }
  return out;
}
function mMatchHorse(f,spots){
  if(!f.horseNear&&!f.horseCheck)return 0;
  var hs=mHorseSpotsOf(f),i,j;
  for(i=0;i<hs.length;i++)for(j=0;j<spots.length;j++)
    if(hs[i].ax===spots[j][0]&&hs[i].ay===spots[j][1])return 1;
  return 0;
}

var MATE_SCORERS=[
  // 白脸将：逃路被照面规则封死（用户标注 25 例，全部含 face）
  function(f){
    var s=0;
    if(f.esc.face>=1)s=72;
    else return 0;                    // 必须有照面
    if(f.esc.face===1)s+=6;
    if(f.esc.ctl>=1)s+=8;
    if(f.atkTypes==='R')s+=8;
    if(f.atkTypes==='C')s+=4;
    if(f.esc.self===0)s+=6;
    return {name:'白脸将',score:s};
  },
  // 闷杀：逃路被己方子堵死，且没有照面（用户标注 7 例，自堵都是 1~2 条）
  function(f){
    if(f.esc.self===0)return 0;
    if(f.esc.face>0)return 0;         // 有照面的归白脸将
    var s=46;
    if(f.esc.self===1)s+=14;
    if(f.esc.self>=2)s+=8;
    if(f.esc.ctl===1)s+=12;
    if(f.esc.ctl>=2)s+=2;
    if(f.atkTypes==='R')s+=6;
    return {name:'闷杀',score:s};
  },
  // 闷宫：炮以士为架，士紧贴将
  function(f){
    if(f.atkTypes!=='C'&&f.atkTypes.indexOf('C')<0)return 0;
    if(!f.advisorNear)return 0;
    if(f.liveCannon<1)return 0;
    return {name:'闷宫',score:78+f.liveCannon*6};
  },
  // 重炮：同线双炮，一炮作架
  function(f){
    if(f.cannonCount<2)return 0;
    if(f.liveCannon<1)return 0;
    return {name:'重炮',score:58+f.liveCannon*8};
  },
  // 马后炮：马贴将 + 身后有炮将军
  function(f){
    if(f.atkTypes.indexOf('C')<0)return 0;
    if(!f.horseNear)return 0;
    return {name:'马后炮',score:56};
  },
  // ——马类：按绝对马位判定——
  // 卧槽马：马在对方第8线二六路
  function(f){
    if(!mMatchHorse(f,[[2,8],[6,8]]))return 0;
    return {name:'卧槽马',score:58};
  },
  // 八角马：马占对方九宫角
  function(f){
    if(!mMatchHorse(f,[[3,7],[5,7],[3,9],[5,9],[4,8]]))return 0;
    return {name:'八角马',score:58};
  },
  // 钓鱼马：马在对方第7线
  function(f){
    if(!mMatchHorse(f,[[2,7],[6,7]]))return 0;
    return {name:'钓鱼马',score:56};
  },
  // 侧面虎：马在对方第6线
  function(f){
    if(!mMatchHorse(f,[[3,6],[6,6],[3,5]]))return 0;
    return {name:'侧面虎',score:56};
  },
  // 铁门栓：炮镇中路 + 车将军
  function(f){
    var i,mid=false;
    for(i=0;i<10;i++){
      var p=f._board[i][f.k.x];
      if(p&&p.s===f.win&&p.t==='C')mid=true;
    }
    if(!mid||!f.rookChecking)return 0;
    return {name:'铁门栓',score:52};
  },
  // 大刀剜心：末手吃掉对方士，落点在中线
  function(f){
    if(!f._cap||f._cap.t!=='A')return 0;
    if(f._lastMid!==1)return 0;
    return {name:'大刀剜心',score:57};
  },
  // 双车错
  function(f){
    if(f.rookN<2)return 0;
    if(!f.rookChecking)return 0;
    var i,j,a,b;
    for(i=0;i<f.rooks.length;i++)for(j=i+1;j<f.rooks.length;j++){
      a=f.rooks[i];b=f.rooks[j];
      if(a.x===b.x||a.y===b.y)continue;
      return {name:'双车错',score:55};
    }
    return 0;
  },
  // 双照将
  function(f){
    if(f.atkN<2)return 0;
    return {name:'双照将',score:53+f.atkN*4};
  }
];

// 从特征里取末手坐标
function last_x(f){ return f._lx; }
function last_y(f){ return f._ly; }

/* ---------- 主判定 ---------- */
function classifyMate(board,loser,last,lastCapture){
  var k=findKing(board,loser);
  if(!k)return {name:'将死',color:'#ffd479'};
  if(legalMoves(board,loser).length!==0)return {name:'将死',color:'#ffd479'};

  // 未将军却无子可走 = 困毙
  if(!isChecked(board,loser))return {name:'困毙',color:'#9aa0a6'};

  var f=mFeatures(board,loser,last);

  // 末手推断：调用方没给 last 时，认为"将军的己方子"就是刚落的那枚
  var lx=-9,ly=-9,lt='';
  if(last&&last.tx!=null){
    lx=last.tx; ly=last.ty;
    if(board[ly]&&board[ly][lx]) lt=board[ly][lx].t;
  }else if(f.atk.length){
    var pick=f.atk[0];
    for(var ai=1;ai<f.atk.length;ai++){
      var da=Math.abs(f.atk[ai].x-k.x)+Math.abs(f.atk[ai].y-k.y);
      var db=Math.abs(pick.x-k.x)+Math.abs(pick.y-k.y);
      if(da<db)pick=f.atk[ai];
    }
    lx=pick.x; ly=pick.y; lt=pick.t;
  }
  f._lx=lx; f._ly=ly; f.lastType=lt;
  f._cap=lastCapture||null;
  f._lastMid=(last&&last.tx===k.x)?1:0;

  var best=null,i,r;
  for(i=0;i<MATE_SCORERS.length;i++){
    r=MATE_SCORERS[i](f);
    if(r&&r.score>0&&(!best||r.score>best.score))best=r;
  }
  if(!best)return {name:'将死',color:'#ffd479'};

  var COLORS={
    '白脸将':'#ffffff','闷杀':'#ff8a5c','闷宫':'#ff8a5c','重炮':'#ff6b3d',
    '马后炮':'#ff9f1c','卧槽马':'#35d0c0','挂角马':'#8b7bff','八角马':'#c084fc',
    '钓鱼马':'#60a5fa','侧面虎':'#74c0fc','双车错':'#d9e6ff','双照将':'#ff4d6d'
  };
  return {name:best.name,color:COLORS[best.name]||'#ffd479',score:best.score};
}
