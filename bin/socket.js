/**
 * feature：
 * 1. socket推送消息
 * 2. redis订阅消息
 * 3.添加组
 * 4.删除组
 *
 *  ps: 组的创建者退出房间时.由客户端删除组.服务端不管
 */
"use strict";
const net       = require('net');
const crypto    = require('crypto');
const md5       = crypto.createHash('md5');
var   redis     = require("redis");


//内置系统级事件类型
var systemEvent = {
    'addGroup' : 'addgroup',
    'rmGroup'  : 'rmgroup',
    'outGroup' : 'outgroup',
    'joinGroup': 'joingroup',
    'alive'    :  'live'
}


/**
 * web socket类
 */
class WS {
    constructor(cfg) {
        this.cfg = cfg || {},
        
        this.sockets = {},
        //redis 连接配置
        this.redisConfig = this.cfg.redis,
        //socket 服务监听的端口
        this.port = this.cfg.port,
        //每个 ws 进程都有有一个唯一 id
        this.id = guid(),
        
        this.subscriber = getRedis(this.redisConfig),
        this.redisClient = getRedis(this.redisConfig);
        
        var me = this;
        this.server = net.createServer(me.eventHandle.bind(this));
        this.sub();
    }
    /**
     * 协议提升
     * @param  {[type]} httpHeader 协议头
     * @param  {[type]} socket     插座
     */
    upgrade(httpHeader, socket,domain) {
        var result = parseHeader(httpHeader);
        var socketId = result.socketId;
    
        socket.__id = socketId;
        //把连接的socket 保存在内存中
        this.sockets[socketId] = socket;

        //socketid: serverid 存储进redis
        this.redisClient.set(socketId, this.id);
        

        //根据 client cookie .判断是否是是房主.更新 redis 房间主人
        this.updateManager(result.cookie,socketId);
        
        var shasum = crypto.createHash('sha1');
        shasum.update(result.key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
        
        var key = shasum.digest('base64');
        var headers = [
            'HTTP/1.1 101 Switching Protocols', 
            'Upgrade: WebSocket', 
            'Connection: Upgrade', 
            'Sec-WebSocket-Accept:' + key, 
            'Set-Cookie:sid=' + socketId + ';Expires='+new Date(new Date().getTime()+1000*60*60*12).toUTCString() + ';',
            ];

        var s = headers.concat('', '').join('\r\n');
        //提升协议
        socket.write(s);
    }
    sub() {
        //文本类型消息
        this.subscriber.subscribe(`${this.id}#text/plain`);
        //广播消息
        this.subscriber.subscribe(`all#broadcast`);
        //系统级消息
        this.subscriber.subscribe(`${this.id}#system`);

        //处理 redis 事件
        this.handlerRedisPub();
    }
    /**
     * 更新房间主人.用于房主突发掉线,重连接时候的操作. ps: 避免房主掉线,房间内用户要换房间.
     * @param  {object} cookie  用户 cookie 信息
     */
    updateManager(cookie,newID){
        var roomId = cookie.ws_manager;
        this.redisClient.hset(roomId,'owner',newID);
    }
    /**
     * 处理redis publish message
     * @return {[type]} [description]
     */
    handlerRedisPub() {
        var me = this;

        this.subscriber.on("message", (channel, message) =>{
            
            if (message == 'null' || message == '' || !message) {
                return;
            }
            
            /*
                {
                    to     : '' //socketid
                    group  : [socketid,socketid,socketid] // socket array
                    msg    : '' || binary  // 消息
                    mtype  : ''  user custom event type
                }

             */
            var tem     = channel.split('#'),
                channel = tem[1],
                server   = tem[0];
            
            switch(channel){
                case 'broadcast' :
                    me.send(me.sockets, message,true);
                    break;
                case 'system':
                    me.handleSystem(JSON.parse(message));
                    break;
                default:
                    message = JSON.parse(message);
                    switch (channel) {
                        case 'text/plain':
                            me.send(message.to, message);
                            break;
                        default:
                            return;
                    }
            }
        });
    }
    /**
     * 处理系统级消息
     * @param  { Object} params  消息
     */     
    handleSystem(params){
        var from      = params.from,
            mtype     = params.mtype,
            msg       = params.msg,
            group     = params.group,
            serverid  = params.serverId,
            returnMsg = '';
        var me = this;
        switch(mtype){
            //添加组
            case systemEvent.addGroup: 
                //判断当前 room 是否存在.
                this.redisClient.EXISTS(group,(err,data)=>{
                    if(!data){
                        var obj = {
                            "owner" : from
                        }
                        obj[from] = serverid;

                        me.redisClient.HMSET(group,obj)
                        returnMsg = '创建房间成功!';
                    }else{
                        returnMsg = '房间已经存在了,不能再创建了!请换个名字~~';
                    }
                    me.send(from,{
                        from : from,
                        msg  : returnMsg,
                        mtype: mtype,
                        group:group
                    })
                })
                break;
            //删除组
             case systemEvent.rmGroup:
                 //msg is group name
                 //判断发起删除房间的 人员 id 是否是该房间的管理员
                this.redisClient.hget(group,'owner',(err,owner)=>{
                    if(!owner){
                        returnMsg = `当前房间不存在,无法删除~~`;
                    }else if(owner == from){
                        me.redisClient.del(group);
                        returnMsg = `删除房间 ${group} 成功!`;
                    }else{
                        returnMsg = '你不是该房间管理员,无法删除';
                    }
                    
                    me.send(from,{
                        from  : from,
                        msg   : returnMsg,
                        mtype : mtype,
                        group:group
                    })

                })
                break;
            //加入组
            case systemEvent.joinGroup:

                //首先判断 申请加入组的人员,是否在组内
                this.redisClient.HEXISTS(group,from,(err,exist) => {
                    if(exist){
                        returnMsg =`您已经在这个房间 ${group} 内了~~`;
                    }else{
                        me.redisClient.hset(group,from,serverid);
                        returnMsg = `加入房间 ${group} 成功.`;
                    }
                    me.send(from,{
                        from : from,
                        msg  : returnMsg,
                        mtype: mtype,
                        group:group
                    })
                })
                break;
            //退出组
            case systemEvent.outGroup:
                this.redisClient.hdel(group,from);
                this.send(from,{
                        from : from,
                        msg  : `退出房间 ${group} 成功~`,
                        mtype: mtype,
                        group:group
                    })
                break;

            default:
                return;
        }
       
    }
    /**
     * 根据socketid  获取socket实例
     * @param  {[type]} groupOrSingle  socketid数组或者字符串
     */
    getSockets(groupOrSingle) {
        var result = {};
        var allSockets = this.sockets;

        Object.prototype.toString.call(groupOrSingle) != '[object Array]' && (groupOrSingle = [groupOrSingle])

        groupOrSingle.forEach(socketId => {
            result[socketId] = allSockets[socketId];
        })
        //删除值为undefined 的socket
        return result;
    }
    /**
     * 事件处理
     */
    eventHandle(socket) {
        var me = this;
        socket.on('end', (so)=> {
            var sid  = arguments[0].__id;
            me.redisClient.del(sid);
            delete me.sockets[sid];
        });
        
        socket.on('data', (data) => {
            var dataString = data.toString();
            var httpHeader = dataString.split('\r\n'),
                isUpgrade = httpHeader.length > 1 ? true : false;
            isUpgrade && me.upgrade(httpHeader, socket,me.domain)
        });
        socket.on('error', (error) => {
            console.log(`******* ERROR ${error} *******\r\n`);
            console.log(`socket ${socket.id} end`);
            socket.end();

        });
    }
    /**
     * 生成socket协议帧
     * @param  {[string]} str_msg 需要发送的字符串    
     */
    buildSendMsg(str_msg, mask) {
        str_msg = typeof str_msg == 'object' ? JSON.stringify(str_msg) : (str_msg || "");
        mask = mask || false;
        var msg_len = Buffer.byteLength(str_msg, "utf-8"),
            packed_data;
        if (msg_len <= 0) {
            return null;
        }
        if (msg_len < 126) { //默认全是数据
            packed_data = new Buffer(2 + msg_len);
            packed_data[0] = 0x81; // 1000(fin RSV1 RSV2 RSV3)   0001(opcode 1 text)
            packed_data[1] = msg_len;
            packed_data.write(str_msg, 2);
        } else if (msg_len <= 0xFFFF) { //用16位表示数据长度
            packed_data = new Buffer(4 + msg_len);
            packed_data[0] = 0x81;
            packed_data[1] = 126;
            packed_data.writeUInt16BE(msg_len, 2); //从第二位开始写
            packed_data.write(str_msg, 4);
        }
        return packed_data;
    }
    /**
     * 监听端口
     * @param  {[type]} port [description]
     * @return {[type]}      [description]
     */
    listen(port) {
        this.server.listen(port || this.port || 8888,(a, b) =>{ //'listening' listener
            console.log('server bound');
        });
    }
    /**
     * 发送消息
     * @param  {[type]} sockets [description]
     * @param  {[type]} msg     [description]
     * @param  {bool} noNeed    是否不需要获取sockets
     * @return {[type]}         [description]
     */
    send(to, msg,noNeed) {
        var me = this;
        var sockets = noNeed ? to : this.getSockets(to);
        
        if(sockets.length == 0)return;

        for (var socket in sockets) {
            try {
                var so = sockets[socket];
                if(!so){ //如果 socket 断开,直接删除 redis 组内数据,并且丢弃消息
                    console.log(msg);
                    console.log(`删除组 ${msg.group}, 成员: ${socket}`);
                    this.redisClient.hdel(msg.group,socket);
                    delete this.sockets[socket];
                }else{
                    so.writable && so.write(this.buildSendMsg(msg));    
                }
            }catch (e) {
                console.error(e)
            }
        }
    }
}

function guid(isLong) {
    return (isLong ? 'Rxx-xxxxxx-xxxxx' : 'Rx-xxxx-xxxx').replace(/[xy]/g, (c) => {
        var r = Math.random() * 16 | 0,
            v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 解析 cookie 返回对象
 * @param  {[type]} httphead [description]
 * @return {[type]}          [description]
 */
function parseHeader(httpHeader){
    var key,socketId,cookie = {};

    httpHeader.forEach((item,index)=> {
        if (item.indexOf('Sec-WebSocket-Key') != -1) {
            socketId  = item.split(':')[1].replace(/(^\s+)|(\s+$)/g,"").replace(/\+/ig,'');
            key = item.split(':')[1].replace(/(^\s+)|(\s+$)/g, '');
        }
        if(item.indexOf('Cookie') != -1){
            item.replace(/\s+/g,"").split(':')[1].split(';').forEach( coo => {
                var tem = coo.split('=');
                cookie[tem[0]] = tem[1];
            })
        }
    })


    return {
        key,
        socketId,
        cookie
    }
}

function getRedis(redisCfg) {
    var client = redis.createClient(redisCfg || {
        host: '127.0.0.1',
        port: 6379
    });
    client.on('connect', ()=> {})
    client.on('end', () => {})
    client.on('error', () => {
        console.error(arguments);
    })
    return client;
}
module.exports = WS;