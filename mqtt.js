/* MQTT 3.1.1 over WebSocket 最小实现：只用 QoS0 收发与订阅 */
// MQTT 3.1.1 over WebSocket 的最小实现：只支持 QoS0 的收发与订阅
function utf8(s){return new TextEncoder().encode(s);}
function encStr(s){var b=utf8(s);return [(b.length>>8)&255,b.length&255].concat(Array.from(b));}
function encRemain(n){var o=[];do{var d=n%128;n=Math.floor(n/128);if(n>0)d|=0x80;o.push(d);}while(n>0);return o;}
function cat(parts){
  var len=0,i,j;
  for(i=0;i<parts.length;i++)len+=parts[i].length;
  var out=new Uint8Array(len),p=0;
  for(i=0;i<parts.length;i++){for(j=0;j<parts[i].length;j++)out[p++]=parts[i][j];}
  return out;
}
function mqttConnectPacket(cid){
  var body=[0x00,0x04,0x4d,0x51,0x54,0x54,0x04,0x02,0x00,0x3c].concat(encStr(cid));
  return cat([new Uint8Array([0x10]),new Uint8Array(encRemain(body.length)),new Uint8Array(body)]);
}
function mqttSubscribePacket(topic,pid){
  var body=[(pid>>8)&255,pid&255].concat(encStr(topic)).concat([0x00]);
  return cat([new Uint8Array([0x82]),new Uint8Array(encRemain(body.length)),new Uint8Array(body)]);
}
function mqttPublishPacket(topic,payload){
  var body=encStr(topic).concat(Array.from(utf8(payload)));
  return cat([new Uint8Array([0x30]),new Uint8Array(encRemain(body.length)),new Uint8Array(body)]);
}

function MqttWS(url,opts){
  opts=opts||{};
  this.url=url;
  this.clientId=opts.clientId||('cc_'+Math.random().toString(36).slice(2,10));
  this.ws=null; this.buf=new Uint8Array(0); this.pid=1;
  this.onMessage=null; this.onState=null;
  this._resolveOpen=null; this._ping=null;
}
MqttWS.prototype.open=function(){
  var self=this;
  return new Promise(function(resolve,reject){
    var ws;
    try{ws=new WebSocket(self.url,'mqtt');}
    catch(e){reject(e);return;}
    ws.binaryType='arraybuffer';
    self.ws=ws;
    var done=false, timer=null;
    function fail(err){
      if(done)return; done=true;
      if(timer)clearTimeout(timer);
      try{ws.close();}catch(e){}
      reject(err);
    }
    timer=setTimeout(function(){ fail(new Error('connect timeout')); },9000);
    ws.onopen=function(){ self.send(mqttConnectPacket(self.clientId)); };
    ws.onmessage=function(ev){ self.feed(ev.data); };
    ws.onerror=function(){ fail(new Error('socket error')); };
    ws.onclose=function(){
      self.alive=false;
      if(self._ping){clearInterval(self._ping);self._ping=null;}
      if(!self._closedByUser&&self.onState)self.onState('offline');
      if(!done){done=true;if(timer)clearTimeout(timer);reject(new Error('socket closed'));}
    };
    self._resolveOpen=function(){
      if(done)return; done=true;
      if(timer)clearTimeout(timer);
      resolve();
      self._ping=setInterval(function(){self.send(new Uint8Array([0xc0,0x00]));},30000);
    };
  });
};
MqttWS.prototype.send=function(u8){
  if(this.ws&&this.ws.readyState===1){this.ws.send(u8);return true;}
  return false;
};
MqttWS.prototype.feed=function(data){
  var chunk = (data instanceof ArrayBuffer) ? new Uint8Array(data) : new Uint8Array(data);
  var merged=new Uint8Array(this.buf.length+chunk.length);
  merged.set(this.buf,0); merged.set(chunk,this.buf.length);
  this.buf=merged;
  for(;;){
    if(this.buf.length<2)break;
    var mult=1,val=0,i=1,ok=false;
    for(;i<this.buf.length;i++){
      var b=this.buf[i];
      val+=(b&127)*mult; mult*=128;
      if((b&128)===0){ok=true;i++;break;}
    }
    if(!ok)break;
    var total=i+val;
    if(this.buf.length<total)break;
    var pkt=this.buf.slice(0,total);
    this.buf=this.buf.slice(total);
    this.handle(pkt);
  }
};
MqttWS.prototype.handle=function(pkt){
  var type=pkt[0]>>4;
  var i=1; while(pkt[i]&0x80)i++; i++;
  var p=pkt.subarray(i);
  if(type===2){
    this.alive=true;
    if(this.onState)this.onState('online');
    if(this._resolveOpen)this._resolveOpen();
  }else if(type===3){
    var tl=(p[0]<<8)|p[1];
    var topic=new TextDecoder().decode(p.subarray(2,2+tl));
    var off=2+tl;
    var qos=(pkt[0]>>1)&3;
    if(qos>0)off+=2;
    var payload=new TextDecoder().decode(p.subarray(off));
    if(this.onMessage)this.onMessage(topic,payload);
  }
};
MqttWS.prototype.subscribe=function(topic){
  var pid=this.pid++;
  this.send(mqttSubscribePacket(topic,pid));
  return pid;
};
MqttWS.prototype.publish=function(topic,payload){
  return this.send(mqttPublishPacket(topic,payload));
};
MqttWS.prototype.close=function(){
  this._closedByUser=true;
  try{if(this._ping)clearInterval(this._ping);}catch(e){}
  try{this.ws&&this.ws.close();}catch(e){}
};
