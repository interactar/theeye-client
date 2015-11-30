'use strict'

var os = require('os');
var fs = require('fs');
var path = require('path');
var request = require('request');
var util = require('util');
var format = util.format;

var logger = {
  debug : require('debug')('eye:client:debug') ,
  error : require('debug')('eye:client:error')
};

var EventEmitter = require('events').EventEmitter;

var CLIENT_VERSION = 'v0.0.0-beta' ;

var CLIENT_NAME = 'Golum' ;

var GET    = 'get';
var PUT    = 'put';
var POST   = 'post';
var PATCH  = 'patch';
var DELETE = 'delete';

module.exports = TheEyeClient;

/**
 *
 *
 */
function TheEyeClient (options)
{
  this.access_token = '';

  this.configure(options);

  EventEmitter.call(this);

  return this;
}


util.inherits(TheEyeClient, EventEmitter);

/**
 *
 *
 */
var prototype = {
  /**
   *
   * @author Facundo
   * @return undefined
   * @param Object options
   *
   */
  configure: function(options)
  {
    var connection = this;

    logger.debug('theeye api client version %s/%s', CLIENT_NAME, CLIENT_VERSION);

    for(var prop in options) connection[prop] = options[prop];

    connection.api_url = options.api_url || process.env.THEEYE_SUPERVISOR_API_URL ;
    connection.client_id = options.client_id || process.env.THEEYE_SUPERVISOR_CLIENT_ID ;
    connection.client_secret = options.client_secret || process.env.THEEYE_SUPERVISOR_CLIENT_SECRET ;
    connection.client_customer = options.client_customer || process.env.THEEYE_SUPERVISOR_CLIENT_CUSTOMER ;
    connection.access_token = options.access_token || null ;

    logger.debug('connection properties => %o', connection);
    if( ! connection.api_url ) {
      return logger.error('ERROR. supervisor API URL required');
    }

    connection.request = request.defaults({
      proxy: process.env.http_proxy,
      tunnel: false,
      timeout: 5000,
      json: true,
      gzip: true,
      headers: { 'User-Agent': CLIENT_NAME + '/' + CLIENT_VERSION },
      baseUrl: connection.api_url
    });
  },
  /**
   *
   * @author Facundo
   * @return undefined
   * @param Function next
   *
   */
  refreshToken : function(next) {
    var connection = this;

    if(!this.client_id || !this.client_secret){
      logger.debug('no credentials!');
      throw new Error('no credential provided. client_id & client_secret required');
    }

    logger.debug('sending new authentication request');

    var next = next || function(){};

    this.request.post({
      'baseUrl' : this.api_url,
      'url': '/token' ,
      'auth': {
        'user' : this.client_id,
        'pass' : this.client_secret,
        'sendImmediately' : true
      }
    }, function(error,httpResponse,token) {
      if(error) {
        logger.error('unable to get new Token');
        return next(error);
      } else if( httpResponse.statusCode == 200 ){
        logger.debug('successful token refresh %s', JSON.stringify(token));
        connection.access_token = token;

        return next(null, token);
      } else {
        var message = 'token refresh failed ' + JSON.stringify(token);
        logger.error(message);
        return next(new Error(message),null);
      }
    });
  },
  /**
   * handle response data and errors
   * @author Facundo
   */
  processResponse : function(
    request,
    error,
    httpResponse,
    body,
    next
  ){
    var connection = this;

    var callNext = function(error, body){
      if(next) next(error, body, httpResponse);
    }

    if( ! error && /20./.test( httpResponse.statusCode ) ) {
      logger.debug('%s %s request success', request.method, request.url);
      callNext(null,body);
    }
    else // error condition detected
    {
      logger.error('error detected on %s %s', request.method, request.url);
      logger.error(request);
      if(error)
      {
        // could not send data to server
        logger.error('request failed : %s', JSON.stringify(request) );
        logger.error(error.message);
        error.statusCode = httpResponse ? httpResponse.statusCode : null;
        logger.error(body);
        callNext(error, body);
      }
      else if( httpResponse.statusCode == 401 ) 
      {
        // unauthorized
        logger.error('access denied');
        connection.refreshToken(function(error, token) {
          if(error) {
            logger.error('client could not be authenticated');
            logger.error(error.message);
            error.statusCode = httpResponse.statusCode;
            //throw new Error('agent could not be authenticated');
          }
          callNext(error, body);
        });

      }
      else if(
        (body && body.status == 'error') 
        || /40./.test( httpResponse.statusCode )
      ) {
        body = body || {};
        logger.error(body);
        var error = new Error(body.message || 'client error');
        error.data = body.data || {};
        error.statusCode = httpResponse.statusCode ;
        callNext(error,body);
      }
      else
      {
        logger.error('>>>>>>>>>>>> unhandled error! <<<<<<<<<<<<');
        logger.error('request %s' , JSON.stringify(request) ); 
        logger.error('status  %s' , httpResponse.statusCode ); 
        logger.error('error   %s' , error && error.message  ); 
        logger.error('body    %s' , JSON.stringify(body)    ); 
        logger.error('>>>>>>>>>>>>>>>>>>>> * <<<<<<<<<<<<<<<<<<<');

        if(!error) {
          error = new Error(JSON.stringify(body));
          error.statusCode = httpResponse.statusCode;
        }

        callNext(error, body);
      }
    }
  },
  /**
   * prepare the request to be sent.
   * append auth data and mandatory parameters
   * @author Facundo
   * @return {Object} Request
   */
  performRequest : function(options, doneFn){
    var connection = this;
    doneFn = doneFn || function(){};
    var hostname = this.hostname;

    var prepareUri = function (uri) {
      uri = uri.replace(':hostname' , hostname);
      return uri ;
    }

    var prepareQueryString = function (qs) {
      qs = qs || {};
      if( ! qs.customer ) {
        if( connection.client_customer ) {
          qs.customer = connection.client_customer;
        }
      }
      /**
      if( ! qs.client_id ) {
        if( connection.client_id ) {
          qs.client_id = connection.client_id;
        }
      }
      */
      return qs;
    }

    options.uri = options.url = prepareUri(options.url || options.uri);
    options.qs = prepareQueryString(options.qs);

    // set authentication method if not provided
    if( ! options.auth ) {
      if( connection.access_token ) {
        options.auth = { bearer : connection.access_token } ;
      }
    }

    var msg = 'requesting %s';
    msg += options.qs ? ' qs: %o' : '';
    logger.debug(msg, options.url, options.qs || '');

    var requestDoneFn = function(error, httpResponse, body){
      connection.processResponse(
        options,
        error,
        httpResponse,
        body,
        doneFn
      );
    }

    return connection.request(options, requestDoneFn);
  },
  /**
   * get request wrapper
   * @author Facundo
   * @return Request connection.request
   */
  get : function(route,query,next) {
    var options = {
      method: 'GET',
      url: route,
      qs: query
    };
    return this.performRequest(options, next);
  },
  /**
   * delete request wrapper
   * @author Facundo
   * @return Request connection.request
   */
  remove : function(route,query,next) {
    var options = {
      method: 'DELETE',
      url: route,
      qs: query
    };
    return this.performRequest(options, next);
  },
  /**
   * post request wrapper
   * @author Facundo
   * @return Request connection.request
   */
  post : function(route,query,body,next) {
    var options = {
      method: 'POST',
      url: route,
      body: body,
      qs: query
    };
    return this.performRequest(options, next);
  },
  /**
   * put request wrapper
   * @author Facundo
   * @return Request connection.request
   */
  put : function(route,query,body,next) {
    var options = {
      method: 'PUT',
      url: route, 
      body: body,
      qs: query
    };
    return this.performRequest(options, next);
  },
  /**
   * patch request wrapper
   * @author Facundo
   * @return Request connection.request
   */
  patch : function(route,query,body,next) {
    var options = {
      method: 'PATCH',
      url: route, 
      body: body,
      qs: query
    };
    return this.performRequest(options, next);
  },
  /**
   *
   *
   *
   * agent methods
   *
   *
   *
   */
  getNextPendingJob : function(options,doneFn) {

    var hostname = (options && options.hostname) ? options.hostname : this.hostname;

    this.performRequest({
      method: 'get',
      url: '/job',
      qs: {
        process_next: 1,
        hostname: hostname
      }
    }, function(error,body){
      if( ! error ) {
        if( body && body.jobs ) {
          doneFn(null, body.jobs[0]);
        } else {
          logger.error('getNextPendingJob : body content error');
          doneFn(error, null);
        }
      } else {
        logger.error('getNextPendingJob : request error');
        logger.error(error, null);
      }
    });
  },
  /**
   *
   *
   */
  sendAgentKeepAlive : function() {
    this.performRequest({
      method:'put',
      url:'/agent/:hostname'
    });
  },
  /**
   *
   *
   */
  submitJobResult : function(jobId,result,next) {
    this.performRequest({
      method: 'PUT',
      url: '/job/' + jobId, 
      body: {result:result}
    }, function(error,response){
      if( error ) {
        logger.error('unable to update job');
        if(next) next(error);
      } else {
        logger.debug('job updated');
        if(next) next(null,response);
      }
    });
  },
  /**
   *
   *
   */
  updateResource : function(resourceId,resourceUpdates,next) {
    this.performRequest({
      method: 'PUT',
      url:'/resource/' + resourceId,
      body: resourceUpdates
    }, function(error,response){
      if( error ) {
        logger.error('unable to update resource');
        logger.error(error.message);
        if(next) next(error);
      } else {
        logger.debug('resource updated');
        if(next) next(null,response);
      }
    });
  },
  /**
   *
   *
   */
  submitDstat : function(dstat,next) {
    this.performRequest({
      url: '/dstat/:hostname',
      method: 'post',
      body: dstat
    }, next);
  },
  /**
   *
   *
   */
  submitPsaux : function(psaux,next) {
    this.performRequest({
      method: 'post',
      body: psaux,
      url: '/psaux/:hostname'
    }, next);
  },
  /**
   *
   *
   */
  registerAgent : function(data,next) {
    this.performRequest({
      url:'/host/:hostname',
      body:data,
      method:'post'
    }, next);
  },
  /**
   *
   *
   */
  getAgentConfig : function(hostname, next) {
    this.performRequest({
      method:'get',
      url: '/agent/:hostname/config',
    },function(error,body){
      if( error ) {
        logger.error('getAgentConfig : request error');
        logger.error(error.message);
        next(error,null);
      } else {
        if( ! body || ! body.config ) {
          logger.error('getAgentConfig : respose body error. no "data" property found');
          logger.error(body);
          next(error,null);
        } else {
          logger.debug('%j', body.config);
          logger.debug('agent config fetch success');
          next(null,body.config);
        }
      }
    });
  },
  //  
  //  
  //  
  //  admin resources operations
  //  
  //  
  //  
  /**
   * Gets a script by its Id
   *
   * @param {Number} id - The script id in supervisor
   * @param {Function} callback - Called with the scripts as second parameter.
   *   - param {Error} error - Null if nothing bad happened.
   *   - param {Array} scripts - Array of script objects.
   */
  script: function(id, callback) {
    this.performRequest({
      method: 'get',
      url: '/script/' + id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.script);
    });
  },
  /**
   *
   * Gets available scripts for customer and username
   *
   * @param {Number} id - The script id in supervisor
   * @param {Function} callback - Called with the scripts as second parameter.
   *   - param {Error} error - Null if nothing bad happened.
   *   - param {Array} scripts - Array of script objects.
   */
  scripts: function(callback) {
    this.performRequest({
      method: 'get',
      url: '/script'
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.scripts);
    });
  },
  /**
   *
   * Download the file script. Return a stream
   *
   * @author Facundo
   * @param {Integer} script id
   * @param {Function} callback
   * @return {Stream} script file data stream
   *
   */
  downloadScript : function(scriptId, destinationPath, next) {
    var writable = fs.createWriteStream( destinationPath, { mode:'0755' } );

    this.performRequest({
      method: 'get',
      url: format('/script/%s/download', scriptId)
    })
    .on('response', function(response) {
      if(response.statusCode != 200) {
        this.emit('error', new Error('get script response error ' + response.statusCode));
      }
    })
    .on('error',function(error){
      logger.error('request produce an error');
      logger.error(error.message);
    })
    .pipe( writable )
    .on('finish',function(){
      if(next) next();
    });
  },
  /**
   * Gets a script file by its Id
   *
   * @param {Number} id - The script id in supervisor
   * @param {Function} callback - Called with the scripts as second parameter.
   *   - param {Error} error - Null if nothing bad happened.
   *   - param {scriptFile} - base64 encode file
   */
  scriptDownload : function(id, callback) {
    this.performRequest({
      method: 'get',
      url: format('/script/%s/download', id)
    },function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },

  /**
   * Creates a Script
   *
   * @param {Object} script - A descriptor for the file that is going to be uploaded.
   *   - param {String} fd - Local filepath .
   *   - param {String} filename - Script filename .
   * @param {Object} options - script properties.
   *   - param {String} description - Script description.
   * @param {Function} callback - Called with the task as second parameter.
   *   - param {Error} error - Null if nothing bad happened.
   *   - param {Array} script - The new script object.
   */
  createScript: function(script, options, callback) {
    this.performRequest({
      method: 'post',
      url: '/script',
      formData: {
        description : options.description || '',
        script: {
          value: fs.createReadStream(script.fd),
          options: {
            filename: options.filename || script.filename
          }
        }
      }
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   * Deletes a Script
   */
  deleteScript: function(id, callback) {
    this.performRequest({
      method: 'delete',
      uri: '/script/' + id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   * Patch a Script
   */
  patchScript: function(id, script, options, callback) {
    this.performRequest({
      method: 'patch',
      uri: '/script/' + id,
      formData: {
        description : options.description || '',
        script: {
          value: fs.createReadStream(script.fd),
          options: {
            filename: options.filename || script.filename
          }
        }
      }
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   * Get a Task
   *
   * @param {Number} id - The script id in supervisor
   * @param {Function} callback - Called with the scripts as second parameter.
   */
  task: function(id, callback) {
    this.performRequest({
      method: 'get',
      uri: '/task/' + id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   * Gets Tasks
   *
   * @param {Number} id - The task id in supervisor
   * @param {Function} callback - Called with the tasks as second parameter.
   *   - param {Error} error - Null if nothing bad happened.
   *   - param {Array} tasks - Array of task objects.
   */
  tasks: function(callback) {
    this.performRequest({
      method: 'get',
      url: '/task',
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.tasks);
    });
  },
  /**
  * Creates a new task for a customer in the supervisor
  *
  * @param {Object} task - A task object.
  *   - param {String} name - Task name.
  *   - param {String} description - Task description.
  * @param {Function} callback - Called with the task as second parameter.
  *   - param {Error} error - Null if nothing bad happened.
  *   - param {Array} task - the new task object.
  */
  createTask: function(task, callback) {

    var formData = {
      'name': task.name,
      'description': task.description,
      'script': task.script_id,
      'script_arguments': task.script_arguments.split(',')
    };

    if( task.target == 'single-resource' ) {
      if(task.resource_id) formData['resource'] = task.resource_id;
      if(task.hosts_id) formData['hosts'] = task.hosts_id[0];
    } 
    else if (task.target == 'multi-hosts') {
      formData['hosts'] = task.hosts_id;
    }

    this.performRequest({
      method: 'post',
      url: '/task',
      formData: form
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   * partially update a task
   *
   * @param {Object} task - A task object.
   *   - param {String} description - Task name.
   *   - param {String} description - Task description.
   * @param {Function} callback - Called with the task as second parameter.
   *   - param {Error} error - Null if nothing bad happened.
   *   - param {Array} task - the new task object.
   */
  patchTask: function(id, task, callback) {
    var formData = {
      'name': task.name,
      'description': task.description,
      'host': task.host_id,
      'script': task.script_id,
    };

    if(task.resource_id) formData['resource'] = task.resource_id;
    var args = task.script_arguments.split(',');
    formData['script_arguments'] = args;

    this.performRequest({
      method: 'patch',
      uri: '/task/' + id,
      formData: formData
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   *
   *
   */
  deleteTask: function(task_id, callback) {
    this.performRequest({
      method: 'delete',
      uri: '/task/' + task_id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   *
   *
   */
  triggerJob: function(task_id, callback) {
    this.performRequest({
      method: 'post',
      uri: '/job',
      qs: {
        'task_id': task_id
      }
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   *
   *
   */
  monitorFetch: function(options, callback) {
    this.performRequest({
      method: 'get',
      url: '/monitor',
      qs: {
        type: options.type,
        resource: options.resource
      }
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.monitors);
    });
  },
  /**
   *
   *
   */
  resource: function(id, callback) {
    this.performRequest({
      method: 'get',
      url: '/resource/' + id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.resource);
    });
  },  
  /**
  * Gets available resources for customer and username
  *
  * @param {Number} id - The resource id in supervisor
  * @param {Function} callback - Called with the resources as second parameter.
  *   - param {Error} error - Null if nothing bad happened.
  *   - param {Array} resources - Array of resource objects.
  */
  resources: function(callback) {
    this.performRequest({
      method: 'get',
      url: '/resource'
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.resources);
    });
  },
  /**
   *
   *
   */
  deleteResource : function(id, callback) {
    this.performRequest({
      method: 'delete',
      url: '/resource/' + id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   *
   *
   */
  createResource : function(resource, callback) {
    var formData = {};
    Object.keys(resource).forEach(function(key) {
      if(key == 'hosts'){
        formData['hosts'] = resource.hosts;
      }
      else if(key == 'script_arguments') {
        formData['script_arguments'] = [];
        var args = resource.script_arguments.split(',');
        for(var i=0; i<args.length; i++)
          formData['script_arguments'].push( args[i].trim() );
      }
      else formData[key] = resource[key];
    });

    this.performRequest({
      method: 'post',
      url: '/resource',
      formData: formData
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  },
  /**
   *
   *
   */
  patchResource: function(id, resource, callback) {
    var formData = {};

    Object.keys(resource).forEach(function(key) {
      if(key == 'script_arguments') {
        formData['script_arguments'] = [];
        var args = resource.script_arguments.split(',');
        for(var i=0; i<args.length; i++)
          formData['script_arguments'].push( args[i].trim() );
      }
      else formData[key] = resource[key];
    });

    this.performRequest({
      method: 'patch',
      url: '/resource/' + id,
      formData: formData
    }, function(error, body) {
      if (error) return callback(error);

      logger.debug('resource patch success');
      callback(null, body);
    });
  },  
  /**
   *
   *
   */
  resourceTypes: function(callback) {
    this.performRequest({
      method: 'get',
      url: '/resource/type'
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.types);
    });
  },
  /**
   *
   *
   */
  host: function(id, callback){
    this.performRequest({
      method: 'get',
      url: '/host/' + id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.host);
    });
  },
  /**
   *
   *
   */
  hosts: function(callback) {
    this.performRequest({
      method: 'get',
      url: '/host'
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.hosts);
    });
  },
  /**
   *
   *
   */
  hostStats: function(id, callback){
    var path = format('/host/%s/stats', id);
    this.performRequest({
      method: 'get',
      url: path
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.stats);
    });
  },
  /**
   *
   *
   */
  hostResource: function(id, callback){
    this.performRequest({
      method: 'get',
      url: '/resource',
      qs: {
        host: id
      }
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.resources[0]);
    });
  },
  /**
   *
   *
   */
  scraperHosts: function(callback) {
    this.performRequest({
      method: 'get',
      url: '/host',
      qs: {
        scraper: true
      }
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.hosts);
    });
  },
  /**
   *
   *
   */
  customerFetch : function(filters, callback) {
    this.performRequest({
      method: 'get',
      url: '/customer'
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.customers);
    });
  },
  /**
   *
   *
   */
  customerGet : function(customerId, callback) {
    this.performRequest({
      method: 'get',
      url: '/customer/' + customerId
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.customer);
    });
  },
  /**
   *
   *
   */
  customerCreate : function(data, callback) {
    this.performRequest({
      method: 'post',
      url: '/customer',
      body: data
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.customer);
    });
  },
  /**
   * Replace customer data
   * @method PUT
   * @route /customer/:customer
   */
  customerReplace : function(customerId, data, callback) {
    this.performRequest({
      method: 'put',
      url: '/customer/' + customerId,
      body: data 
    }, function(error, body){
      if (error) return callback(error);
      callback(null, body.customer);
    });
  },  
  /**
   * Update customer data
   * @method PATCH
   * @route /customer/:customer
   */
  customerUpdate : function(customerId, data, callback) {
    this.performRequest({
      method: 'patch',
      url: '/customer/' + customerId,
      body: data 
    }, function(error, body){
      if (error) return callback(error);
      callback(null, body.customer);
    });
  },
  /**
   *
   *
   */
  customerRemove : function(customerId, callback) {
    this.performRequest({
      method: 'delete',
      url: '/customer/' + customerId
    }, function(error, body){
      if (error) return callback(error);
      callback(null);
    });
  },
  /**
   *
   *
   */
  userGet : function(id, callback) {
    this.performRequest({
      method: 'get',
      url: '/user/' + customerId
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.user);
    });
  },
  /**
   *
   *
   */
  userFetch : function(query, callback) {
    var filters = {};

    if(query.customer) filters.customer = query.customer;
    if(query.credential) filters.credential = query.credential;

    this.performRequest({
      method: 'get',
      url: '/user',
      qs: filters
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.users);
    });
  },
  /**
   *
   *
   */
  userCreate : function(data, callback) {
    this.performRequest({
      method: 'post',
      url: '/user',
      body: data
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.user);
    });
  },
  /**
   *
   *
   */
  userReplace : function (id, updates, callback) {
    this.performRequest({
      method: 'put',
      url: '/user/' + id,
      body:  updates
    }, function(error, body){
      if (error) return callback(error);
      callback(null, body.user);
    });
  },
  /**
   *
   *
   */
  userUpdate : function (id, updates, callback) {
    var body = {
      'customers' : updates.customers ,
      'credential': updates.credential ,
      'enabled' : updates.enabled
    };

    this.performRequest({
      method: 'patch',
      uri: '/user/' + id,
      body: body 
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body.user);
    });
  },
  /**
   * @author Facundo
   */
  userDelete : function (id, callback) {
    this.performRequest({
      method: 'delete',
      uri: '/user/' + id
    }, function(error, body) {
      if (error) return callback(error);
      callback(null, body);
    });
  }
}

for(var p in prototype) {
  TheEyeClient.prototype[p] = prototype[p];
}
