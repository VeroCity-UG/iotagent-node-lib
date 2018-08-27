/*
 * Copyright 2014 Telefonica Investigación y Desarrollo, S.A.U
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
 */


var async = require('async');
var restUtils = require('./restUtils');
var statsRegistry = require('./../stats/statsRegistry');
var webServiceService = require('./../webServices/webServiceService');
var intoTrans = require('../common/domain').intoTrans;
var logger = require('logops');
var errors = require('../../errors');
var _ = require('underscore');
var context = {
        op: 'IoTAgentNGSI.WebServiceProvisioning'
    };
var apply = async.apply;
var provisioningHandler;
var updateWebServiceTemplate = require('../../templates/updateWebService.json');
var createWebServiceTemplate = require('../../templates/createWebService.json');
var mandatoryHeaders = [
        'fiware-service',
        'fiware-servicepath'
    ];
var provisioningMiddlewares = [];
var provisioningAPITranslation = {
        /* jshint camelcase:false */

        name: 'id',
        service: 'service',
        service_path: 'subservice',
        entity_name: 'name',
        entity_type: 'type',
        timezone: 'timezone',
        entity_id_prefix: 'prefix',
        entity_id_expression: 'expression',
        endpoint: 'endpoint',
        attributes: 'active',
        commands: 'commands',
        lazy: 'lazy',
        static_attributes: 'staticAttributes'
    };

/**
 * Express middleware to handle incoming webService provisioning requests. Every request is validated and handled to the
 * NGSI Service for the registration.
 */
function handleProvision(req, res, next) {

    function handleProvisioningFinish(error, results) {
        if (error) {
            logger.debug(context, 'Webservice provisioning failed due to the following error: ', error.message);
            next(error);
        } else {
            logger.debug(context, 'Webservice provisioning request succeeded');
            res.status(201).json({});
        }
    }

    function applyProvisioningHandler(webService, callback) {
        logger.debug(context,'applyProvisioningHandler' );
        if (provisioningHandler) {
            provisioningHandler(webService, callback);
        } else {
            callback(null, webService);
        }
    }

    function applyProvisioningMiddlewares(webService, callback) {
        logger.debug(context,'applyProvisioningMiddlewares' );

        if (provisioningMiddlewares.length > 0) {
            const firstMiddleware = provisioningMiddlewares.slice(0, 1)[0];
            const rest = provisioningMiddlewares.slice(1);
            let executingMiddlewares = [apply(firstMiddleware, webService)];

            executingMiddlewares = executingMiddlewares.concat(rest);

            async.waterfall(executingMiddlewares, callback);
        } else {
            callback(null, webService);
        }
    }

    function fillWebServiceData(service, subservice, body, callback) {
        /* jshint sub: true */
        logger.debug(context,'fillWebServiceData' + JSON.stringify(body));

        callback(null, {
            id: body.web_service_id,
            type: body.entity_type,
            prefix: body.entity_id_prefix || '',
            expression: body.entity_id_expression,
            service,
            subservice,
            active: body.attributes,
            staticAttributes: body.static_attributes,
            lazy: body.lazy,
            commands: body.commands,
            timezone: body.timezone,
            endpoint: body.endpoint
        });
    }

    function provisionWebService(webService, callback) {
        async.waterfall([
            apply(statsRegistry.add, 'webServiceCreationRequests', 1),
            apply(restUtils.checkMandatoryQueryParams,
                ['web_service_id'], webService),
            apply(fillWebServiceData, req.headers['fiware-service'], req.headers['fiware-servicepath']),
            applyProvisioningMiddlewares,
            applyProvisioningHandler,
            webServiceService.register
        ], callback);
    }

    function extractWebservices() {
        return req.body.services;
    }

    logger.debug(context, 'Handling webService provisioning request.');

    async.map(extractWebservices(), provisionWebService, handleProvisioningFinish);
}

/**
 * Translate an attribute from the internal representaiton format to the one required by the Provisioning API.
 *
 * @param {Object} attribute                        Attribute in internal representation format.
 * @return {{object_id: *, name: *, type: *}}      Attribute in Web Service Provisioning API format.
 */
function attributeToProvisioningAPIFormat(attribute) {
    return {
        object_id: attribute.object_id,
        name: attribute.name,
        type: attribute.type,
        expression: attribute.expression,
        reverse: attribute.reverse,
        entity_name: attribute.entity_name,
        entity_type: attribute.entity_type
    };
}

/**
 * Translate between the inner model format to the external Web Service Provisioning API one.
 *
 * @param {Object} webService           Web Service object coming from the registry.
 * @return {Object}                 Web Service object translated to Web Service Provisioning API format.
 */
function toProvisioningAPIFormat(webService) {
    /* jshint camelcase:false */
    return {
        web_service_id: webService.id,
        service: webService.service,
        service_path: webService.subservice,
        entity_name: webService.name,
        entity_type: webService.type,
        entity_id_prefix: webService.prefix,
        entity_id_expression : webService.expression,
        timezone: webService.timezone,
        endpoint: webService.endpoint,
        attributes: (webService.active) ? webService.active.map(attributeToProvisioningAPIFormat) : undefined,
        lazy: (webService.lazy) ? webService.lazy.map(attributeToProvisioningAPIFormat) : undefined,
        commands: (webService.commands) ? webService.commands.map(attributeToProvisioningAPIFormat) : undefined,
        static_attributes: webService.staticAttributes
    };
}

/**
 * Express middleware that retrieves the complete set of provisioned web services (in JSON format).
 */
function handleListWebServices(req, res, next) {
    webServiceService.listWebServices(
        req.headers['fiware-service'],
        req.headers['fiware-servicepath'],
        req.query.limit,
        req.query.offset,
        function handleListWebServices(error, webServiceList) {
            if (error) {
                next(error);
            } else {
                const response = webServiceList;
                response.webServices = webServiceList.webServices.map(toProvisioningAPIFormat);

                res.status(200).json(response);
            }
        });
}

/**
 * This middleware gets the web service specified in the webServiceId parameter of the URL from the registry and returns it in
 * JSON format.
 */
function handleGetWebService(req, res, next) {
    webServiceService.getWebService(req.params.webServiceId, req.headers['fiware-service'], req.headers['fiware-servicepath'],
        function(error, webService) {
            if (error) {
                next(error);
            } else if (webService) {
                res.status(200).json(toProvisioningAPIFormat(webService));
            } else {
                next(new errors.WebServiceNotFound(req.params.webServiceId));
            }
        });
}

/**
 * This middleware handles the removal of a particular web service specified with the webServiceId.
 */
function handleRemoveWebService(req, res, next) {
    statsRegistry.add('webServiceRemovalRequests', 1, function() {
        webServiceService.unregister(req.params.webServiceId, req.headers['fiware-service'], req.headers['fiware-servicepath'],
            function(error) {
                if (error && error.code !== 404) {
                    next(error);
                } else if (error && error.code === 404) {
                    next(new errors.WebServiceNotFound(req.params.webServiceId));
                } else {
                    res.status(204).send();
                }
            });
    });
}

/**
 * This middleware handles updates in the provisioning webServices. The only attribute
 */
function handleUpdateWebService(req, res, next) {
    if (req.body.webServiceId) {
        next(new errors.BadRequest('Can\'t change the ID of a preprovisioned web service'));
    } else {
        webServiceService.getWebService(req.params.webServiceId, req.headers['fiware-service'], req.headers['fiware-servicepath'],
            function(error, webService) {
                if (error) {
                    next(error);
                } else if (webService) {
                    let pairs = _.pairs(req.body),
                        newWebService = _.clone(webService);

                    for (const i in pairs) {
                        newWebService[provisioningAPITranslation[pairs[i][0]]] = pairs[i][1];
                    }

                    webServiceService.updateRegister(newWebService, function handleWebServiceUpdate(error) {
                        if (error) {
                            next(error);
                        } else {
                            res.status(204).json({});
                        }
                    });
                } else {
                    next(new errors.WebServiceNotFound(req.params.webServiceId));
                }
            });
    }
}

/**
 * Load the routes related to webService provisioning in the Express App.
 *
 * @param {Object} router      Express request router object.
 */
function loadContextRoutes(router) {
    router.post('/web/services',
        restUtils.checkRequestAttributes('headers', mandatoryHeaders),
        restUtils.checkBody(createWebServiceTemplate),
        handleProvision
    );

    router.get('/web/services',
        restUtils.checkRequestAttributes('headers', mandatoryHeaders),
        handleListWebServices
    );

    router.get('/web/services/:webServiceId',
        restUtils.checkRequestAttributes('headers', mandatoryHeaders),
        handleGetWebService
    );

    router.put('/web/services/:webServiceId',
        restUtils.checkRequestAttributes('headers', mandatoryHeaders),
        restUtils.checkBody(updateWebServiceTemplate),
        handleUpdateWebService
    );

    router.delete('/web/services/:webServiceId',
        restUtils.checkRequestAttributes('headers', mandatoryHeaders),
        handleRemoveWebService
    );
}

function setProvisioningHandler(newHandler) {
    provisioningHandler = newHandler;
}

function addWebServiceProvisionMiddleware(newHandler) {
    provisioningMiddlewares.push(newHandler);
}

function clear(callback) {
    provisioningMiddlewares = [];
    provisioningHandler = null;
    callback();
}

exports.loadContextRoutes = intoTrans(context, loadContextRoutes);
exports.setProvisioningHandler = intoTrans(context, setProvisioningHandler);
exports.addWebServiceProvisionMiddleware = addWebServiceProvisionMiddleware;
exports.clear = clear;
