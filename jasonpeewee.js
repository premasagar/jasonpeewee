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
        head = document.getElementsByTagName('head')[0],

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
            // Remove each callback and pass it the data
            while (callbacks.length){
                callbacks.shift()(data);
            }
        };
        
        return callbacks;
    }

    // Register a private callback, called when a JSONP response calls a global, master callback
    function registerCallback(callbackName, callback){
        var callbacks = privateCallbacks[callbackName] || createCollection(callbackName);

        callbacks.push(callback);
        return callback;
    }

    /*
        NOTE: older IE's don't support `onerror` events when <script> elements fail to load; Firefox (as of v12) doesn't fire error events for local file:/// scripts. Hence the callback may never fire with the error object, and the callback may not be removed from the container.
    */
    // TODO: should master callback use shift to remove callbacks, and any remaining should be passed error responses? that removes specific error callbacks. or, if there are any callbacks in the collection, then call the error callback
    // failing scenario: two calls to same url; first call fails (e.g. server offline) and callbacks deleted, then second call succeeds, but callback already deleted, so won't be called, and errorCallback of second won't be called. At least, this'll only happen if the second call is made in after the first call is made and before the first call returns.
    function generateScriptCallback(callbackName, errorCallback){
        return function(success, url){
            var callbacks = privateCallbacks[callbackName],
                callbackRemaining;

            if (callbacks){
                // Remove the successCallback, if it exists
                // In the case of a loaded, successful response, there will be no
                // remaining callbacks
                callbackRemaining = callbacks.shift();

                // Free up memory by deleting callbacks collection if empty
                if (!callbacks.length){
                    delete privateCallbacks[callbackName];
                    delete masterCallbacks[callbackName];
                }
            }

            // If the response loaded, but there is a callback still remaining,
            // then most likely the response was not valid JSONP.
            // If the response failed to load, and there is no callback remaining,
            // then there's no need to call the errorCallback; as it looks like the
            // success callback was already called, e.g. as part of a previously
            // successful response.
            if (errorCallback && callbackRemaining){
                errorCallback(url);
            }
        };
    }

    // Load a script into a <script> element
    // Modified from https://github.com/premasagar/cmd.js/tree/master/lib/getscript.js
    function getscript(url, callback, charset){
        var script = head.appendChild(document.createElement('script'));
            
        function cleanup(success){
            // Remove script element
            head.removeChild(script);

            // Remove circular references to prevent memory leaks in IE
            script = script.onload = script.onreadystatechange = script.onerror = null;

            callback(success === true, url);
        }

        script.onload = script.onreadystatechange = function(){
            var state = this.readyState;
            if (script && (!state || state === 'complete' || state === 'loaded')){
                cleanup(true);
            }
        };
        // NOTE: IE8 and below don't fire error events; Firefox (as of v12) doesn't fire error events for local file:/// scripts.
        script.onerror = cleanup;

        script.type = 'text/javascript';
        script.charset = charset || 'utf-8';
        script.src = url;
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