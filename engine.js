/* 中国象棋规则引擎：盘面、走法、将军、杀法判定、重复局面裁决 */
var RED='r', BLK='b';
var START_FEN='rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
var NAME={r:{K:'帅',A:'仕',B:'相',N:'马',R:'车',C:'炮',P:'兵'},
          b:{K:'将',A:'士',B:'象',N:'马',R:'车',C:'炮',P:'卒'}};

function emptyBoard(){var b=[];for(var y=0;y<10;y++)b.push([null,null,null,null,null,null,null,null,null]);return b;}
function inBoard(x,y){return x>=0&&x<9&&y>=0&&y<10;}

function parseFen(fen){
  var parts=String(fen).trim().split(/\s+/);
  var rows=parts[0].split('/');
  var board=emptyBoard();
  for(var y=0;y<10;y++){
    var x=0, row=rows[y]||'';
    for(var i=0;i<row.length;i++){
      var ch=row[i];
      if(ch>='1'&&ch<='9'){x+=ch.charCodeAt(0)-48;continue;}
      if(!/[a-zA-Z]/.test(ch)){x++;continue;}
      var up=ch.toUpperCase();
      board[y][x]={s:(ch===up?RED:BLK),t:up};
      x++;
    }
  }
  return {board:board,turn:(parts[1]==='b'?BLK:RED)};
}

function toFen(board,turn){
  var rows=[];
  for(var y=0;y<10;y++){
    var s='',e=0;
    for(var x=0;x<9;x++){
      var p=board[y][x];
      if(!p){e++;continue;}
      if(e){s+=e;e=0;}
      s+=(p.s===RED?p.t:p.t.toLowerCase());
    }
    if(e)s+=e;
    rows.push(s);
  }
  return rows.join('/')+' '+(turn===RED?'w':'b');
}

function inPalace(side,x,y){
  if(x<3||x>5)return false;
  return side===RED?(y>=7&&y<=9):(y>=0&&y<=2);
}

function genPseudo(board,side,includeOwn){
  var out=[];
  for(var y=0;y<10;y++){
    for(var x=0;x<9;x++){
      var p=board[y][x];
      if(!p||p.s!==side)continue;
      (function(x,y,p){
        function push(tx,ty){
          if(!inBoard(tx,ty))return;
          var q=board[ty][tx];
          if(q&&q.s===side&&!includeOwn)return;
          out.push({fx:x,fy:y,tx:tx,ty:ty});
        }
        var dirs,i,dx,dy,tx,ty;
        switch(p.t){
          case 'K':
            dirs=[[1,0],[-1,0],[0,1],[0,-1]];
            for(i=0;i<4;i++){dx=dirs[i][0];dy=dirs[i][1];
              if(inPalace(side,x+dx,y+dy))push(x+dx,y+dy);}
            break;
          case 'A':
            dirs=[[1,1],[1,-1],[-1,1],[-1,-1]];
            for(i=0;i<4;i++){dx=dirs[i][0];dy=dirs[i][1];
              if(inPalace(side,x+dx,y+dy))push(x+dx,y+dy);}
            break;
          case 'B':
            dirs=[[2,2],[2,-2],[-2,2],[-2,-2]];
            for(i=0;i<4;i++){
              dx=dirs[i][0];dy=dirs[i][1];
              tx=x+dx;ty=y+dy;
              if(!inBoard(tx,ty))continue;
              if(side===RED&&ty<5)continue;
              if(side===BLK&&ty>4)continue;
              if(board[y+dy/2][x+dx/2])continue;
              push(tx,ty);
            }
            break;
          case 'N':
            dirs=[[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
            for(i=0;i<8;i++){
              dx=dirs[i][0];dy=dirs[i][1];
              tx=x+dx;ty=y+dy;
              if(!inBoard(tx,ty))continue;
              var lx=x+(Math.abs(dx)===2?dx/2:0);
              var ly=y+(Math.abs(dy)===2?dy/2:0);
              if(board[ly][lx])continue;
              push(tx,ty);
            }
            break;
          case 'R':
            dirs=[[1,0],[-1,0],[0,1],[0,-1]];
            for(i=0;i<4;i++){
              dx=dirs[i][0];dy=dirs[i][1];tx=x+dx;ty=y+dy;
              while(inBoard(tx,ty)){
                var q=board[ty][tx];
                if(q){if(includeOwn||q.s!==side)out.push({fx:x,fy:y,tx:tx,ty:ty});break;}
                out.push({fx:x,fy:y,tx:tx,ty:ty});
                tx+=dx;ty+=dy;
              }
            }
            break;
          case 'C':
            dirs=[[1,0],[-1,0],[0,1],[0,-1]];
            for(i=0;i<4;i++){
              dx=dirs[i][0];dy=dirs[i][1];tx=x+dx;ty=y+dy;
              var jumped=false;
              while(inBoard(tx,ty)){
                var q=board[ty][tx];
                if(!jumped){
                  if(q){jumped=true;}
                  else out.push({fx:x,fy:y,tx:tx,ty:ty});
                }else{
                  if(q){if(includeOwn||q.s!==side)out.push({fx:x,fy:y,tx:tx,ty:ty});break;}
                }
                tx+=dx;ty+=dy;
              }
            }
            break;
          case 'P':
            push(x, y+(side===RED?-1:1));
            if(side===RED?y<=4:y>=5){push(x-1,y);push(x+1,y);}
            break;
        }
      })(x,y,p);
    }
  }
  return out;
}

function findKing(board,side){
  for(var y=0;y<10;y++)for(var x=0;x<9;x++){
    var p=board[y][x];
    if(p&&p.t==='K'&&p.s===side)return {x:x,y:y};
  }
  return null;
}

function kingsFace(board){
  var rk=findKing(board,RED), bk=findKing(board,BLK);
  if(!rk||!bk||rk.x!==bk.x)return false;
  var x=rk.x, a=Math.min(rk.y,bk.y), b=Math.max(rk.y,bk.y);
  for(var y=a+1;y<b;y++) if(board[y][x]) return false;
  return true;
}

function isChecked(board,side){
  var k=findKing(board,side);
  if(!k)return true;
  if(kingsFace(board))return true;
  var ms=genPseudo(board, side===RED?BLK:RED);
  for(var i=0;i<ms.length;i++) if(ms[i].tx===k.x&&ms[i].ty===k.y) return true;
  return false;
}

function applyMove(board,m){
  var cap=board[m.ty][m.tx];
  board[m.ty][m.tx]=board[m.fy][m.fx];
  board[m.fy][m.fx]=null;
  return cap;
}
function undoMove(board,m,cap){
  board[m.fy][m.fx]=board[m.ty][m.tx];
  board[m.ty][m.tx]=cap||null;
}

function legalMoves(board,side){
  var ps=genPseudo(board,side), out=[];
  for(var i=0;i<ps.length;i++){
    var m=ps[i];
    var cap=applyMove(board,m);
    var bad=isChecked(board,side);
    undoMove(board,m,cap);
    if(!bad)out.push(m);
  }
  return out;
}

function moveToCode(m){return fileChar(m.fx)+rankChar(m.fy)+fileChar(m.tx)+rankChar(m.ty);}
function fileChar(x){return String.fromCharCode(97+x);}
function rankChar(y){return String(9-y);}
function codeToMove(c){
  var s=String(c||'').trim().toLowerCase();
  if(!/^[a-i][0-9][a-i][0-9]$/.test(s))return null;
  return {fx:s.charCodeAt(0)-97, fy:9-(s.charCodeAt(1)-48),
          tx:s.charCodeAt(2)-97, ty:9-(s.charCodeAt(3)-48)};
}

// 重放棋谱得到终局，用于断线追平与校验
function replay(codes, fen){
  var st=parseFen(fen||START_FEN);
  var board=st.board, turn=st.turn;
  for(var i=0;i<codes.length;i++){
    var m=codeToMove(codes[i]);
    if(!m)return {ok:false,err:'格式错误 '+codes[i],step:i,board:board,turn:turn};
    var lm=legalMoves(board,turn), found=false;
    for(var j=0;j<lm.length;j++){
      if(lm[j].fx===m.fx&&lm[j].fy===m.fy&&lm[j].tx===m.tx&&lm[j].ty===m.ty){found=true;break;}
    }
    if(!found)return {ok:false,err:'非法着法 '+codes[i],step:i,board:board,turn:turn};
    applyMove(board,m);
    turn=(turn===RED?BLK:RED);
  }
  return {ok:true,board:board,turn:turn,steps:codes.length};
}

// 某方走法可达的格子（允许目标是己方子），用于判断有根 / 无根
function guardTargets(board,side){
  var ps=genPseudo(board,side,true), set={};
  for(var i=0;i<ps.length;i++){
    var m=ps[i];
    var q=board[m.ty][m.tx];
    if(q&&q.s===side&&q.t==='K'){set[m.ty*9+m.tx]=1;continue;}
    var cap=applyMove(board,m);
    var ok=!isChecked(board,side);
    undoMove(board,m,cap);
    if(ok)set[m.ty*9+m.tx]=1;
  }
  return set;
}


/* ---------- 重复局面与长打裁决 ---------- */
// 局面标识：盘面 + 轮走方
function posKey(board,side){
  return toFen(board,side);
}

// 是否构成"捉"：走动后存在得子的吃子威胁（无根子，或小换大）
// 规则24.11：捉指走子后能得子，且得子后不致立即被将死
function detectChase(board,side){
  var opp=(side===RED?BLK:RED);
  var myL=legalMoves(board,side);
  if(!myL.length)return false;
  var opG=guardTargets(board,opp);
  var i,m,p,q,v,a;
  for(i=0;i<myL.length;i++){
    m=myL[i];
    q=board[m.ty][m.tx];
    if(!q||q.s!==opp)continue;
    if(q.t==='K'||q.t==='P')continue;          // 捉将不算、捉兵通常不算得子
    v=pieceVal(q,m.ty);
    p=board[m.fy][m.fx];
    a=pieceVal(p,m.fy);
    if(!opG[m.ty*9+m.tx]||a<v)return true;     // 白吃，或小换大
  }
  return false;
}

// 三次重复时裁决：一方全程"打"则该方负，双方都打或都不打判和
function repetitionVerdict(hist){
  if(hist.length<5)return null;
  var last=hist[hist.length-1].key;
  var idx=-1,i,n=0;
  for(i=0;i<hist.length;i++){
    if(hist[i].key===last){n++;if(idx<0&&n>=1)idx=i;}
  }
  if(n<3)return null;

  // 取最近一段循环：从第一次出现到当前
  var seg=hist.slice(idx);
  var redAttack=false,blkAttack=false,redIdle=false,blkIdle=false;
  for(i=0;i<seg.length;i++){
    var e=seg[i];
    if(e.by===RED){
      if(e.check||e.chase)redAttack=true; else redIdle=true;
    }else{
      if(e.check||e.chase)blkAttack=true; else blkIdle=true;
    }
  }
  if(redAttack&&!blkAttack)return {result:'红方长打，黑方胜',loser:RED,name:'长打判负'};
  if(blkAttack&&!redAttack)return {result:'黑方长打，红方胜',loser:BLK,name:'长打判负'};
  return {result:'三次重复，和棋',loser:null,name:'循环和棋'};
}

// 子力估值（用于"捉"的判定）
var PIECE_VAL={K:1000,R:9,C:4.5,N:4,B:2,A:2,P:1};
function pieceVal(p,y){
  if(!p)return 0;
  if(p.t==='P')return (p.s===RED)?(y<=4?2:1):(y>=5?2:1);
  return PIECE_VAL[p.t];
}
