var express = require('express');
var http = require('http');
var path = require('path');
var MongoStore = require('connect-mongo')(express);
var sharejs = require('share');

var Database = require('./Database');
var Latex = require('./Latex');
var WebSocketServer = require('./WebSocketServer');
var routes = require('../routes');

function App(config) {
  this.config = config;
  this.express = null;
  this.db = null;
  this.sessionStore = null;
  this.cookieParser = null;
  this.server = null;
  this.webSocketServer = new WebSocketServer(this);
  this.shareJs = null;
  this.latex = new Latex(this);
}

App.prototype.load = function (callback) {
  this.db = new Database(this.config.mongoUrl);
  this.express = express();

  var that = this;
  this.db.connect(function () {
    that.configure();
    that.registerRoutes();
    callback();
  });
};

App.prototype.start = function () {
  this.createServer();
  this.webSocketServer.setup();
};

// TODO: Close all the rest.
App.prototype.stop = function (callback) {
  this.db.disconnect(function () {
    callback();
  });
};

App.prototype.configure = function () {
  this.sessionStore = new MongoStore({db: this.config.mongoDbName});
  this.cookieParser = express.cookieParser(this.config.cookieSecret);
  // all environments
  this.express.set('views', __dirname + '/../views');
  this.express.set('view engine', 'jade');
  this.express.use(express.compress());

  if (this.config.logger) {
    express.logger.token('date', function () {
      return new Date().toISOString();
    });
    this.express.use(express.logger(this.config.logger));
  }

  this.express.use(express.bodyParser({
    uploadDir: this.config.dirs.upload,
    limit: this.config.fileLimit
  }));
  this.express.use(express.methodOverride());
  this.express.use(this.cookieParser);
  this.express.use(express.session({
    secret: this.config.cookieSecret,
    store: this.sessionStore
  }));
  this.express.use(require('../logic/jadeLocals.js'));
  this.express.use('/s', express['static'](__dirname + '/../../static'));
  this.express.use('/store', express['static'](this.config.dirs.store));
  this.configureShareJs();
  this.express.use(this.express.router);

  // development only
  if ('development' === this.express.get('env')) {
    this.express.use(express.errorHandler());
  }
};

App.prototype.configureShareJs = function () {
  var shareOpt = {
    db: {type: 'none'}
  };
  sharejs.server.attach(this.express, shareOpt);
  this.shareJs = this.express.model;
};

App.prototype.registerRoutes = function () {
  routes.registerRoutes(this);
};

App.prototype.createServer = function () {
  var port = this.config.port;
  this.server = http.createServer(this.express);
  this.server.listen(port, function () {
    console.log('Express server listening on port ' + port + '.');
  });
};

App.prototype.getReqSession = function (req, callback) {
  var that = this;

  this.cookieParser(req, null, function (err) {
    if (err) return callback(err);

    var sessionId = req.signedCookies['connect.sid'];
    that.sessionStore.get(sessionId, function (err, session) {
      if (err) return callback(err);
      callback(undefined, session);
    });
  });
};

module.exports = App;
