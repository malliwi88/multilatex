var App = require('./lib/App');

function main() {
  var app = new App(require('../config/config'));
  app.load(function () {
    app.start();
  });
}

main();
