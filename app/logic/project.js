var headDir = require('./headDir');
var util = require('./util');
var projectMd = require('../models/project');
var ObjectID = require('mongodb').ObjectID;
var exec = require('child_process').exec;
var fs = require('fs');
var fileStore = require('./fileStore');

var app = null;

exports.setApp = function (pApp) {
  app = pApp;
};

exports.create = function (opts, callback) {
  var err = checkLocationValidity(opts.location);
  if (err) return callback(err);

  projectMd.init(opts, function (err, doc) {
    if (err) return callback(err);

    createInDb(doc, true, function (err, project) {
      if (err) return callback(err);

      createAndInitHead(project, function (err) {
        if (err) return callback(err);
        callback(undefined, project);
      });
    });
  });
};

exports.createFrom = function (username, userId, puh, callback) {
  var opts = {
    username: username,
    userId: userId,
    location: puh.name,
    headPath: puh.headPath,
    headFile: puh.mainFile,
    headFiles: puh.headFiles
  };

  projectMd.init(opts, function (err, doc) {
    if (err) return callback(err);
    projectMd.fixToMongo(doc);

    createInDb(doc, true, function (err, project) {
      if (err) return callback(err);
      callback(undefined, project);
    });
  });
};

exports.getProject = function (userId, location, callback) {
  var query = {userId: userId, location: location};
  app.db.projects.findOne(query, function (err, project) {
    if (err) return callback(err);
    if (!project) return callback('project-not-found');
    projectMd.fixFromMongo(project);
    callback(undefined, project);
  });
};

exports.getProjectById = function (projectIdStr, callback) {
  var query = {_id: new ObjectID(projectIdStr)};
  app.db.projects.findOne(query, function (err, project) {
    if (err) return callback(err);
    if (!project) return callback('project-not-found');
    projectMd.fixFromMongo(project);
    callback(undefined, project);
  });
};

exports.getProjectsForUser = function (userId, callback) {
  // TODO: Use streaming and not toArray.
  app.db.projects.find({userId: userId}).toArray(callback);
};

exports.createHeadArchive = function (project, callback) {
  var eProject = app.webSocketServer.getProjectById(project._id.toString());
  if (eProject) {
    eProject.saveAllFiles(function (errs) {
      if (errs) return callback(errs);
      createHeadArchive2(project, callback);
    });
    return;
  }
  createHeadArchive2(project, callback);
};

function createHeadArchive2(project, callback) {
  var file = app.config.dirs.tmp + '/' + util.randomBase36(48) + '.zip';
  var commands = 'cd ' + project.headPath + ' && zip -q -r ' + file + ' .' +
    ' -x \\*.pdf -x \\*.aux -x \\*.log';
  exec(commands, function (err) {
    if (err) return callback(err);
    createHeadArchive3(project, file, callback);
  });
}

function createHeadArchive3(project, zipFile, callback) {
  fileStore.moveFile(zipFile, function (err, hash) {
    if (err) return callback(err);
    callback(undefined, hash);
  });
}

// TODO: Do more advanced checks.
// TODO: Check reserved list.
function checkLocationValidity(location) {
  if (!location || location.length === 0) {
    return 'no-location-given';
  }

  if (!/[a-zA-Z][a-zA-Z0-9.-]{3,32}/.test(location)) {
    return 'Location is invalid. Allowed characters are alphanumerics, “.”, and “-”.';
  }

  return null;
}

function createInDb(doc, tryToFixLocation, callback) {
  app.db.projects.insert(doc, {w: 1}, function (err, project) {
    if (err) {
      if (err.code === 11000 && tryToFixLocation) {
        fixLocation(doc, function (err) {
          if (err) return callback('project-exists-for-user');
          createInDb(doc, false, callback);
        });
      } else {
        util.logErr(err);
        callback('project-creation-error');
      }
      return;
    }

    callback(undefined, project[0]);
  });
}

function fixLocation(doc, callback) {
  // TODO: Find the first one which fits and select only names.
  app.db.projects.find({userId: doc.userId}).toArray(function (err, projects) {
    if (err) return callback(err);
    doc.location += '-' + projects.length;
    callback();
  });
}

function createAndInitHead(project, callback) {
  headDir.getNewDir(function (path) {
    var updateDoc = {
      headPath: path
    };

    initHead(updateDoc, function (err) {
      if (err) return callback(err);
      var query = {_id: project._id};
      projectMd.fixToMongo(updateDoc);
      var update = {$set: updateDoc};

      app.db.projects.update(query, update, {w: 1}, function (err, nUpdated) {
        if (err) return callback(err);
        callback();
      });
    });
  });
}

function initHead(updateDoc, callback) {
  var initFile = __dirname + '/../../data/latex/empty.tex';
  var mainFile = updateDoc.headPath + '/main.tex';
  util.copyFile(initFile, mainFile, function (err) {
    if (err) return callback(err);

    updateDoc.headFile = 'main.tex';
    updateDoc.headTree = {
      'main.tex': true
    };

    callback();
  });
}
