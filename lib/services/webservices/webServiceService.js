/*
 * Copyright 2015 Telefonica Investigación y Desarrollo, S.A.U
 *
 * This file is part of fiware-iotagent-lib
 *
 * fiware-iotagent-lib is free software: you can redistribute it and/or
 * modify it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 *
 * fiware-iotagent-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public
 * License along with fiware-iotagent-lib.
 * If not, seehttp://www.gnu.org/licenses/.
 *
 * For those usages not covered by the GNU Affero General Public License
 * please contact with::daniel.moranjimenez@telefonica.com
 *
 * Modified by: Federico M. Facca - Martel Innovate
 * Modified by: Daniel Calvo - ATOS Research & Innovation
 */

'use strict';

var request = require('request'),
    async = require('async'),
    apply = async.apply,
    uuid = require('node-uuid'),
    constants = require('../../constants'),
    domain = require('domain'),
    intoTrans = require('../common/domain').intoTrans,
    alarms = require('../common/alarmManagement'),
    errors = require('../../errors'),
    logger = require('logops'),
    config = require('../../commonConfig'),
    ngsiParser = require('./../ngsi/ngsiParser'),
    registrationUtils = require('../devices/registrationUtils'),
    subscriptions = require('../ngsi/subscriptionService'),
    _ = require('underscore'),
    utils = require('../northBound/restUtils'),
    moment = require('moment'),
    context = {
        op: 'IoTAgentNGSI.WebServiceService'
    };

/**
 * Process the response from a Register Context request for a webservice, extracting the 'registrationId' and creating the
 * webservice object that will be stored in the registry.
 *
 * @param {Object} webServiceData       Object containing all the webServiceData needed to send the registration.
 *
 */
function processContextRegistration(webServiceData, body, callback) {
    var newWebService = _.clone(webServiceData);

    if (body) {
        newWebService.registrationId = body.registrationId;
    }

    callback(null, newWebService);
}



/**
 * Creates the response handler for the initial entity creation request using NGSIv2.
 * This handler basically deals with the errors that could have been rised during
 * the communication with the Context Broker.
 *
 * @param {Object} webServiceData       Object containing all the webServiceData needed to send the registration.
 * @param {Object} newWebService        WebService object that will be stored in the database.
 * @return {function}               Handler to pass to the request() function.
 */
function createInitialEntityHandler(webServiceData, newWebService, callback) {
    return function handleInitialEntityResponse(error, response, body) {
        if (error) {
            logger.error(context,
                'ORION-001: Connection error creating inital entity in the Context Broker: %s', error);

            alarms.raise(constants.ORION_ALARM, error);

            callback(error);
        } else if (response && response.statusCode === 204) {
            alarms.release(constants.ORION_ALARM);
            logger.debug(context, 'Initial entity created successfully.');
            callback(null, newWebService);
        } else {
            var errorObj;

            logger.error(context,
                'Protocol error connecting to the Context Broker [%d]: %s', response.statusCode, body);

            errorObj = new errors.EntityGenericError(webServiceData.id, webServiceData.type, body);

            callback(errorObj);
        }
    };
}

/**
 * Creates the response handler for the update entity request using NGSIv2. This handler basically deals with the errors
 * that could have been rised during the communication with the Context Broker.
 *
 * @param {Object} webServiceData       Object containing all the webServiceData needed to send the registration.
 * @param {Object} updatedWebService    WebService object that will be stored in the database.
 * @return {function}               Handler to pass to the request() function.
 */
function updateEntityHandler(webServiceData, updatedWebService, callback) {
    return function handleEntityResponse(error, response, body) {
        if (error) {
            logger.error(context,
                'ORION-001: Connection error creating inital entity in the Context Broker: %s', error);

            alarms.raise(constants.ORION_ALARM, error);

            callback(error);
        } else if (response && response.statusCode === 204) {
            alarms.release(constants.ORION_ALARM);
            logger.debug(context, 'Entity updated successfully.');
            callback(null, updatedWebService);
        } else {
            var errorObj;

            logger.error(context,
                'Protocol error connecting to the Context Broker [%d]: %s', response.statusCode, body);

            errorObj = new errors.EntityGenericError(webServiceData.id, webServiceData.type, body);

            callback(errorObj);
        }
    };
}

function getInitialValueForType(type) {
    switch (type) {
        case constants.LOCATION_TYPE:
            return constants.LOCATION_DEFAULT;
        case constants.DATETIME_TYPE:
            return constants.DATETIME_DEFAULT;
        default:
            return constants.ATTRIBUTE_DEFAULT;
    }
}

/**
 * Concats or merges two JSON objects.
 *
 * @param  {Object} json1           JSON object where objects will be merged.
 * @param  {Object} json2           JSON object to be merged.
 */
function jsonConcat(json1, json2) {
    for (var key in json2) {
        if (json2.hasOwnProperty(key)) {
            json1[key] = json2[key];
        }
    }
}

/**
 * Formats webservice's attributes in NGSIv2 format.
 *
 * @param  {Object} originalVector  Original vector which contains all the webservice information and attributes.
 * @param  {Object} staticAtts      Flag that defined if the webservice'attributes are static.
 * @return {Object}                 List of webservice's attributes formatted in NGSIv2.
 */
function formatAttributes(originalVector, staticAtts) {
    var attributeList = {};

    if (originalVector && originalVector.length) {
        for (var i = 0; i < originalVector.length; i++) {

            // (#628) check if attribute has entity_name:
            // In that case attribute should not be appear in current entity
            if (!originalVector[i].entity_name) {
                attributeList[originalVector[i].name] = {
                    type: originalVector[i].type,
                    value: getInitialValueForType(originalVector[i].type)
                };

                if (staticAtts) {
                    attributeList[originalVector[i].name].value = originalVector[i].value;
                } else {
                    attributeList[originalVector[i].name].value = getInitialValueForType(originalVector[i].type);
                }
            }

        }
    }

    return attributeList;
}

/**
 * Formats webservice's commands in NGSIv2 format.
 *
 * @param  {Object} originalVector  Original vector which contains all the webservice information and attributes.
 * @return {Object}                 List of webservice's commands formatted in NGSIv2.
 */
function formatCommands(originalVector) {
    var attributeList = {};

    if (originalVector && originalVector.length) {
        for (var i = 0; i < originalVector.length; i++) {
            attributeList[originalVector[i].name + constants.COMMAND_STATUS_SUFIX] = {
                type: constants.COMMAND_STATUS,
                value: 'UNKNOWN'
            };
            attributeList[originalVector[i].name + constants.COMMAND_RESULT_SUFIX] = {
                type: constants.COMMAND_RESULT,
                value: ' '
            };
        }
    }

    return attributeList;
}



/**
 * Updates the entity representing the webservice in the Context Broker using NGSIv2.
 *
 * @param {Object} webServiceData       Object containing all the webServiceData needed to send the registration.
 * @param {Object} updatedWebService    WebService object that will be stored in the database.
 */
function updateEntity(webServiceData, updatedWebService, callback) {
    var options = {
        url: config.getConfig().contextBroker.url + '/v2/entities/' + String(webServiceData.name) + '/attrs',
        method: 'POST',
        json: {
        },
        headers: {
            'fiware-service': webServiceData.service,
            'fiware-servicepath': webServiceData.subservice,
            'fiware-correlator': (domain.active && domain.active.corr) || uuid.v4()
        }
    };

    jsonConcat(options.json, formatAttributes(webServiceData.active, false));
    jsonConcat(options.json, formatAttributes(webServiceData.staticAttributes, true));
    jsonConcat(options.json, formatCommands(webServiceData.commands));

    if (config.getConfig().timestamp && ! utils.isTimestampedNgsi2(options.json)) {
        options.json[constants.TIMESTAMP_ATTRIBUTE] = {
            type: constants.TIMESTAMP_TYPE_NGSI2,
            value: moment()
        };
    }

    logger.debug(context, 'Updating entity in the Context Broker:\n %s', JSON.stringify(options, null, 4));

    request(options, updateEntityHandler(webServiceData, updatedWebService, callback));
}


/**
 * Register a new webservice identified by the Id and Type in the Context Broker, and the internal registry.
 *
 * The webservice id and type are required fields for any registration. The rest of the parameters are optional, but, if
 * they are not present in the function call arguments, the type must be registered in the configuration, so the
 * service can infer their default values from the configured type. If an optional attribute is not given in the
 * parameter list and there isn't a default configuration for the given type, a TypeNotFound error is raised.
 *
 * When an optional parameter is not included in the call, a null value must be given in its place.
 *
 * @param {Object} webserviceObj                    Object with all the webservice information (mandatory).
 */
function registerWebService(webserviceObj, callback) {
    function checkDuplicates(webserviceObj, innerCb) {
        config.getRegistry().get(webserviceObj.id, webserviceObj.service, webserviceObj.subservice, function(error, webservice) {
            if (!error) {
                innerCb(new errors.DuplicateWebServiceId(webserviceObj.id));
            } else {
                innerCb();
            }
        });
    }

    function prepareWebServiceData(webserviceObj, configuration, callback) {
        var webServiceData = _.clone(webserviceObj),
            selectedConfiguration;

        if (!webServiceData.type) {
            if (configuration && configuration.type) {
                webServiceData.type = configuration.type;
            } else {
                webServiceData.type = config.getConfig().defaultType;
            }
        }

        if (!webServiceData.name) {
            webServiceData.name = webServiceData.type + ':' + webServiceData.id;
            logger.debug(context, 'WebService name not found, falling back to webServiceId:type [%s]', webServiceData.name);
        }

        if (!configuration && config.getConfig().types[webServiceData.type]) {
            selectedConfiguration = config.getConfig().types[webServiceData.type];
        } else {
            selectedConfiguration = configuration;
        }

        callback(null, webServiceData, selectedConfiguration);
    }

    function completeRegistrations(error, webServiceData) {
        if (error) {
            return callback(error);
        }

        webserviceObj.name = webServiceData.name;
        webserviceObj.service = webServiceData.service;
        webserviceObj.subservice = webServiceData.subservice;
        webserviceObj.type = webServiceData.type;
        config.getRegistry().store(webserviceObj, callback);
    }

    async.waterfall([
        apply(checkDuplicates, webserviceObj),
        apply(prepareWebServiceData, webserviceObj, callback)
    ], completeRegistrations);
}

function removeAllSubscriptions(webservice, callback) {
    function removeSubscription(subscription, callback) {
        subscriptions.unsubscribe(webservice, subscription.id, callback);
    }

    if (webservice.subscriptions) {
        async.map(webservice.subscriptions, removeSubscription, callback);
    } else {
        callback(null, {});
    }
}

/**
 * Unregister a webservice from the Context broker and the internal registry.
 *
 * @param {String} id           WebService ID of the webservice to register.
 * @param {String} service      Service of the webservice to unregister.
 * @param {String} subservice   Subservice inside the service for the unregisterd webservice.
 */
function unregisterWebService(id, service, subservice, callback) {
    function processContextUnregister(body, innerCallback) {
        innerCallback(null);
    }

    function processUnsubscribes(webservice, innerCallback) {
        innerCallback(null);
    }

    logger.debug(context, 'Removing web service register in Web Service Service');

    config.getRegistry().get(id, service, subservice, function(error, webservice) {
        if (error) {
          callback(error);
        } else {
           
            async.waterfall([
                apply(removeAllSubscriptions, webservice),
                processUnsubscribes,
                apply(registrationUtils.sendRegistrations, true, webservice),
                processContextUnregister,
                apply(config.getRegistry().remove, id, service, subservice)
            ], callback);
        }
    });
}


/**
 * Updates the register of an existing webservice identified by the Id and Type in the Context Broker, and the internal
 * registry. It uses NGSIv2.
 *
 * The webservice id and type are required fields for a registration updated. Only the following attributes will be
 * updated: lazy, active and internalId. Any other change will be ignored. The registration for the lazy attributes
 * of the updated entity will be updated if existing, and created if not. If new active attributes are created,
 * the entity will be updated creating the new attributes.
 *
 * @param {Object} webserviceObj                    Object with all the webservice information (mandatory).
 */
function updateRegisterWebService(webserviceObj, callback) {
    if (!webserviceObj.id || !webserviceObj.type) {
        callback(new errors.MissingAttributes('Id or webservice missing'));
        return;
    }

    logger.debug(context, 'Update provisioned webservice in WebService Service');

    function combineWithNewWebService(newWebService, oldWebService, callback) {
        if (oldWebService) {
            oldWebService.internalId = newWebService.internalId;
            oldWebService.lazy = newWebService.lazy;
            oldWebService.commands = newWebService.commands;
            oldWebService.staticAttributes = newWebService.staticAttributes;
            oldWebService.active = newWebService.active;
            oldWebService.name = newWebService.name;
            oldWebService.type = newWebService.type;
            oldWebService.polling = newWebService.polling;
            oldWebService.timezone = newWebService.timezone;
            oldWebService.endpoint = newWebService.endpoint || oldWebService.endpoint;

            callback(null, oldWebService);
        } else {
            callback(new errors.WebServiceNotFound(newWebService.id));
        }
    }

    function getAttributeDifference(oldArray, newArray) {
        var oldActiveKeys,
            newActiveKeys,
            updateKeys,
            result;

        if (oldArray && newArray) {
            newActiveKeys = _.pluck(newArray, 'name');
            oldActiveKeys = _.pluck(oldArray, 'name');

            updateKeys = _.difference(newActiveKeys, oldActiveKeys);

            result = newArray.filter(function(attribute) {
                return updateKeys.indexOf(attribute.name) >= 0;
            });
        } else if (newArray) {
            result = newArray;
        } else {
            result = [];
        }

        return result;
    }

    function extractWebServiceDifference(newWebService, oldWebService, callback) {
        var webServiceData = {
                id: oldWebService.id,
                name: oldWebService.name,
                type: oldWebService.type,
                service: oldWebService.service,
                subservice: oldWebService.subservice
            };

        webServiceData.active = getAttributeDifference(oldWebService.active, newWebService.active);
        webServiceData.lazy = getAttributeDifference(oldWebService.lazy, newWebService.lazy);
        webServiceData.commands = getAttributeDifference(oldWebService.commands, newWebService.commands);
        webServiceData.staticAttributes = getAttributeDifference(oldWebService.staticAttributes, newWebService.staticAttributes);

        callback(null, webServiceData, oldWebService);
    }

    async.waterfall([
        apply(config.getRegistry().get, webserviceObj.id, webserviceObj.service, webserviceObj.subservice),
        apply(extractWebServiceDifference, webserviceObj),
        updateEntity,
        apply(combineWithNewWebService, webserviceObj),
        apply(registrationUtils.sendRegistrations, false),
        apply(processContextRegistration, webserviceObj),
        config.getRegistry().update
    ], callback);
}


/**
 * Return a list of all the webservices registered in the system. This function can be invoked in three different ways:
 * with just one parameter (the callback) with three parameters (service, subservice and callback) or with five
 * parameters (including limit and offset).
 *
 * @param {String} service      Service for which the webservices are requested.
 * @param {String} subservice   Subservice inside the service for which the webservices are requested.
 * @param {Number} limit        Maximum number of entries to return.
 * @param {Number} offset       Number of entries to skip for pagination.
 */
function listWebServices(service, subservice, limit, offset, callback) {
    if (!callback) {
        if (service && subservice && limit) {
            callback = limit;
        } else if (service) {
            callback = service;
            service = null;
            subservice = null;
        } else {
            logger.fatal(context, 'GENERAL-001: Couldn\'t find callback in listWebServices() call.');
        }
    }

    config.getRegistry().list(service, subservice, limit, offset, callback);
}

/**
 * Retrieve a webservice from the webservice registry.
 *
 * @param {String} webServiceId         ID of the webservice to be found.
 * @param {String} service          Service for which the requested webservice.
 * @param {String} subservice       Subservice inside the service for which the webservice is requested.
 */
function getWebService(webServiceId, service, subservice, callback) {
    config.getRegistry().get(webServiceId, service, subservice, callback);
}

/**
 * Clear all the information in the registry.
 */
function clearRegistry(callback) {
    config.getRegistry().clear(callback);
}

/**
 * Retrieve a webservice from the registry based on its entity name.
 *
 * @param {String} webserviceName       Name of the entity associated to a webservice.
 * @param {String} service          Service the webservice belongs to.
 * @param {String} subservice       Division inside the service.
 */
function getWebServiceByName(webserviceName, service, subservice, callback) {
    config.getRegistry().getByName(webserviceName, service, subservice, callback);
}

/**
 * Retrieve a webservice from the registry based on the value of a given attribute.
 *
 * @param {String} attributeName       Name of the attribute to perform the search with.
 * @param {String} attributeValue      Value of the attribute to perform the selection.
 * @param {String} service             Service the webservice belongs to.
 * @param {String} subservice          Division inside the service.
 */
function getWebServicesByAttribute(attributeName, attributeValue, service, subservice, callback) {
    config.getRegistry().getWebServicesByAttribute(attributeName, attributeValue, service, subservice, callback);
}

/**
 * Wraps a function, throwing an exception if the function is invoked before the registry is initialized.
 *
 * @param {Function} fn                 Original function to wrap.
 * @return {Function}                   Wrapped function.
 */
function checkRegistry(fn) {
    return function() {
        var args = Array.prototype.slice.call(arguments),
            callbacks = args.slice(-1);

        if (config.getRegistry()) {
            fn.apply(null, args);
        } else if (callbacks && callbacks.length === 1 && (typeof callbacks[0] === 'function')) {
            logger.error(context, 'Tried to access webservice information before a registry was available');
            callbacks[0](new errors.RegistryNotAvailable());
        } else {
            logger.error(context, 'Tried to access webservice information without providing a callback');
        }
    };
}


function findOrCreate(webServiceId, group, callback) {
    getWebService(webServiceId, group.service, group.subservice, function(error, webservice) {
        if (!error && webservice) {
            callback(null, webservice, group);
        } else if (error.name === 'WEB_SERVICE_NOT_FOUND') {
            var newWebService = {
                id: webServiceId,
                service: group.service,
                subservice: group.subservice,
                type: group.type
            };

            if (config.getConfig().iotManager && config.getConfig().iotManager.protocol) {
                newWebService.protocol = config.getConfig().iotManager.protocol;
            }

            registerWebService(newWebService, function(error, webservice) {
                callback(error, webservice, group);
            });
        } else {
            callback(error);
        }
    });
}



exports.listWebServices = intoTrans(context, checkRegistry)(listWebServices);
exports.getWebService = intoTrans(context, checkRegistry)(getWebService);
exports.getWebServicesByAttribute = intoTrans(context, checkRegistry)(getWebServicesByAttribute);
exports.getWebServiceByName = intoTrans(context, checkRegistry)(getWebServiceByName);
exports.register = intoTrans(context, registerWebService);
exports.updateRegister = intoTrans(context, updateRegisterWebService);
exports.unregister = intoTrans(context, unregisterWebService);
exports.clearRegistry = intoTrans(context, checkRegistry)(clearRegistry);

