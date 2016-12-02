#安装
	npm install node-ws

# how to use

* 1.安装 redis ,并启动服务.默认端口
* 2.开启事件发布服务器
* 3.开启 socket 服务器


ps:

demo/socket.html 必须放在服务器上面, nginx,nodejs 或者其他.

# 开始

* 1. npm start (开启发布服务器和 socket 服务器)
* 2. 把 demo/socket.html 放到静态资源服务内.
* 3. 根据静态资源服务器路径 访问 demo/socket.html.