/* global require */
var CoreObject = require('core-object');
var fs         = require('fs');
var path       = require('path');
var mime       = require('mime');

var Promise    = require('ember-cli/lib/ext/promise');

var _          = require('lodash');
var TWO_YEAR_CACHE_PERIOD_IN_SEC = 60 * 60 * 24 * 365 * 2;

module.exports = CoreObject.extend({
  init: function(options) {
    this._plugin = options.plugin;
    var AWS = require('aws-sdk');
    this._client = this._plugin.readConfig('s3Client') || new AWS.S3({
      accessKeyId: this._plugin.readConfig('accessKeyId'),
      secretAccessKey: this._plugin.readConfig('secretAccessKey'),
      region: this._plugin.readConfig('region')
    });
  },

  upload: function(options) {
    options = options || {};
    return this._determineFilePaths(options).then(function(filePaths){
      return Promise.all(this._putObjects(filePaths, options));
    }.bind(this));
  },

  _determineFilePaths: function(options) {
    var plugin = this._plugin;
    var filePaths = options.filePaths || [];
    if (typeof filePaths === 'string') {
      filePaths = [filePaths];
    }
    var prefix       = options.prefix;
    var manifestPath = options.manifestPath;
    if (manifestPath) {
      var key = path.join(prefix, manifestPath);
      plugin.log('Downloading manifest for differential deploy from `' + key + '`...', { verbose: true });
      return new Promise(function(resolve, reject){
        var params = { Bucket: options.bucket, Key: key};
        this._client.getObject(params, function(error, data) {
          if (error) {
            reject(error);
          } else {
            resolve(data.Body.toString().split('\n'));
          }
        }.bind(this));
      }.bind(this)).then(function(manifestEntries){
        plugin.log("Manifest found. Differential deploy will be applied.", { verbose: true });
        return _.difference(filePaths, manifestEntries);
      }).catch(function(/* reason */){
        plugin.log("Manifest not found. Disabling differential deploy.", { color: 'yellow', verbose: true });
        return Promise.resolve(filePaths);
      });
    } else {
      return Promise.resolve(filePaths);
    }
  },

  _putObjects: function(filePaths, options) {
    var plugin           = this._plugin;
    var cwd              = options.cwd;
    var bucket           = options.bucket;
    var prefix           = options.prefix;
    var acl              = options.acl;
    var gzippedFilePaths = options.gzippedFilePaths || [];
    var cacheControl     = 'max-age='+(options.cacheControl || TWO_YEAR_CACHE_PERIOD_IN_SEC)+', public';

    var manifestPath = options.manifestPath;
    var pathsToUpload = filePaths;
    if (manifestPath) {
      pathsToUpload.push(manifestPath);
    }

    return pathsToUpload.map(function(filePath) {
      var basePath    = path.join(cwd, filePath);
      var data        = fs.readFileSync(basePath);
      var contentType = mime.lookup(basePath);
      var encoding    = mime.charsets.lookup(contentType);
      var key         = path.join(prefix, filePath);
      var isGzipped   = gzippedFilePaths.indexOf(filePath) !== -1;

      if (encoding) {
        contentType += '; charset=';
        contentType += encoding.toLowerCase();
      }

      var params = {
        Bucket: bucket,
        ACL: acl,
        Body: data,
        ContentType: contentType,
        Key: key,
        CacheControl: cacheControl
      };
      if (isGzipped) {
        params.ContentEncoding = 'gzip';
      }

      return new Promise(function(resolve, reject) {
        this._client.putObject(params, function(error, data) {
          if (error) {
            reject(error);
          } else {
            plugin.log('✔  ' + key, { verbose: true });
            resolve(filePath);
          }
        });
      }.bind(this));
    }.bind(this));
  }
});
