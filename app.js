/* 渲染、交互、联机与界面 */
/* ============================ 引擎 ============================ */


/* ============================ 应用 ============================ */
var el=function(id){return document.getElementById(id);};
var canvas=el('board'), ctx=canvas.getContext('2d');

var BROKER='wss://broker.emqx.io:8084/mqtt';
var G={board:parseFen(START_FEN).board,turn:RED,moves:[],last:null,over:false,result:'',green:[],red:[],warn:[],inCheck:false,hist:[]};
var mode='mqtt', mySide=null, room='', link=null, linkState='', peerOnline=false, peerConflict=false;
var mySid='s'+Math.random().toString(36).slice(2,10);
var sel=null, hints=[], flip=false;
var S=40,PAD=32,DPR=1;


/* ---------- 音效：Web Audio 合成，不用外部音频文件 ---------- */
var audioCtx=null;

function ensureAudio(){
  if(!audioCtx){
    try{
      var AC=window.AudioContext||window.webkitAudioContext;
      if(AC)audioCtx=new AC();
    }catch(e){}
  }
  if(audioCtx&&audioCtx.state==='suspended'){audioCtx.resume();}
  return audioCtx;
}

// 木棋落盘的敲击声：噪声爆破 + 低频体
function knock(ac,freq,vol,dur,decay){
  var t=ac.currentTime;
  var len=Math.max(1,Math.floor(ac.sampleRate*dur));
  var buf=ac.createBuffer(1,len,ac.sampleRate);
  var d=buf.getChannelData(0);
  for(var i=0;i<len;i++){
    d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay);
  }
  var src=ac.createBufferSource(); src.buffer=buf;
  var bp=ac.createBiquadFilter();
  bp.type='bandpass'; bp.frequency.value=freq; bp.Q.value=1.1;
  var g=ac.createGain(); g.gain.value=vol;
  src.connect(bp); bp.connect(g); g.connect(ac.destination);
  src.start(t);
  src.stop(t+dur+0.02);

  var osc=ac.createOscillator();
  osc.type='sine';
  osc.frequency.setValueAtTime(freq*0.55,t);
  osc.frequency.exponentialRampToValueAtTime(freq*0.28,t+dur);
  var og=ac.createGain();
  og.gain.setValueAtTime(vol*0.55,t);
  og.gain.exponentialRampToValueAtTime(0.0008,t+dur);
  osc.connect(og); og.connect(ac.destination);
  osc.start(t); osc.stop(t+dur+0.02);
}

function sfx(kind){
  var ac=ensureAudio();
  if(!ac)return;
  if(kind==='move'){
    knock(ac,1250,0.22,0.055,7);
  }else if(kind==='capture'){
    knock(ac,620,0.42,0.13,5);
    setTimeout(function(){ if(audioCtx)knock(audioCtx,980,0.18,0.04,8); },28);
  }else if(kind==='check'){
    knock(ac,520,0.30,0.16,4);
  }
}

/* ---------- 渲染 ---------- */
function X(x){return PAD+(flip?8-x:x)*S;}
function Y(y){return PAD+(flip?9-y:y)*S;}

function layout(){
  var w=el('boardWrap').clientWidth||360;
  S=Math.max(24,Math.floor(w/9.6));
  PAD=Math.round(S*0.8);
  var cw=S*8+PAD*2, ch=S*9+PAD*2;
  DPR=window.devicePixelRatio||1;
  canvas.width=Math.round(cw*DPR);
  canvas.height=Math.round(ch*DPR);
  canvas.style.width=cw+'px';
  canvas.style.height=ch+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
  draw();
}

var fx=[], shakeUntil=0, shakeStart=0, shakeMag=0, rafId=0, lastTs=0, anim=null;
var radial=null;   // 将军时的震荡波：把周围棋子推开再弹回

function drawPiece(cx,cy,side,type,scale){
  var r=S*0.42*scale;
  ctx.beginPath();ctx.arc(cx,cy,r,0,6.2832);
  ctx.fillStyle='#fbf3d9';ctx.fill();
  ctx.lineWidth=Math.max(1.4,S*0.045);
  ctx.strokeStyle=(side===RED?'#a8302a':'#2b2b2b');
  ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,r*0.85,0,6.2832);
  ctx.lineWidth=Math.max(1,S*0.018);ctx.stroke();
  ctx.fillStyle=(side===RED?'#a8302a':'#2b2b2b');
  ctx.font='bold '+Math.round(S*0.52*scale)+'px "KaiTi","STKaiti","SimSun",serif';
  ctx.fillText(NAME[side][type],cx,cy+S*0.02*scale);
}

function playMoveAnim(m,cap,onEnd){
  var dist=Math.max(Math.abs(m.tx-m.fx),Math.abs(m.ty-m.fy));
  var p=G.board[m.ty]&&G.board[m.ty][m.tx];
  if(!p){ if(onEnd)onEnd(); return; }
  anim={fx:m.fx,fy:m.fy,tx:m.tx,ty:m.ty,piece:p,eat:cap||null,
        t0:performance.now(),dur:Math.min(340,140+dist*42),onEnd:onEnd};
  requestDraw();
}

function doShake(dur,mag){
  var t=performance.now();
  shakeStart=t; shakeUntil=t+dur; shakeMag=mag;
  requestDraw();
}

function requestDraw(){ if(!rafId)rafId=requestAnimationFrame(tick); }
function tick(ts){
  rafId=0;
  if(ts-lastTs<33){ rafId=requestAnimationFrame(tick); return; }
  lastTs=ts;
  if(anim&&(ts-anim.t0)>=anim.dur){
    var cb=anim.onEnd;
    anim=null;
    if(cb)setTimeout(cb,0);
  }
  draw(ts);
  var alive=fx.length>0||G.green.length||G.red.length||G.warn.length||ts<shakeUntil||anim||radial||(G.inCheck&&!G.over);
  if(alive&&!rafId)rafId=requestAnimationFrame(tick);
}

function hexA(hex,a){
  var n=parseInt(hex.slice(1),16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';
}

function makeShards(color,n){
  var a=[],i,ang,sp;
  for(i=0;i<n;i++){
    ang=Math.random()*6.2832; sp=0.45+Math.random()*0.95;
    a.push({dx:Math.cos(ang)*sp,dy:Math.sin(ang)*sp,c:(Math.random()<0.34?'#ffffff':color)});
  }
  return a;
}

function addBurst(x,y,color){
  fx.push({kind:'burst',x:x,y:y,color:color,t0:performance.now(),dur:640,shards:makeShards(color,11)});
  requestDraw();
}

function triggerRadial(gx,gy){
  radial={gx:gx,gy:gy,cx:X(gx),cy:Y(gy),t0:performance.now(),dur:700};
  requestDraw();
}

// 只做光效，不动棋子：棋子位置一旦被推开，怎么调都像穿模
function radialPulse(now){
  if(!radial)return null;
  var t=(now-radial.t0)/radial.dur;
  if(t>=1){radial=null;return null;}
  return t;
}

function addMate(x,y,color){
  fx.push({kind:'mate',x:x,y:y,color:color,t0:performance.now(),dur:2600,
           rays:12,spin:0.4+Math.random()*0.5});
  requestDraw();
}

function boardPos(x,y){
  var cr=canvas.getBoundingClientRect(), wr=el('boardWrap').getBoundingClientRect();
  return {x:X(x)+cr.left-wr.left, y:Y(y)+cr.top-wr.top};
}

function bigText(text,opt){
  opt=opt||{};
  var wrap=el('boardWrap');
  var d=document.createElement('div');
  d.className='bigtext'+(opt.cls?(' '+opt.cls):'');
  d.textContent=text;
  var col=opt.color||'#ffd479';
  d.style.color=col;
  d.style.fontSize=Math.round(opt.size||44)+'px';
  d.style.textShadow='0 0 18px '+col+',0 0 46px '+col+',0 3px 12px rgba(0,0,0,.9)';
  if(opt.x!=null){d.style.left=opt.x+'px';d.style.top=opt.y+'px';}
  else{d.style.left='50%';d.style.top='46%';}
  d.style.animationDuration=(opt.dur||1000)+'ms';
  wrap.appendChild(d);
  setTimeout(function(){ if(d.parentNode)d.parentNode.removeChild(d); },(opt.dur||1000)+120);
  return d;
}

function clearBigText(){
  var olds=document.querySelectorAll('.bigtext');
  for(var i=0;i<olds.length;i++)olds[i].remove();
}

function showBanner(name,color){
  clearBigText();
  var fl=el('flash');
  if(fl){fl.classList.remove('on');void fl.offsetWidth;fl.classList.add('on');}
  var b=el('banner'), t=b.querySelector('.t');
  t.textContent=name;
  t.style.color=color;
  t.style.textShadow='0 0 26px '+color+',0 4px 14px rgba(0,0,0,.75)';
  b.classList.remove('on');
  void b.offsetWidth;
  b.classList.add('on');
  if(showBanner._t)clearTimeout(showBanner._t);
  showBanner._t=setTimeout(function(){b.classList.remove('on');},2800);
}

function auraAt(x,y,color,phase){
  var cx=X(x),cy=Y(y),r=S*0.42;
  var pulse=0.7+0.3*Math.sin(phase);
  var g=ctx.createRadialGradient(cx,cy,r*0.55,cx,cy,r*1.85);
  g.addColorStop(0,hexA(color,0.34*pulse));
  g.addColorStop(0.5,hexA(color,0.15*pulse));
  g.addColorStop(1,hexA(color,0));
  ctx.fillStyle=g;
  ctx.beginPath();ctx.arc(cx,cy,r*1.85,0,6.2832);ctx.fill();
}

function ringAt(x,y,color,phase,dashed){
  var cx=X(x),cy=Y(y),r=S*0.42;
  var pulse=0.65+0.35*Math.sin(phase);
  ctx.save();
  ctx.strokeStyle=color;
  ctx.globalAlpha=0.55+0.35*pulse;
  ctx.lineWidth=Math.max(2,S*0.08);
  ctx.shadowColor=color;
  ctx.shadowBlur=S*0.75*pulse;
  if(dashed){
    ctx.setLineDash([S*0.19,S*0.13]);
    ctx.lineDashOffset=-phase*S*0.34;
  }
  ctx.beginPath();ctx.arc(cx,cy,r*1.03,0,6.2832);ctx.stroke();
  ctx.restore();
}

function drawFx(now){
  var W=S*8+PAD*2,H=S*9+PAD*2;
  for(var i=fx.length-1;i>=0;i--){
    var f=fx[i];
    var t=(now-f.t0)/f.dur;
    if(t>=1){fx.splice(i,1);continue;}
    if(t<0)continue;
    var e=1-Math.pow(1-t,3);
    var j,s,px,py,ang,r0,r1,tt,ee,a,dk,g2,w;
    if(f.kind==='burst'){
      ctx.save();
      ctx.globalAlpha=(1-t)*0.85;
      ctx.strokeStyle=f.color;
      ctx.lineWidth=Math.max(1.5,S*0.075*(1-t));
      ctx.beginPath();ctx.arc(f.x,f.y,S*0.35+e*S*1.45,0,6.2832);ctx.stroke();
      for(j=0;j<f.shards.length;j++){
        s=f.shards[j];
        px=f.x+s.dx*e*S*1.9;
        py=f.y+s.dy*e*S*1.9+S*1.15*t*t;
        ctx.globalAlpha=Math.max(0,1-t*1.15);
        ctx.fillStyle=s.c;
        ctx.beginPath();ctx.arc(px,py,Math.max(0.6,S*0.085*(1-t*0.6)),0,6.2832);ctx.fill();
      }
      w=Math.max(0,1-t*2.4);
      if(w>0){
        ctx.globalAlpha=w*0.85;
        ctx.fillStyle='#fff';
        ctx.beginPath();ctx.arc(f.x,f.y,S*0.46*(1-t),0,6.2832);ctx.fill();
      }
      ctx.restore();
    }else if(f.kind==='mate'){
      for(var rr=0;rr<3;rr++){
        tt=t-rr*0.16;
        if(tt<0||tt>1)continue;
        ee=1-Math.pow(1-tt,3);
        ctx.save();
        ctx.globalAlpha=(1-tt)*0.85;
        ctx.strokeStyle=f.color;
        ctx.lineWidth=Math.max(2,S*0.1*(1-tt));
        ctx.shadowColor=f.color;ctx.shadowBlur=S*0.9;
        ctx.beginPath();ctx.arc(f.x,f.y,S*0.4+ee*S*3.4,0,6.2832);ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.globalAlpha=Math.max(0,1-t*1.5);
      ctx.strokeStyle=f.color;ctx.lineWidth=Math.max(1.5,S*0.045);
      ctx.shadowColor=f.color;ctx.shadowBlur=S*0.45;
      for(a=0;a<f.rays;a++){
        ang=(a/f.rays)*6.2832+f.spin*t*3;
        r0=S*0.5+e*S*1.0; r1=S*0.5+e*S*2.4;
        ctx.beginPath();
        ctx.moveTo(f.x+Math.cos(ang)*r0,f.y+Math.sin(ang)*r0);
        ctx.lineTo(f.x+Math.cos(ang)*r1,f.y+Math.sin(ang)*r1);
        ctx.stroke();
      }
      ctx.restore();
      dk=Math.max(0,1-Math.abs(t-0.15)*1.7);
      if(dk>0){
        ctx.save();
        ctx.globalAlpha=dk*0.5;
        g2=ctx.createRadialGradient(f.x,f.y,S*0.5,f.x,f.y,Math.max(W,H)*0.78);
        g2.addColorStop(0,'rgba(0,0,0,0)');
        g2.addColorStop(1,'rgba(0,0,0,1)');
        ctx.fillStyle=g2;
        ctx.fillRect(-S*2,-S*2,W+S*4,H+S*4);
        ctx.restore();
      }
    }
  }
}

function draw(now){
  now=now||performance.now();
  var W=S*8+PAD*2,H=S*9+PAD*2;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#e7cd99';
  ctx.fillRect(0,0,W,H);

  var shaking=now<shakeUntil;
  ctx.save();
  if(shaking){
    var kk=(shakeUntil-now)/650;
    ctx.translate((Math.random()-0.5)*S*0.26*kk,(Math.random()-0.5)*S*0.26*kk);
  }

  ctx.strokeStyle='#8a6b3a';
  ctx.lineWidth=Math.max(1,S*0.026);
  ctx.lineCap='round';

  var x,y,i;
  for(y=0;y<10;y++){
    ctx.beginPath();ctx.moveTo(X(0),Y(y));ctx.lineTo(X(8),Y(y));ctx.stroke();
  }
  for(x=0;x<9;x++){
    ctx.beginPath();
    if(x===0||x===8){
      ctx.moveTo(X(x),Y(0));ctx.lineTo(X(x),Y(9));
    }else{
      ctx.moveTo(X(x),Y(0));ctx.lineTo(X(x),Y(4));
      ctx.moveTo(X(x),Y(5));ctx.lineTo(X(x),Y(9));
    }
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(X(3),Y(0));ctx.lineTo(X(5),Y(2));
  ctx.moveTo(X(5),Y(0));ctx.lineTo(X(3),Y(2));
  ctx.moveTo(X(3),Y(7));ctx.lineTo(X(5),Y(9));
  ctx.moveTo(X(5),Y(7));ctx.lineTo(X(3),Y(9));
  ctx.stroke();

  ctx.fillStyle='#9a7a45';
  ctx.font=Math.round(S*0.46)+'px "KaiTi","STKaiti",serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  var mid=(Y(4)+Y(5))/2;
  ctx.fillText('楚  河', X(2), mid);
  ctx.fillText('汉  界', X(6), mid);

  if(!G.board){ctx.restore();return;}

  var phase=now/300;

  // 上一手
  if(G.last){
    ctx.strokeStyle='rgba(80,140,90,.9)';
    ctx.lineWidth=Math.max(2,S*0.06);
    [G.last.fx,G.last.tx].forEach(function(cx2,idx){
      var cy2=idx===0?G.last.fy:G.last.ty;
      ctx.strokeRect(X(cx2)-S*0.34,Y(cy2)-S*0.34,S*0.68,S*0.68);
    });
  }

  // 底层光晕：绿=可白吃，红=我方无根被打击
  for(i=0;i<G.green.length;i++)auraAt(G.green[i][0],G.green[i][1],'#22cc6a',phase);
  for(i=0;i<G.red.length;i++)auraAt(G.red[i][0],G.red[i][1],'#ff3b30',phase);
  for(i=0;i<G.warn.length;i++)auraAt(G.warn[i][0],G.warn[i][1],'#ffc53d',phase*0.7);

  // 棋子（正在滑行的那枚先不画在落点）
  for(y=0;y<10;y++)for(x=0;x<9;x++){
    var p=G.board[y][x];
    if(!p)continue;
    if(anim&&x===anim.tx&&y===anim.ty)continue;
    drawPiece(X(x),Y(y),p.s,p.t,1);
  }

  // 将军脉冲：将位向外扩两圈淡金环
  var rp=radialPulse(now);
  if(rp!==null){
    for(var ri=0;ri<2;ri++){
      var rt2=rp-ri*0.18;
      if(rt2<0||rt2>1)continue;
      ctx.save();
      ctx.globalAlpha=(1-rt2)*0.30;
      ctx.strokeStyle='#ffcf6a';
      ctx.lineWidth=Math.max(1.5,S*0.06*(1-rt2));
      ctx.shadowColor='#ffb020';
      ctx.shadowBlur=S*0.55;
      ctx.beginPath();
      ctx.arc(radial.cx,radial.cy,S*0.45+rt2*S*2.4,0,6.2832);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha=Math.max(0,(1-rp)*0.55);
    var gg=ctx.createRadialGradient(radial.cx,radial.cy,S*0.2,radial.cx,radial.cy,S*1.9);
    gg.addColorStop(0,'rgba(255,190,90,0.5)');
    gg.addColorStop(1,'rgba(255,190,90,0)');
    ctx.fillStyle=gg;
    ctx.beginPath();ctx.arc(radial.cx,radial.cy,S*1.9,0,6.2832);ctx.fill();
    ctx.restore();
  }

  // 滑行动画：被吃子保留原位，动画结束才消失
  if(anim){
    var at=(now-anim.t0)/anim.dur;
    if(at>1)at=1;
    var ae=1-Math.pow(1-at,3);
    var ax=X(anim.fx)+(X(anim.tx)-X(anim.fx))*ae;
    var ay=Y(anim.fy)+(Y(anim.ty)-Y(anim.fy))*ae;
    for(var gi=3;gi>=1;gi--){
      var ag=Math.max(0,at-gi*0.085);
      var age=1-Math.pow(1-ag,3);
      ctx.save();
      ctx.globalAlpha=0.10*(4-gi)/3;
      drawPiece(X(anim.fx)+(X(anim.tx)-X(anim.fx))*age,
                Y(anim.fy)+(Y(anim.ty)-Y(anim.fy))*age,
                anim.piece.s,anim.piece.t,1);
      ctx.restore();
    }
    if(anim.eat)drawPiece(X(anim.tx),Y(anim.ty),anim.eat.s,anim.eat.t,1);

    var lift=Math.sin(at*Math.PI);            // 0 → 1 → 0，中途最高
    var liftPx=lift*S*0.40;

    // 地面投影：抬得越高，影子越小越淡
    ctx.save();
    ctx.globalAlpha=0.34*(1-lift*0.55);
    ctx.fillStyle='#2a1d0c';
    ctx.beginPath();
    ctx.ellipse(ax,ay+S*0.30,S*0.38*(1-lift*0.28),S*0.15*(1-lift*0.28),0,0,6.2832);
    ctx.fill();
    ctx.restore();

    // 棋子本体：抬升 + 放大
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.38)';
    ctx.shadowBlur=S*0.45*lift;
    ctx.shadowOffsetY=S*0.16*lift;
    drawPiece(ax,ay-liftPx,anim.piece.s,anim.piece.t,1+0.13*lift);
    ctx.restore();
  }

  // 顶层描边光环
  for(i=0;i<G.green.length;i++)ringAt(G.green[i][0],G.green[i][1],'#2bd66a',phase,false);
  for(i=0;i<G.red.length;i++)ringAt(G.red[i][0],G.red[i][1],'#ff4d4d',phase,false);
  for(i=0;i<G.warn.length;i++)ringAt(G.warn[i][0],G.warn[i][1],'#ffc53d',phase,true);

  // 选中
  if(sel){
    ctx.strokeStyle='#2f7ad6';
    ctx.lineWidth=Math.max(2,S*0.07);
    ctx.beginPath();ctx.arc(X(sel.x),Y(sel.y),S*0.46,0,6.2832);ctx.stroke();
  }
  // 可走点
  for(var k=0;k<hints.length;k++){
    var m=hints[k];
    var canCap=G.board[m.ty][m.tx];
    ctx.beginPath();
    if(canCap){
      ctx.strokeStyle='#2f7ad6';ctx.lineWidth=Math.max(2,S*0.06);
      ctx.arc(X(m.tx),Y(m.ty),S*0.44,0,6.2832);ctx.stroke();
    }else{
      ctx.fillStyle='rgba(47,122,214,.55)';
      ctx.arc(X(m.tx),Y(m.ty),S*0.13,0,6.2832);ctx.fill();
    }
  }

  drawFx(now);

  ctx.restore();
}

var PIECE_VAL={K:1000,R:9,C:4.5,N:4,B:2,A:2,P:1};
function pieceVal(p,y){
  if(!p)return 0;
  if(p.t==='P')return (p.s===RED)?(y<=4?2:1):(y>=5?2:1);
  return PIECE_VAL[p.t];
}

// 每格价值最低的攻击者，用于判断交换是否吃亏
function atkMap(board,moves){
  var map={},i,m,p,k,v;
  for(i=0;i<moves.length;i++){
    m=moves[i];
    p=board[m.fy][m.fx];
    if(!p)continue;
    k=m.ty*9+m.tx;
    v=pieceVal(p,m.fy);
    if(map[k]===undefined||v<map[k])map[k]=v;
  }
  return map;
}

// 三色标记：
//   绿 = 无根，可白吃
//   黄 = 有根但是假根（吃回仍吃亏 / 保护不值钱）
//   红 = 我方无根被打击
function computeMarkers(){
  G.green=[];G.red=[];G.warn=[];
  if(!G.board||G.over){G.inCheck=false;requestDraw();return;}
  var me=(mode!=='local'&&mySide)?mySide:G.turn;
  var opp=(me===RED?BLK:RED);
  var myL=legalMoves(G.board,me), opL=legalMoves(G.board,opp);
  var myG=guardTargets(G.board,me), opG=guardTargets(G.board,opp);
  var myAtk=atkMap(G.board,myL), opAtk=atkMap(G.board,opL);
  for(var y=0;y<10;y++)for(var x=0;x<9;x++){
    var p=G.board[y][x];
    if(!p)continue;
    var key=y*9+x;
    var v=pieceVal(p,y);
    if(p.s===opp){
      if(myAtk[key]===undefined)continue;
      if(!opG[key])G.green.push([x,y]);
      else if(myAtk[key]<v)G.warn.push([x,y]);
    }else{
      if(opAtk[key]===undefined)continue;
      if(!myG[key])G.red.push([x,y]);
      else if(opAtk[key]<v)G.warn.push([x,y]);
    }
  }
  G.inCheck=isChecked(G.board,G.turn);
  requestDraw();
}

/* ---------- 交互 ---------- */
function onPoint(x,y){
  if(G.over)return;
  if(mode==='mqtt'&&G.turn!==mySide)return;

  var p=G.board[y][x];
  if(sel){
    if(sel.x===x&&sel.y===y){sel=null;hints=[];draw();return;}
    for(var i=0;i<hints.length;i++){
      var m=hints[i];
      if(m.tx===x&&m.ty===y){sel=null;hints=[];commitMove(m);return;}
    }
  }
  if(p&&p.s===G.turn){
    sel={x:x,y:y};
    hints=legalMoves(G.board,G.turn).filter(function(m){return m.fx===x&&m.fy===y;});
    draw();
  }else{
    sel=null;hints=[];draw();
  }
}

canvas.addEventListener('pointerdown',function(e){
  e.preventDefault();
  ensureAudio();
  var r=canvas.getBoundingClientRect();
  var px=e.clientX-r.left, py=e.clientY-r.top;
  var gx=Math.round((px-PAD)/S), gy=Math.round((py-PAD)/S);
  if(gx<0||gx>8||gy<0||gy>9)return;
  if(flip){gx=8-gx;gy=9-gy;}
  onPoint(gx,gy);
});

/* ---------- 落子 ---------- */
function commitMove(m,opts){
  opts=opts||{};
  var side=G.turn;
  var p=G.board[m.fy][m.fx];
  if(!p||p.s!==side)return false;
  var lm=legalMoves(G.board,side), ok=false;
  for(var i=0;i<lm.length;i++){
    if(lm[i].fx===m.fx&&lm[i].fy===m.fy&&lm[i].tx===m.tx&&lm[i].ty===m.ty){ok=true;break;}
  }
  if(!ok)return false;

  var cap=applyMove(G.board,m);
  G.moves.push(moveToCode(m));
  G.last=m;
  G.turn=(side===RED?BLK:RED);

  log((side===RED?'红':'黑')+' '+NAME[side][p.t]+' '+moveToCode(m)+(cap?(' 吃'+NAME[cap.s][cap.t]):''));

  var opp=G.turn;
  var chk=isChecked(G.board,opp);
  G.hist.push({key:posKey(G.board,G.turn),by:side,check:chk,chase:detectChase(G.board,side)});

  var kp=null, cls=null;
  if(legalMoves(G.board,opp).length===0){
    G.over=true;
    G.result=(side===RED?'红方胜':'黑方胜')+(chk?'（将死）':'（困毙）');
    kp=findKing(G.board,opp);
    cls=chk?classifyMate(G.board,opp,m,cap):{name:'困毙',color:'#9aa0a6'};
  }

  if(!G.over){
    var rv=repetitionVerdict(G.hist);
    if(rv){
      G.over=true;G.result=rv.result;
      log(rv.result);
      setTimeout(function(){showBanner(rv.name,'#ffb020');},260);
    }
  }

  playMoveAnim(m,cap,function(){
    sfx(cap?'capture':'move');
    if(G.inCheck&&!G.over){
      sfx('check');
      var kk=findKing(G.board,G.turn);
      if(kk)triggerRadial(kk.x,kk.y);
    }
    if(cap){
      addBurst(X(m.tx),Y(m.ty),cap.s===RED?'#c23b32':'#6a6a6a');
      var bp=boardPos(m.tx,m.ty);
      bigText('吃',{color:(cap.s===RED?'#ff5a4d':'#ffd166'),size:S*1.0,
                    x:bp.x,y:bp.y-S*0.5,cls:'eat',dur:880});
    }
    if(G.over&&kp){
      setTimeout(function(){
        addMate(X(kp.x),Y(kp.y),cls.color);
        showBanner(cls.name,cls.color);
        doShake(560,S*0.38);
        log('★ '+G.result+' · '+cls.name);
      },cap?110:60);
    }else if(G.inCheck){
      setTimeout(function(){
        bigText('将军',{color:'#ff3b30',size:S*1.32,dur:1150});
        doShake(280,S*0.14);
      },cap?260:0);
    }
  });

  sel=null;hints=[];
  computeMarkers();updateStatus();
  if(opts.broadcast!==false)sendState();
  return true;
}

/* ---------- 网络 ---------- */
function send(obj){
  if(!link)return;
  if(mode!=='mqtt')return;
  obj.sid=mySid;
  try{link.publish('cchess/'+room,JSON.stringify(obj));}catch(e){}
}
function sendState(){
  send({v:1,type:'state',room:room,from:mySide,ver:G.moves.length,moves:G.moves,ts:Date.now()});
  if(G.moves.length===1)setTimeout(function(){
    send({v:1,type:'state',room:room,from:mySide,ver:G.moves.length,moves:G.moves,ts:Date.now()});
  },600);
}
function sendCritical(obj){
  send(obj);
  setTimeout(function(){send(obj);},400);
}
function sendHello(){
  send({v:1,type:'hello',room:room,from:mySide,ts:Date.now()});
}

function onWire(msg){
  if(!msg||typeof msg!=='object')return;
  if(msg.sid&&msg.sid===mySid)return;
  if(msg.room&&room&&msg.room!==room)return;

  if(msg.type==='hello'){
    if(msg.from===mySide){peerConflict=true;updateStatus();return;}
    var was=peerOnline;
    peerOnline=true;peerConflict=false;
    stopHelloLoop();
    if(!helloAcked){helloAcked=true;sendHello();}
    if(G.moves.length>0)sendState();
    if(!was)log('✓ 对方已上线');
    updateStatus();
    return;
  }
  if(msg.from===mySide)return;

  if(msg.type==='state'){
    var raw=msg.moves||[];
    if(raw.length<G.moves.length)return;   // 只准前进，不准倒退清盘
    if(raw.length>420)return;              // 异常长度直接丢弃
    var pi,cnt=G.moves.length;
    for(pi=0;pi<cnt;pi++){                 // 只准往后接，不准改写已有棋谱
      if(raw[pi]!==G.moves[pi])return;
    }
    if(msg.ver<=G.moves.length)return;
    var prevLen=G.moves.length;
    var nc=raw.length;
    var lm=null, eat=null;
    if(nc===prevLen+1){
      lm=codeToMove(raw[nc-1]);
      if(lm)eat=G.board[lm.ty][lm.tx]||null;
    }
    var r=replay(raw);
    if(r.ok){
      G.board=r.board;G.turn=r.turn;G.moves=raw.slice();
      G.last=G.moves.length?codeToMove(G.moves[G.moves.length-1]):null;
      G.over=false;G.result='';
      var opp=G.turn, kp2=null, cls2=null;
      if(legalMoves(G.board,opp).length===0){
        G.over=true;
        kp2=findKing(G.board,opp);
        var chk2=isChecked(G.board,opp);
        G.result=((opp===RED?'黑方胜':'红方胜'))+(chk2?'（将死）':'（困毙）');
        cls2=chk2?classifyMate(G.board,opp,G.last,eat):{name:'困毙',color:'#9aa0a6'};
      }
      sel=null;hints=[];
      var after=function(){
        sfx(eat?'capture':'move');
        if(G.inCheck&&!G.over){
          sfx('check');
          var kk2=findKing(G.board,G.turn);
          if(kk2)triggerRadial(kk2.x,kk2.y);
        }
        if(eat){
          addBurst(X(lm.tx),Y(lm.ty),eat.s===RED?'#c23b32':'#6a6a6a');
          var bp2=boardPos(lm.tx,lm.ty);
          bigText('吃',{color:(eat.s===RED?'#ff5a4d':'#ffd166'),size:S*1.0,
                        x:bp2.x,y:bp2.y-S*0.5,cls:'eat',dur:880});
        }
        if(G.over&&kp2){
          setTimeout(function(){
            addMate(X(kp2.x),Y(kp2.y),cls2.color);
            showBanner(cls2.name,cls2.color);
            doShake(560,S*0.38);
          },eat?110:60);
        }else if(G.inCheck){
          setTimeout(function(){
            bigText('将军',{color:'#ff3b30',size:S*1.32,dur:1150});
            doShake(280,S*0.14);
          },eat?260:0);
        }
      };
      if(lm)playMoveAnim(lm,eat,after); else after();
      computeMarkers();updateStatus();
      log('⇄ 同步到第 '+G.moves.length+' 手');
    }else{
      log('✗ 同步失败：'+r.err+'，请求重发');
      send({v:1,type:'sync',room:room,from:mySide,ts:Date.now()});
    }
    return;
  }
  if(msg.type==='sync'){sendState();return;}
  if(msg.type==='reset'){
    if(G.over||G.moves.length===0){resetGame();log('↺ 对方开新局');}
    else showAsk('对方请求重新开始',function(){resetGame();log('↺ 对方开新局');},function(){log('已拒绝重新开始');});
    return;
  }
  if(msg.type==='chat'){
    var txt=typeof msg.text==='string'?msg.text.slice(0,80):'';
    if(!txt)return;
    chatShow(msg.from===RED?'红':'黑',txt,'op');
    if(mode==='mqtt'&&!el('chat').classList.contains('on')){chatUnread++;updateStatus();}
    return;
  }
  if(msg.type==='resign'){
    G.over=true;
    G.result=(msg.from===RED?'红方认输':'黑方认输')+'，'+((msg.from===RED?'黑方':'红方'))+'胜';
    log(G.result);computeMarkers();updateStatus();return;
  }
  if(msg.type==='draw-req'){
    showAsk('对方求和',function(){
      sendCritical({v:1,type:'draw-ok',room:room,from:mySide,ts:Date.now()});
      finishDraw();
    },function(){
      send({v:1,type:'draw-no',room:room,from:mySide,ts:Date.now()});
      log('已拒绝求和');
    });
    return;
  }
  if(msg.type==='draw-ok'){
    if(pendingReq!=='draw-req'){log('忽略未请求的和棋');return;}
    pendingReq=null;finishDraw();log('对方同意求和');return;
  }
  if(msg.type==='draw-no'){pendingReq=null;log('对方拒绝求和');return;}
  if(msg.type==='undo-req'){
    if(!G.moves.length)return;
    showAsk('对方请求悔棋',function(){
      applyUndo(G.moves.length-1);
      sendCritical({v:1,type:'undo-ok',room:room,from:mySide,moves:G.moves,ts:Date.now()});
      log('已同意悔棋');
    },function(){
      send({v:1,type:'undo-no',room:room,from:mySide,ts:Date.now()});
      log('已拒绝悔棋');
    });
    return;
  }
  if(msg.type==='undo-ok'){
    if(pendingReq!=='undo-req'){log('忽略未请求的悔棋');return;}
    pendingReq=null;applyUndoList(msg.moves||[]);log('对方同意悔棋');return;
  }
  if(msg.type==='undo-no'){pendingReq=null;log('对方拒绝悔棋');return;}
}

var reconnectTimer=null, backoff=1000, helloTimer=null, helloAcked=false;

function scheduleReconnect(){
  if(mode!=='mqtt'||!mySide)return;
  if(reconnectTimer)clearTimeout(reconnectTimer);
  reconnectTimer=setTimeout(function(){
    if(mode!=='mqtt'||!mySide)return;
    log('重连中…');
    connectMqtt();
  },backoff);
  backoff=Math.min(backoff*2,30000);
}

function stopHelloLoop(){
  if(helloTimer){clearInterval(helloTimer);helloTimer=null;}
}

function startHelloLoop(){
  helloAcked=false;
  stopHelloLoop();
  var n=0;
  sendHello();
  helloTimer=setInterval(function(){
    if(peerOnline||n++>=10){stopHelloLoop();return;}
    sendHello();
  },2500);
}

function connectMqtt(){
  if(!room){log('先填房间号');return;}
  if(!mySide){log('先选执红或执黑');return;}
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
  if(link){try{link.close();}catch(e){}link=null;}
  stopHelloLoop();
  linkState='connecting';updateStatus();
  log('连接 broker…');
  var c=new MqttWS(BROKER);
  link=c;
  c.onMessage=function(topic,payload){
    if(topic!=='cchess/'+room)return;
    var msg=null;
    try{msg=JSON.parse(payload);}catch(e){return;}
    onWire(msg);
  };
  c.onState=function(st){
    if(st==='online'){
      linkState='online';backoff=1000;
      c.subscribe('cchess/'+room);
      startHelloLoop();
      log('已连接 · 房间 '+room);
      updateStatus();
    }else{
      linkState='offline';updateStatus();
      scheduleReconnect();
    }
  };
  c.open().catch(function(err){
    if(linkState==='connecting'){linkState='offline';updateStatus();}
    log('连接失败：'+(err&&err.message||err));
    scheduleReconnect();
  });
}

function disconnect(){
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
  stopHelloLoop();
  if(link){try{link.close();}catch(e){}link=null;}
  linkState='';peerOnline=false;peerConflict=false;
}

/* ---------- 聊天 ---------- */
var chatUnread=0;

function chatShow(who,text,cls){
  var box=el('chatLog');
  var row=document.createElement('div');
  row.className='m '+(cls||'');
  if(who){
    var w=document.createElement('span');
    w.className='who'; w.textContent=who;
    row.appendChild(w);
  }
  row.appendChild(document.createTextNode(text));
  box.appendChild(row);
  box.scrollTop=box.scrollHeight;
  while(box.children.length>100)box.removeChild(box.firstChild);
}

function chatSend(){
  var inp=el('chatIn');
  var txt=(inp.value||'').trim().slice(0,80);
  if(!txt)return;
  if(mode!=='mqtt'){ chatShow('','联机模式才能聊天','sys'); return; }
  if(!peerOnline){ chatShow('','对方不在线','sys'); return; }
  send({v:1,type:'chat',room:room,from:mySide,text:txt,ts:Date.now()});
  chatShow('我',txt,'me');
  inp.value='';
}

function chatToggle(){
  var box=el('chat');
  var on=!box.classList.contains('on');
  box.classList.toggle('on',on);
  if(on){ chatUnread=0; updateStatus(); el('chatIn').focus(); }
}

/* ---------- 界面 ---------- */
var pendingReq=null, askYes=null, askNo=null;

function log(s){
  var box=el('log');
  box.textContent+=(box.textContent?'\n':'')+s;
  box.scrollTop=box.scrollHeight;
}

function updateStatus(){
  var t;
  if(G.over) t=G.result;
  else if(mode==='local') t=(G.turn===RED?'红方':'黑方')+'走棋';
  else if(peerConflict) t='双方选了同一边';
  else if(linkState==='connecting') t='连接中';
  else if(linkState!=='online') t='未连接';
  else if(!mySide) t='选择执红或执黑';
  else if(!peerOnline) t='等待对手';
  else t=(G.turn===RED?'红方':'黑方')+'走棋';

  if(!G.over&&G.inCheck) t+='，将军';

  el('statText').textContent=t;
  el('dot').className='dot'+(((mode==='local')||linkState==='online')?' ok':'');

  var cb=el('btnChat');
  if(cb)cb.textContent=chatUnread>0?('💬'+chatUnread):'💬';
  el('btnResign').textContent=G.over?'新对局':'认输';
  el('btnDraw').disabled=G.over;
  el('btnUndoReq').disabled=G.over;
}

function setMode(m){
  mode=m;
  disconnect();
  mySide=null;peerConflict=false;flip=false;
  document.querySelectorAll('.sideBtn').forEach(function(b){b.classList.remove('on');});
  el('netRow').style.display=(m==='mqtt')?'flex':'none';
  el('chat').classList.toggle('off',m!=='mqtt');
  if(m!=='mqtt')el('chat').classList.remove('on');
  chatUnread=0;
  el('actLocal').style.display=(m==='mqtt')?'none':'flex';
  el('actOnline').style.display=(m==='mqtt')?'flex':'none';
  hideAsk();
  layout();
  resetGame();
  updateStatus();
}

function randRoom(){
  var a='abcdefghjkmnpqrstuvwxyz23456789', s='';
  for(var i=0;i<8;i++)s+=a[Math.floor(Math.random()*a.length)];
  return s;
}

function resetGame(){
  G.board=parseFen(START_FEN).board;
  G.turn=RED;G.moves=[];G.last=null;G.over=false;G.result='';
  G.green=[];G.red=[];G.warn=[];G.inCheck=false;
  sel=null;hints=[];anim=null;fx=[];shakeUntil=0;G.hist=[];
  el('log').textContent='';
  hideAsk();
  computeMarkers();updateStatus();
}

function pickSide(side){
  mySide=side;
  flip=(side===BLK);
  document.querySelectorAll('.sideBtn').forEach(function(b){b.classList.remove('on');});
  el(side===RED?'btnRed':'btnBlack').classList.add('on');
  disconnect();
  peerOnline=false;peerConflict=false;
  if(mode==='mqtt')connectMqtt();
  layout();updateStatus();
}

/* 从棋谱重建每步性质（悔棋、追平后用） */
function rebuildHist(){
  G.hist=[];
  var b=parseFen(START_FEN).board, turn=RED, i, m, side;
  for(i=0;i<G.moves.length;i++){
    m=codeToMove(G.moves[i]);
    if(!m)break;
    side=turn;
    applyMove(b,m);
    turn=(turn===RED?BLK:RED);
    G.hist.push({key:toFen(b,turn),by:side,
                 check:isChecked(b,turn),chase:detectChase(b,side)});
  }
}

/* 把棋谱截断到指定长度并重放 */
function applyUndoList(list){
  var r=replay(list);
  if(!r.ok)return;
  G.board=r.board;G.turn=r.turn;G.moves=list.slice();
  rebuildHist();
  G.last=list.length?codeToMove(list[list.length-1]):null;
  G.over=false;G.result='';
  sel=null;hints=[];anim=null;
  computeMarkers();updateStatus();
}
function applyUndo(n){
  applyUndoList(G.moves.slice(0,Math.max(0,n)));
}

function finishDraw(){
  G.over=true;G.result='和棋';
  hideAsk();computeMarkers();updateStatus();
}

function showAsk(text,onYes,onNo){
  el('askText').textContent=text;
  askYes=onYes;askNo=onNo;
  el('ask').classList.add('show');
}
function hideAsk(){
  el('ask').classList.remove('show');
  askYes=null;askNo=null;
}

/* 同一时间只允许挂一个待答复的请求 */
function sendReq(type,label){
  if(pendingReq){log('上一个请求还在等待答复');return;}
  if(!peerOnline){log('对方不在线');return;}
  pendingReq=type;
  send({v:1,type:type,room:room,from:mySide,ts:Date.now()});
  log('已发出'+label);
  setTimeout(function(){pendingReq=null;},20000);
}

/* ---------- 绑定 ---------- */
el('mode').addEventListener('change',function(){setMode(this.value);});
el('btnChat').addEventListener('click',chatToggle);
el('chatSend').addEventListener('click',chatSend);
el('chatIn').addEventListener('keydown',function(e){
  if(e.key==='Enter'){ e.preventDefault(); chatSend(); }
});

el('btnRand').addEventListener('click',function(){
  el('room').value=randRoom();
  room=el('room').value;
  if(mySide&&mode==='mqtt')connectMqtt();
});
el('room').addEventListener('input',function(){
  room=this.value.trim().toLowerCase();
});

el('btnRed').addEventListener('click',function(){pickSide(RED);});
el('btnBlack').addEventListener('click',function(){pickSide(BLK);});

el('askYes').addEventListener('click',function(){var f=askYes;hideAsk();if(f)f();});
el('askNo').addEventListener('click',function(){var f=askNo;hideAsk();if(f)f();});

/* 本地双人 */
el('btnNew').addEventListener('click',function(){resetGame();});
el('btnUndo').addEventListener('click',function(){
  if(!G.moves.length)return;
  var n=1;
  if(G.over)n=Math.min(n,G.moves.length)||1;
  applyUndo(G.moves.length-n);
});
function copyMoves(){
  var t=G.moves.join(' ');
  if(!t){log('还没有棋步');return;}
  var done=function(){log('棋谱已复制');};
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(done,function(){
      // 无剪贴板权限时退化为可选中文本
      window.prompt('棋谱（Ctrl+C 复制）',t);
    });
  }else{
    window.prompt('棋谱（Ctrl+C 复制）',t);
  }
}
el('btnCopy').addEventListener('click',copyMoves);
el('btnCopy2').addEventListener('click',copyMoves);

/* 联机 */
el('btnResign').addEventListener('click',function(){
  if(G.over){
    resetGame();
    send({v:1,type:'reset',room:room,from:mySide,ts:Date.now()});
    log('新对局');
    return;
  }
  showAsk('确定认输？',function(){
    G.over=true;
    G.result=(mySide===RED?'红方认输':'黑方认输')+'，'+((mySide===RED?'黑方':'红方'))+'胜';
    sendCritical({v:1,type:'resign',room:room,from:mySide,ts:Date.now()});
    log(G.result);updateStatus();
  });
});
el('btnDraw').addEventListener('click',function(){
  if(G.over)return;
  sendReq('draw-req','求和请求');
});
el('btnUndoReq').addEventListener('click',function(){
  if(G.over||!G.moves.length)return;
  sendReq('undo-req','悔棋请求');
});

window.addEventListener('resize',function(){layout();});
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='visible'&&mode==='mqtt'&&mySide){
    if(linkState!=='online')connectMqtt();
    else{sendHello();if(G.moves.length)sendState();}
  }
});

/* ---------- 启动 ---------- */
room=randRoom();
el('room').value=room;
setMode('mqtt');
