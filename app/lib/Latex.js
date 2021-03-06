var spawn = require('child_process').spawn;

function Latex(app) {
  this.app = app;
  this.defaultArgs = ['-no-shell-escape', '-halt-on-error'];
}

Latex.prototype.build = function (dir, file, callback) {
  var args = this.defaultArgs.slice(0);
  args.push('-output-directory', dir);
  args.push(file);

  try {
    process.chdir(dir);
  } catch (err) {
    return callback(err);
  }

  var pdflatex = spawn('pdflatex', args);
  pdflatex.on('close', function (code) {
    callback(undefined, code !== 0);
  });
};

module.exports = Latex;
