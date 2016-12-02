"use strict";

/*

 redis publisher
 消息方式：
 1.点对点
 2.组播
 3.广播
 */

const http  = require('http');
const redis = require("redis");
const url   = require('url');

try{
let publisher = redis.createClient({
    host: '127.0.0.1',
    port: 6379
});

const hostname  = '127.0.0.1';
const port      = 3000;
const server    = http.createServer((req, res) => {
    let query     = url.parse(req.url, true).query,

        from      = query.from,
        //分组id 或者 name
        group     = query.group || '',
        //消息主体
        msg       = query.msg,
        //点对点发送
        to        = query.to || '',
        //消息传输类型(text/plain or png/image or other mime type)
        eventType = query.type,
        //消息事件类型
        mtype     = query.mtype,
        //系统级和用户级
        scope     = query.scope;


    if(!from){
        return res.end('who are you???');
    }

    //系统级消息先处理
    if(scope == 'system'){
        publisher.get(from,(err,serverID) => {

            if(err || !serverID){
                return res.end(`no this socket: ${to}`);
            }
            
            publisher.publish(`${serverID}#system`, JSON.stringify({
                mtype    : mtype,
                group    : group,
                from     : from,
                msg      : msg,
                serverId : serverID
            }));

            res.end('published');    
        })
        return;
    }

    //无消息, pass
    if(!msg){return res.end('no message! send failed');}

    //用户级消息
    if(group){//组播
        publisher.HGETALL(group,(err,all) => {
            if(err){
                return res.end(err.message);
            }

            if(!all || !all[from]){
                return res.end(`你不是房间 ${group} 内的成员..不能发送消息!`);
            }
            
            var serverGroup = {};
            delete all['owner'];
            
            for(var i in all){
                var serverId = all[i];
                !serverGroup[serverId] ? (serverGroup[serverId] = [],serverGroup[serverId].push(i)) : serverGroup[serverId].push(i);
            }

            for(var serverID in serverGroup){

                console.log(`${serverID}#${eventType || "text/plain"}`);
                console.log(to);
                publisher.publish(`${serverID}#${eventType || "text/plain"}`,JSON.stringify({
                    to: serverGroup[serverID],
                    msg: msg,
                    mtype:mtype,
                    from : from,
                    group : group
                }))
            }
            res.end('published');
        })

    }else if(to){//点对点
        publisher.get(to,(err,serverID) => {
            if(err || !serverID){
                return res.end(`no this socket: ${to}`);
            }
            publisher.publish(`${serverID}#${eventType || "text/plain"}`, JSON.stringify({
                to    : [to],
                msg   : msg,
                mtype : mtype,
                from  : from
            })); 
            res.end('published');
        })
    }else{//广播
        // publisher.publish("all#broadcast", JSON.stringify({
        //     msg   : msg,
        //     mtype : mtype,
        //     from  : from
        // }));
        res.end('暂不支持全局广播');
    } 
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});
}catch(e){
    console.log(e);
}