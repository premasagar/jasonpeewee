/*!
    Jason Peewee
    A cache-friendly JSONP super-assistant

    by Premasagar Rose <http://premasagar.com>,
       Dharmafly <http://dharmafly.com>

    Repo: <https://github.com/dharmafly/jasonpeewee>
    MIT license: http://opensource.org/licenses/mit-license.php

*//*jshint sub:true*/
(function(window){
    'use strict';

    var // settings
        callbacksName = '_jasonpeeweeFn',

        // window properties
        define = window['define'],
        document = window['document'],
        encodeURIComponent = window['encodeURIComponent'],
        objectKeys = window['Object']['keys'],

        // globally exposed container for JSONP callbacks that receive data
        masterCallbacks = {},

        // private container for individual callbacks to be passed data
        privateCallbacks = {},

        makeJSCompatibleName;

    /////

    // Convert any string so that can be used as the name for a JavaScript variable
    makeJSCompatibleName = (function(){
        var nonAlphaRegex = /[^\w\$]+/ig;

        return function(string){
            return string ? string.replace(nonAlphaRegex, '_') : '_';
        };
    }());

    // Object.keys polyfill - returns an array of keys from an object
    if (!objectKeys){
        objectKeys = function(obj){
            var keys = [],
                key;
            
            for (key in obj){
                if (obj.hasOwnProperty(key)){
                    keys.push(key);
                }
            }
            return keys;
        };
    }

    // Returns an alphanumerically sorted array of keys from an object
    function sortedObjectKeys(obj){
        return objectKeys(obj).sort();
    }

    // Accepts a params object and a specified key from the object
    // Returns a URI-encoded query parameter, to be used within a query string
    function encodeParameter(params, key){
        var value = params[key];
        return encodeURIComponent(key) + '=' + encodeURIComponent(value);
    }

    // Accepts a params object, which is first alphanumerically sorted.
    // Returns a URI-encoded query string.
    // Does not include a '?' prefix, to allow concatenation of multiple strings
    function encodeAndSortQueryString(params){
        var keys = sortedObjectKeys(params),
            len = keys.length,
            i = 0,
            queryString = '';

        for (; i<len; i++){
            queryString += '&' + encodeParameter(params, keys[i]);
        }

        // Remove first '&' and return
        return queryString.slice(1);
    }

    // Create global master callback and collection of private callbacks
    function createCollection(callbackName){
        // Create array of private callbacks to the url
        var callbacks = privateCallbacks[callbackName] = [];

        // Create global master callback, which receives data from the remote API
        // and passes that data on to the private callbacks
        masterCallbacks[callbackName] = function(data){
            var len = callbacks.length,
                i = 0;

            // Call all callbacks with the data
            for (; i<len; i++){
                callbacks[i](data);
            }
        };
        
        return callbacks;
    }

    function removeCollection(callbackName){
        delete privateCallbacks[callbackName];
        delete masterCallbacks[callbackName];
    }

    // Register a private callback, called when a JSONP response calls a global, master callback
    function registerCallback(callbackName, callback){
        var callbacks = privateCallbacks[callbackName] || createCollection(callbackName);

        callbacks.push(callback);
        return callback;
    }

    /*
        NOTE: older IE's don't support `onerror` events when <script> elements fail to load; hence the callback may never fire with the error object, and the callback may not be removed from the container.
    */
    function generateScriptCallback(callbackName, errorCallback){
        return function(success, url){
            // Free up memory by deleting container
            removeCollection(callbackName);

            if (!success && errorCallback){
                // Call the error callback with an error object
                errorCallback({
                    error: 'JSONP failed',
                    url: url
                });
            }
        };
    }

    // Load a script into a <script> element
    // Modified from https://github.com/premasagar/cmd.js/tree/master/lib/getscript.js
    function getscript(url, callback, charset){
        var head = document.head || document.getElementsByTagName('head')[0],
            script = document.createElement('script'),
            active = true;
            
        function cleanup(success){
            // Remove circular references to prevent memory leaks in IE
            active = script.onload = script.onreadystatechange = script.onerror = null;
            
            // Remove script element
            head.removeChild(script);

            callback(success === true, url);
        }

        script.type = 'text/javascript';
        script.charset = charset || 'utf-8';
        script.src = url;
        script.onload = script.onreadystatechange = function(){
            var state = this.readyState;
            if (active && (!state || state === 'complete' || state === 'loaded')){
                cleanup(true);
            }
        };
        // NOTE: IE8 and below don't fire error events
        script.onerror = cleanup;
        head.appendChild(script);
    }

    // Make a JSONP request and set up the response handlers
    /*
        - url: the endpoint URL for the remote API, e.g. http://example.com/things
        - params: (optional) an object of query parameter values, e.g.
            {page:6, sort:'alpha'} => http://example.com/things?page=6&sort=alpha
        - callback: a function that is passed the API data, or an error object
        - settings: (optional) an object of settings:
            - callbackParameter: the name of the query parameter that the remote API uses for the name of the JSONP callback function. Usually, this is `callback` and sometimes `jsonpcallback`, e.g.
                http://example.com?apicallback=mycallback
            - charset: (most likely you'll never need this) the value `charset` attribute to be added to the script that loads the JSONP. The remote API server should set the correct charset in its headers. Where it does not, the default value of `utf-8` is used. Where UTF-8 is not the desired charset, you can provide your own here.
    */
    function jasonpeewee(url, params, successCallback, settings){
        var callbackParameter = 'callback',
            charset, loadCallback, errorCallback, callbackName;

        // If `params` has not been passed
        if (typeof params === 'function'){
            settings = successCallback;
            successCallback = params;
            params = null;
        }

        if (settings){
            // Override the default parameter the remote API requires for the
            // callback name. Usually, this is `callback` and sometimes
            // `jsonpcallback`, e.g. http://example.com?callback=foo
            if (settings.callbackParameter){
                callbackParameter = settings.callbackParameter;
            }

            // Error handler - called if the script fails to load
            errorCallback = settings['error'];

            // charset for script loading
            charset = settings['charset'];
        }

        // Check if URL already contains a query string
        url += url.indexOf('?') === -1 ? '?' : '&';

        // Generate query string from settings
        url += params ? encodeAndSortQueryString(params) + '&' : '';

        // Create callbackName from the URL (including params)
        callbackName = makeJSCompatibleName(url);

        // Add jsonp callback parameter
        url += callbackParameter + '=' + jasonpeewee['path'] + '.' + callbackName;

        // TODO?: check localStorage or other cache
        // if no cache, make JSONP request
        // Or trigger event, to allow third-party integration of caching

        registerCallback(callbackName, successCallback);

        // Error handler to cleanup objects in memory, and call optional callback
        loadCallback = generateScriptCallback(callbackName, errorCallback);

        // Load the script
        getscript(url, loadCallback, charset);

        return url;
    }

    /////

    /*
        GLOBAL JSONP CALLBACKS

        The collection of callbacks must be globally accessible, to capture the response from remote APIs. E.g the response from:
            http://example.com?callback=_jasonpeeweeFn.somecallback123

        The collection can be moved somewhere else that is globally accessible. If this is done, then the `jasonpeewee.path` property must be updated to the new location. E.g. jasonpeewee.path = 'myApp.callbacks';
    */
    window[callbacksName] = masterCallbacks;
    jasonpeewee['path'] = callbacksName;


    /////


    // Set up jasonpeewee module
    // Use AMD if available
    if (typeof define === 'function' && define['amd']){
        define([], function(){
            return jasonpeewee;
        });
    }
    // Otherwise, set global module
    else {
        window['jasonpeewee'] = jasonpeewee;
    }

}(this));