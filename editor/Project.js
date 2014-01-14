var ActiveFile = require('./ActiveFile');

function Project(app, projectId) {
  this.app = app;
  this.projectId = projectId;
  this.doc = null;
  this.file = null;
}

Project.prototype.load = function () {
  var that = this;
  this.app.wss.callMsg('openProject', this.projectId, function (msg) {
    if (msg.error) return that.app.panic(msg.error);

    that.doc = msg.project;
    that.loadProjectTree();
    that.loadMainFile();
    that.app.gui.output.pdf.loadNew('head/pdf');
  });
};

Project.prototype.loadProjectTree = function () {
  var treeView = this.app.gui.project.tree;
  treeView.root.changeName(this.doc.location);
  treeView.fillWith(this.doc.headFiles, this.doc.mainFile);
};

Project.prototype.loadMainFile = function () {
  this.loadFile(this.doc.mainFile);
};

Project.prototype.loadFile = function (fid) {
  var that = this;
  this.app.wss.callMsg('openFile', fid, function (msg) {
    if (msg.error) return that.app.panic(msg.error);

    if (that.file) {
      that.file.close();
    }

    that.file = new ActiveFile(that, fid);
    that.file.load();
  });
};

Project.prototype.build = function () {
  var that = this;
  this.app.wss.callMsg('buildProject', {}, function (msg) {
    if (msg.error) return that.app.panic(msg.error);
    that.app.gui.output.pdf.loadNew('head/pdf');
  });
};

Project.prototype.commit = function () {
  var that = this;
  this.app.wss.callMsg('commitProject', {}, function (msg) {
    if (msg.error) return that.app.panic(msg.error);
  });
};

module.exports = Project;
