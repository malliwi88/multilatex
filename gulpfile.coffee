gulp = require 'gulp'
stylus = require 'gulp-stylus'
browserify = require 'gulp-browserify'
rename = require 'gulp-rename'
gutil = require 'gulp-util'
uglify = require 'gulp-uglify'
nib = require 'nib'
runSequence = require 'run-sequence'
config = require './config'
{spawn, exec} = require 'child_process'

production = '--production' in process.argv
deployUser = 'vagrant'
deployServer = config.devServer
deployRoot = 'root@' + deployServer

gulp.task 'rsync', (cb) ->
  c = spawn 'rsync', [
    '-a', '--del'
    'app', 'data', 'node_modules', 'static'
    'build'
  ]
  c.stdout.on 'data', (d) -> process.stdout.write d
  c.on 'close', (code) ->
    return cb 'err-' + code unless code is 0
    exec 'coffee --compile --bare --output build/config config', cb

cssTask = (prefix) ->
  gulp.task prefix + '-css',  ->
    # TODO: Compress.
    gulp.src "app/styles/#{prefix}/#{prefix}.styl"
    .pipe stylus
      use: [nib()]
      errors: true
    .pipe gulp.dest 'build/static/css'

cssTask 'site'
cssTask 'editor'

gulp.task 'editor-js', ->
  gulp.src 'editor/main.coffee', read: false
  .pipe browserify
    transform: ['coffeeify']
    extensions: ['.coffee']
    debug: !production
  .pipe rename 'editor.js'
  .pipe if production then uglify() else gutil.noop()
  .pipe gulp.dest 'build/static/js'

gulp.task 'bootstrap', ->
  gulp.src 'bower_components/bootstrap/dist/**/*.*',
      {base: 'bower_components/bootstrap/dist'}
  .pipe gulp.dest 'build/static/bootstrap'

gulp.task 'jslibs', ->
#  bc = 'bower_components/'
#  files = [
#    bc + 'backbone/backbone.js'
#    bc + 'underscore/underscore.js'
#    bc + 'jquery-file-upload/js/jquery.fileupload.js'
#    bc + 'jquery-file-upload/js/jquery.fileupload-ui.js'
#    bc + 'jquery-file-upload/js/jquery.fileupload-jquery-ui.js'
#    bc + 'jquery-file-upload/js/jquery.iframe-transport.js'
#  ]
  files = [
    'static/jslibs/backbone-min.js'
    'static/jslibs/jquery.fileupload.css'
    'static/jslibs/jquery.fileupload.js'
    'static/jslibs/jquery.iframe-transport.js'
    'static/jslibs/jquery.ui.widget.js'
    'static/jslibs/underscore-min.js'
  ]
  gulp.src files
  .pipe uglify()
  .pipe gulp.dest 'build/static/jslibs'

gulp.task 'jslibs-other', ->
  gulp.src 'bower_components/jquery-file-upload/css/jquery.fileupload.css'
  .pipe gulp.dest 'build/static/css'

gulp.task 'static', ['bootstrap', 'jslibs', 'jslibs-other']

gulp.task 'build-files', ['site-css', 'editor-css', 'editor-js', 'static']

gulp.task 'build', (cb) ->
  runSequence 'rsync', 'build-files', cb

gulp.task 'dev-deploy', (cb) ->
  exec """
    ssh #{deployRoot} <<END
      service multilatex stop
    END

    rsync -a --del --exclude .git build/ #{deployRoot}:/opt/multilatex
    scp data/upstart/multilatex.conf #{deployRoot}:/etc/init

    ssh #{deployRoot} <<END
      mkdir -p \
        #{config.dirs.store} \
        #{config.dirs.heads} \
        #{config.dirs.tmp} \
        #{config.dirs.upload} \
        2>/dev/null
      chown -R multilatex:multilatex \
        #{config.dirs.store} \
        #{config.dirs.heads} \
        #{config.dirs.tmp} \
        #{config.dirs.upload}
      service multilatex start
    END
  """, cb

gulp.task 'dev-log', (cb) ->
  c = spawn 'ssh', [deployRoot, 'tail', '-f', '/var/log/multilatex']
  c.stdout.on 'data', (d) -> process.stdout.write d
  c.on 'close', (code) ->
    return cb 'err-' + code unless code is 0
    cb()

updateProjectAndGoToIt = """
  rsync -a --del ./ #{deployRoot}:/opt/multilatex-dev/
  cd /opt/multilatex-dev
"""

gulp.task 'dev-templates', (cb) ->
  exec """
    ssh #{deployRoot} <<END
      #{updateProjectAndGoToIt}
      gulp templates
    END
  """, cb

gulp.task 'dev-project', (cb) ->
  exec """
    #{updateProjectAndGoToIt}
  """, cb

gulp.task 'clear-db', (cb) ->
  Database = require './app/lib/Database'
  db = new Database config.mongoUrl
  db.connect ->
    db.db.dropDatabase (err, result) ->
      console.log err if err
      db.disconnect cb

gulp.task 'templates', (cb) ->
  templates = require './app/logic/templates'
  templates.recreate config, cb

gulp.task 'default', ['build']
