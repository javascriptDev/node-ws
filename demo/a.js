var ws = require('../bin/socket.js');

var instance = new ws({
	redisConfig :{
		host:'127.0.0.1',
		port: 6379
	}
});

instance.listen(8000);