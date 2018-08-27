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

var registeredWebServices = {},
    logger = require('logops'),
    errors = require('../../errors'),
    _ = require('underscore'),
    context = {
        op: 'IoTAgentNGSI.InMemoryWebServiceRegister'
    };

function deepClone(webservice) {
    var initialClone = _.clone(webservice);

    for (var i in webservice) {
        if (webservice.hasOwnProperty(i) && Array.isArray(webservice[i])) {
            initialClone[i] = webservice[i].map(_.clone);
        }
    }

    return initialClone;
}

/**
 * Create a new register for a webservice. The webservice object should contain the id, type and registrationId
 *
 * @param {Object} newWebService           WebService object to be stored
 */
function storeWebService(newWebService, callback) {
    if (!registeredWebServices[newWebService.service]) {
        registeredWebServices[newWebService.service] = {};
    }

    if (registeredWebServices[newWebService.service][newWebService.id]) {
        callback(new errors.DuplicateWebServiceId(newWebService.id));
    } else {
        registeredWebServices[newWebService.service][newWebService.id] = deepClone(newWebService);
        registeredWebServices[newWebService.service][newWebService.id].creationDate = Date.now();

        logger.debug(context, 'Storing webservice with id [%s] and type [%s]', newWebService.id, newWebService.type);
        callback(null, newWebService);
    }
}

/**
 * Remove the webservice identified by its id and service.
 *
 * @param {String} id           WebService ID of the webservice to remove.
 * @param {String} service      Service of the webservice to remove.
 * @param {String} subservice   Subservice inside the service for the removed webservice.
 */
function removeWebService(id, service, subservice, callback) {
    var services = Object.keys(registeredWebServices);

    for (var i = 0; i < services.length; i++) {
        if (registeredWebServices[services[i]][id]) {
            logger.debug(context, 'Removing webservice with id [%s] from service [%s].', id, services[i]);
            delete registeredWebServices[services[i]][id];
        }
    }

    callback(null);
}

/**
 * Function to filter all the webservices belonging to a service and subservice.
 *
 * @param {String} service      Service name to use in the filtering.
 * @param {String} subservice   Subservice name to use in the filtering.
 * @return {Function}           List of all the webservices belonging to the given service and subservice.
 */
function getWebServicesByService(service, subservice) {
    if (registeredWebServices[service]) {
        return Object.keys(registeredWebServices[service]).filter(function filterByService(item) {
            if (subservice) {
                return registeredWebServices[service][item].subservice === subservice;
            } else {
                return true;
            }
        });
    } else {
        return [];
    }
}

/**
 * Return the list of currently registered webservices (via callback).
 *
 * @param {String} service      Service for which the entries will be returned.
 * @param {String} subservice   Subservice for which the entries will be listed.
 * @param {Number} limit        Maximum number of entries to return.
 * @param {Number} offset       Number of entries to skip for pagination.
 */
function listWebServices(service, subservice, limit, offset, callback) {
    var result = [],
        skipped = 0,
        webserviceList = getWebServicesByService(service, subservice);

    for (var i in webserviceList) {
        if (registeredWebServices[service].hasOwnProperty(webserviceList[i])) {
            if (offset && skipped < parseInt(offset, 10)) {
                skipped++;
            } else {
                result.push(registeredWebServices[service][webserviceList[i]]);
            }

            if (limit && result.length === parseInt(limit, 10)) {
                break;
            }
        }
    }

    callback(null, {
        count: webserviceList.length,
        webservices: result
    });
}

function getWebService(id, service, subservice, callback) {
    if (registeredWebServices[service] && registeredWebServices[service][id]) {
        callback(null, registeredWebServices[service][id]);
    } else {
        callback(new errors.WebServiceNotFound(id));
    }
}

function getByName(name, service, subservice, callback) {
    var webservices = _.values(registeredWebServices[service]),
        webservice;

    for (var i = 0; i < webservices.length; i++) {
        if (webservices[i].name === name) {
            webservice = webservices[i];
        }
    }

    if (webservice) {
        callback(null, webservice);
    } else {
        callback(new errors.WebServiceNotFound(name));
    }
}

function update(webservice, callback) {
    registeredWebServices[webservice.service][webservice.id] = deepClone(webservice);
    callback(null, webservice);
}

function clear(callback) {
    registeredWebServices = {};

    callback();
}

function getWebServicesByAttribute(name, value, service, subservice, callback) {
    var webservices,
        resultWebServices = [];

    if (service) {
        webservices = _.values(registeredWebServices[service]);
    } else {
        webservices = _.flatten(_.values(registeredWebServices).map(_.values));
    }

    for (var i = 0; i < webservices.length; i++) {
        if (webservices[i][name] === value) {
            resultWebServices.push(webservices[i]);
        }
    }

    if (resultWebServices.length > 0) {
        callback(null, resultWebServices);
    } else {
        callback(new errors.WebServiceNotFound(''));
    }
}

exports.getWebServicesByAttribute = getWebServicesByAttribute;
exports.store = storeWebService;
exports.update = update;
exports.remove = removeWebService;
exports.list = listWebServices;
exports.get = getWebService;
exports.getByName = getByName;
exports.clear = clear;
