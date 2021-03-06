var util = require('./util');
var projectMd = require('../models/project');
var ObjectID = require('mongodb').ObjectID;
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var fs = require('fs');
var fileStore = require('./fileStore');
var commitLogic = require('./commit');
var notifLogic = require('./notif');

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
    headFiles: puh.headFiles,
    mainFile: puh.mainFile
  };

  projectMd.init(opts, function (err, doc) {
    if (err) return callback(err);

    createInDb(doc, true, function (err, project) {
      if (err) return callback(err);

      notifLogic.create({project: project}, function (err, notif) {
        project.notifId = notif._id;
        var updateDoc = {notifId: notif._id};

        updateProject(project, updateDoc, function (err) {
          if (err) return callback(err);

          exports.commit(project, function (err) {
            if (err) return callback(err);
            callback(undefined, project);
          });
        });
      });
    });
  });
};

exports.fork = function (uid, name, oldUser, project, commit, callback) {
  var doc = projectMd.initFork(uid, name, project, commit);

  initForkHead(doc, commit, function (err) {
    if (err) return callback(err);

    createInDb(doc, true, function (err, fork) {
      if (err) return callback(err);

      var opts = {project: fork, forkFrom: project};
      notifLogic.create(opts, function (err, notif) {
        fork.notifId = notif._id;
        var updateDoc = {notifId: notif._id};

        updateProject(fork, updateDoc, function (err) {
          if (err) return callback(err);

          updateForkParent(project, fork, function (err) {
            if (err) return callback(err);
            callback(undefined, fork);
          });
        });
      });
    });
  });
};

exports.getProject = function (userId, location, callback) {
  app.db.projects.findOne({userId: userId, location: location}, callback);
};

exports.getProjectById = function (projectIdStr, callback) {
  app.db.projects.findOne({_id: new ObjectID(projectIdStr)}, callback);
};

exports.getProjectsForUser = function (userId, callback) {
  // TODO: Use streaming and not toArray.
  app.db.projects.find({userId: userId}).toArray(callback);
};

exports.getLatestProjectsForUser = function (userId, callback) {
  // TODO: Use streaming and not toArray.
  app.db.projects.find({userId: userId})
      .sort({_id: 1}).limit(5).toArray(callback);
};

exports.getExplore = function (query, sort, callback) {
  // TODO: Use streaming and not toArray.
  app.db.projects.find(query).sort(sort).limit(9).toArray(callback);
};

// TODO: Fix it. This is brain dead. It creates a new permanent archive on every
// call.
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

exports.build = function (project, callback) {
  var main = project.headFiles[project.mainFile];
  app.latex.build(project.headPath, main, callback);
};

exports.commit = function (project, callback) {
  exports.build(project, function (err, buildError) {
    commitState(project, function (err, commit) {
      if (err) return callback(err);
      callback(undefined, commit, buildError);
    });
  });
};

exports.addModer = function (projectId, userId, callback) {
  var update = {$set: {}};
  update.$set['modders.' + userId] = true;

  app.db.projects.update({_id: projectId}, update, {w: 1}, callback);
};

exports.deleteFile = function (projectId, fid, filePath, userId, callback) {
  var update = {$set: {}};
  update.$set['modders.' + userId] = true;
  update.$set['headFiles.' + fid] = null;

  app.db.projects.update({_id: projectId}, update, {w: 1}, function (err) {
    if (err) return callback(err);
    deleteFromHead(filePath, callback);
  });
};

function deleteFromHead(filePath, callback) {
  // TODO: Delete the actual file.
  callback();
}

function commitState(project, callback) {
  exports.createHeadArchive(project, function (err, zipFile) {
    if (err) return callback(err);
    commitLogic.commit(project, zipFile, function (err, commit) {
      if (err) return callback(err);
      updateOnCommit(project, commit, callback);
    });
  });
}

function updateOnCommit(project, commit, callback) {
  var query = {_id: commit.projectId};
  var update = {
    $set: {modders: {}, commitTime: commit.created},
    $push: {commits: commit._id}
  };

  project.modders = {};
  project.commits.push(commit._id);

  app.db.projects.update(query, update, {w: 1}, function (err) {
    if (err) return callback(err);
    callback(undefined, commit);
  });
}

function createHeadArchive2(project, callback) {
  var file = app.config.dirs.tmp + '/' + util.randomBase36(48) + '.zip';
  var paths = project.headFiles.filter(function (p) { return p !== null; });
  try {
    process.chdir(project.headPath);
  } catch (err) {
    return callback(err);
  }
  var child = spawn('zip', [file, '-@']);
  child.stdin.end(paths.join('\n') + '\n');
  child.on('close', function (code) {
    if (code !== 0) return callback('zip-code-' + code);
    createHeadArchive3(file, callback);
  });
}

function createHeadArchive3(zipFile, callback) {
  fileStore.store(zipFile, true, function (err, hash) {
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

  if (!/[a-zA-Z][a-zA-Z0-9.-]{0,32}/.test(location)) {
    return 'invalid-location';
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
  util.getNewHeadDir(function (err, path) {
    if (err) return callback(err);
    initHead(project, path, function (err, updateDoc) {
      if (err) return callback(err);

      notifLogic.create({project: project}, function (err, notif) {
        project.notifId = notif._id;
        updateDoc.notifId = notif._id;

        updateProject(project, updateDoc, function (err) {
          if (err) return callback(err);
          exports.commit(project, callback);
        });
      });
    });
  });
}

function updateProject(project, setVals, callback) {
  var query = {_id: project._id};
  var update = {$set: setVals};

  app.db.projects.update(query, update, {w: 1}, callback);
}

function initHead(project, headPath, callback) {
  var updateDoc = {};
  updateDoc.headPath = project.headPath = headPath;
  var initFile = __dirname + '/../../data/latex/empty.tex';
  var mainFile = 'main.tex';
  var mainPath = headPath + '/' + mainFile;

  util.copyFile(initFile, mainPath, function (err) {
    if (err) return callback(err);

    updateDoc.headFiles = project.headFiles = [mainFile];
    updateDoc.mainFile = project.mainFile = 0;

    callback(undefined, updateDoc);
  });
}

function initForkHead(doc, commit, callback) {
  util.getNewHeadDir(function (err, path) {
    if (err) return callback(err);

    doc.headPath = path;

    commitLogic.restoreCommit(doc, commit, callback);
  });
}

function updateForkParent(project, fork, callback) {
  callback();
}
