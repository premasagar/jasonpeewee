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

    // Accepts a params object and a boolean flag for whether the params should
    // be alphanumerically sorted. Returns a URI-encoded query string
    // Does not include a '?' prefix, to allow concatenation of multiple strings
    function encodeURLQueryString(params, sort){
        var queryString = '',
            keys, key, i, len;

        if (sort === true){
            keys = sortedObjectKeys(params);
            for (i=0, len=keys.length; i<len; i++){
                key = keys[i];

                if (i){
                    queryString += '&';
                }
                queryString += encodeParameter(params, key);
            }
        }

        else {
            for (key in params){
                if (params.hasOwnProperty(key)){
                    queryString += encodeParameter(params, key);
                }
            }
        }

        return queryString;
    }

    // Create global master callback and collection of private callbacks
    function createCallbackCollection(callbackName){
        // Create array of private callbacks to the url
        var callbacks = privateCallbacks[callbackName] = [];

        // Create global master callback, which receives data from the remote API
        // and passes that data on to the private callbacks
        masterCallbacks[callbackName] = function(data){
            var len = callbacks.length;

            // Call all callbacks with the data
            // We use a `for` loop, not a `while` loop, in case the callbacks
            // create new callbacks
            for (; len; len--){
                // Remove the first callback in the array, and pass data to it
                callbacks.shift()(data);
            }

            // Free up memory by deleting container
            removeCallbackCollectionIfEmpty(callbackName);
        };
        
        return callbacks;
    }

    function removeCallbackCollectionIfEmpty(callbackName){
        var callbacks = privateCallbacks[callbackName];

        // Only remove if there are no private callbacks remaining
        if (callbacks && !callbacks.length){
            delete privateCallbacks[callbackName];
            delete masterCallbacks[callbackName];
        }
    }

    // Register a private callback, called when a JSONP response calls a global, master callback
    function registerCallback(callbackName, callback){
        var callbacks = privateCallbacks[callbackName] || createCallbackCollection(callbackName);

        callbacks.push(callback);
        return callback;
    }

    function shiftCallback(callbackName){
        var callbacks = privateCallbacks[callbackName];
        return callbacks && callbacks.shift();
    }

    /*
        NOTE: older IE's don't support `onerror` events when <script> elements fail to load; hence the callback may never fire with the error object, and the callback may not be removed from the container.
    */
    function generateErrorHandler(callbackName, errorCallback){
        return function(url){
            // Remove the callback that led to the failed request
            shiftCallback(callbackName);

            // Free up memory by deleting container
            removeCallbackCollectionIfEmpty(callbackName);

            if (errorCallback){
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
    function getscript(url, settings){
        var head = document.head || document.getElementsByTagName('head')[0],
            script = document.createElement('script'),
            active = true;
            
        function cleanup(){
            // Remove circular references to prevent memory leaks in IE
            active = script.onload = script.onreadystatechange = script.onerror = null;
            
            // Remove script element
            head.removeChild(script);
        }

        script.type = 'text/javascript';
        script.charset = settings.charset || 'utf-8';
        script.src = url;
        script.onload = script.onreadystatechange = function(){
            var state = this.readyState;
            if (active && (!state || state === 'complete' || state === 'loaded')){
                cleanup();
            }
        };
        // NOTE: IE8 and below don't fire error events
        script.onerror = function(){
            cleanup();
            settings.error(url);
        };

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
    function jasonpeewee(url, params, callback, settings){
        var callbackParameter = 'callback',
            scriptSettings = {},
            errorCallback, callbackName;

        // If `params` has not been passed
        if (typeof params === 'function'){
            settings = callback;
            callback = params;
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
            if (settings.error){
                errorCallback = settings.error;
            }

            // Set charset for script loading
            if (settings.charset){
                scriptSettings.charset = settings.charset;
            }
        }

        // Check if URL already contains a query string
        url += url.indexOf('?') === -1 ? '?' : '&';

        // Generate query string from settings
        url += params ? encodeURLQueryString(params, true) + '&' : '';

        // Create callbackName from the URL (including params)
        callbackName = makeJSCompatibleName(url);

        // Add jsonp callback parameter
        url += callbackParameter + '=' + jasonpeewee['path'] + '.' + callbackName;

        // TODO?: check localStorage or other cache
        // if no cache, make JSONP request
        // Or trigger event, to allow third-party integration of caching

        registerCallback(callbackName, callback);

        // Error handler to cleanup objects in memory, and call callback if set
        scriptSettings.error = generateErrorHandler(callbackName, errorCallback);

        // Load the script
        getscript(url, scriptSettings);

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

    // Add useful methods
    jasonpeewee['encodeURLQueryString'] = encodeURLQueryString;


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