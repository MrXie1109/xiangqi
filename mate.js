/* 杀法判定：依赖 engine.js，不依赖 DOM
 *
 * 定义来源：docs/MATE_RULES.md
 * 原则：坐标与几何可直接判定的才实现；凡涉及"步步紧逼""弃子""抽将"过程的，
 *       终局盘面无法确证，一律不实现，回落"将死 / 困毙"。
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
function mAttacks(board,side,fx,fy,tx,ty){
  var ms=genPseudo(board,side);
  for(var i=0;i<ms.length;i++){
    if(ms[i].fx===fx&&ms[i].fy===fy&&ms[i].tx===tx&&ms[i].ty===ty)return true;
  }
  return false;
}
function mAttackerCount(board,side,k){
  var ms=genPseudo(board,side),set={},i;
  for(i=0;i<ms.length;i++){
    if(ms[i].tx===k.x&&ms[i].ty===k.y)set[ms[i].fy*9+ms[i].fx]=1;
  }
  return Object.keys(set).length;
}
function mPieceAt(board,x,y){ return board[y]&&board[y][x]; }
function mOwnHalf(loser,y){ return (loser===BLK)?(y<=4):(y>=5); }

/* ---------- 逐条判定 ---------- */

// 白脸将 / 对面笑：两将同列且中间无子（将帅不得对面）
// 源：象棋物语 23；百度百科·绝杀
function isFacing(board,loser,k,win){
  var o=findKing(board,win);
  if(!o||o.x!==k.x)return false;
  return mBetween(board,o.x,o.y,k.x,k.y)===0;
}

// 双照将 / 双将：一步棋使己方两个棋子同时将军
// 源：象棋物语 24
function isDoubleCheck(board,loser,k,win){
  return mAttackerCount(board,win,k)>=2;
}

// 重炮：双炮重叠一条线，一炮作架、一炮将军
// 源：象棋物语 15；百度百科·重迭炮
function isHeavyCannon(board,loser,k,win){
  // 从将往棋盘内部扫（避免将贴边时方向扫反）
  var d=(k.y===0)?1:-1, seq=[], y=k.y+d, q;
  while(y>=0&&y<10){
    q=board[y][k.x];
    if(q)seq.push(q);
    y+=d;
  }
  // 跳过炮架（第一个子），其后必须连续两门己方炮
  if(seq.length<3)return false;
  return seq[1].s===win&&seq[1].t==='C'&&seq[2].s===win&&seq[2].t==='C';
}

// 闷宫：单炮以对方士为架，将在九宫原位无法脱身
// 源：象棋物语 17；百度百科·闷宫「炮架一定是士，将帅紧贴炮架子」
function isSmotheredPalace(board,loser,k,win){
  var dirs=[[1,0],[-1,0],[0,1],[0,-1]],i;
  for(i=0;i<4;i++){
    var sx=k.x+dirs[i][0], sy=k.y+dirs[i][1];
    if(!inBoard(sx,sy))continue;
    var q=board[sy][sx];
    if(!q||q.s!==loser||q.t!=='A')continue;
    var dx=dirs[i][0],dy=dirs[i][1],px=sx+dx,py=sy+dy;
    while(inBoard(px,py)){
      var p=board[py][px];
      if(p){
        if(p.s===win&&p.t==='C')return mAttacks(board,win,px,py,k.x,k.y);
        break;
      }
      px+=dx;py+=dy;
    }
  }
  return false;
}

// 臣压君：将被自己的棋子堵住去路而被将死
// 源：象棋物语 26
function isChenYaJun(board,loser,k){
  var dirs=[[1,0],[-1,0],[0,1],[0,-1]],i,n=0;
  for(i=0;i<4;i++){
    var tx=k.x+dirs[i][0], ty=k.y+dirs[i][1];
    if(!inPalace(loser,tx,ty))continue;
    var q=board[ty][tx];
    if(q&&q.s===loser)n++;
  }
  return n>0;
}

// 卧槽马：马在对方底象前一格（三·九 / 七·九）
// 源：象棋物语 6；百度百科·绝杀「三·九或七·九」
function isWoCaoHorse(board,loser,k,last,win){
  if(!last)return false;
  var p=mPieceAt(board,last.tx,last.ty);
  if(!p||p.s!==win||p.t!=='N')return false;
  if(last.tx!==1&&last.tx!==7)return false;
  var row=(loser===BLK)?2:7;
  if(last.ty!==row)return false;
  return mAttacks(board,win,last.tx,last.ty,k.x,k.y);
}

// 挂角马：马在九宫士角将军
// 源：象棋物语 7
function isGuaJiaoHorse(board,loser,k,last,win){
  if(!last)return false;
  var p=mPieceAt(board,last.tx,last.ty);
  if(!p||p.s!==win||p.t!=='N')return false;
  if(last.tx!==3&&last.tx!==5)return false;
  var row=(loser===BLK)?2:7;
  if(last.ty!==row)return false;
  return mAttacks(board,win,last.tx,last.ty,k.x,k.y);
}

// 八角马：马在士角，与将成对角田字
// 源：象棋物语 9
function isBaJiaoHorse(board,loser,k,last,win){
  if(!last)return false;
  var p=mPieceAt(board,last.tx,last.ty);
  if(!p||p.s!==win||p.t!=='N')return false;
  if(Math.abs(last.tx-k.x)!==1||Math.abs(last.ty-k.y)!==1)return false;
  return mAttacks(board,win,last.tx,last.ty,k.x,k.y);
}

// 钓鱼马：马在三·三 / 七·三，控将门
// 源：象棋物语 1「用马在对方三．三或七．三位置上照将，或者控制对方将的活动」
function isDiaoYuHorse(board,loser,k,last,win){
  if(!last)return false;
  var p=mPieceAt(board,last.tx,last.ty);
  if(!p||p.s!==win||p.t!=='N')return false;
  if(last.tx!==1&&last.tx!==7)return false;
  var row=(loser===BLK)?3:6;      // 三·三 = 对方第3横线
  if(last.ty!==row)return false;
  return Math.abs(last.tx-k.x)<=2||mAttacks(board,win,last.tx,last.ty,k.x,k.y);
}

// 侧面虎（高钓马）：马在三·四 / 七·四
// 源：象棋物语 8
function isSideTiger(board,loser,k,last,win){
  if(!last)return false;
  var p=mPieceAt(board,last.tx,last.ty);
  if(!p||p.s!==win||p.t!=='N')return false;
  if(last.tx!==1&&last.tx!==7)return false;
  var row=(loser===BLK)?4:5;
  if(last.ty!==row)return false;
  return Math.abs(last.tx-k.x)<=2;
}

// 马后炮：马与将同线隔一格，炮在马后将军
// 源：象棋物语 10
function isHorseCannon(board,loser,k,last,win){
  if(!last)return false;
  var p=mPieceAt(board,last.tx,last.ty);
  if(!p||p.s!==win||p.t!=='N')return false;
  if(Math.abs(last.tx-k.x)+Math.abs(last.ty-k.y)!==1)return false;
  var dx=(last.tx===k.x?0:(last.tx>k.x?1:-1));
  var dy=(last.ty===k.y?0:(last.ty>k.y?1:-1));
  var px=last.tx+dx, py=last.ty+dy;
  while(inBoard(px,py)){
    var q=board[py][px];
    if(q){
      if(q.s===win&&q.t==='C')return mAttacks(board,win,px,py,k.x,k.y);
      return false;
    }
    px+=dx;py+=dy;
  }
  return false;
}

// 双车错：双车交替将军
// 源：象棋物语 29
function isDoubleRook(board,loser,k,win){
  var rooks=[],y,x,p,i,j;
  for(y=0;y<10;y++)for(x=0;x<9;x++){
    p=board[y][x];
    if(p&&p.s===win&&p.t==='R')rooks.push({x:x,y:y});
  }
  for(i=0;i<rooks.length;i++){
    for(j=i+1;j<rooks.length;j++){
      var a=rooks[i],b=rooks[j];
      if(a.x===b.x||a.y===b.y)continue;
      if(mAttacks(board,win,a.x,a.y,k.x,k.y)||mAttacks(board,win,b.x,b.y,k.x,k.y))return true;
    }
  }
  return false;
}

/* ---------- 主判定 ---------- */
function classifyMate(board,loser,last,lastCapture){
  var k=findKing(board,loser);
  var win=(loser===RED?BLK:RED);
  if(!k)return {name:'将死',color:'#ffd479'};
  if(legalMoves(board,loser).length!==0)return {name:'将死',color:'#ffd479'};

  // 未被将军却无子可动 = 困毙（源：象棋物语 18；百度百科·困毙）
  if(!isChecked(board,loser))return {name:'困毙',color:'#9aa0a6'};

  if(isFacing(board,loser,k,win))return {name:'白脸将',color:'#ffffff'};
  if(isDoubleCheck(board,loser,k,win))return {name:'双照将',color:'#ff4d6d'};
  if(isHeavyCannon(board,loser,k,win))return {name:'重炮',color:'#ff6b3d'};
  if(isSmotheredPalace(board,loser,k,win))return {name:'闷宫',color:'#ff8a5c'};
  if(isHorseCannon(board,loser,k,last,win))return {name:'马后炮',color:'#ff9f1c'};
  if(isWoCaoHorse(board,loser,k,last,win))return {name:'卧槽马',color:'#35d0c0'};
  if(isGuaJiaoHorse(board,loser,k,last,win))return {name:'挂角马',color:'#8b7bff'};
  if(isBaJiaoHorse(board,loser,k,last,win))return {name:'八角马',color:'#c084fc'};
  if(isDiaoYuHorse(board,loser,k,last,win))return {name:'钓鱼马',color:'#60a5fa'};
  if(isSideTiger(board,loser,k,last,win))return {name:'侧面虎',color:'#74c0fc'};
  if(isDoubleRook(board,loser,k,win))return {name:'双车错',color:'#d9e6ff'};
  if(isChenYaJun(board,loser,k))return {name:'臣压君',color:'#f5d0a9'};

  return {name:'将死',color:'#ffd479'};
}
