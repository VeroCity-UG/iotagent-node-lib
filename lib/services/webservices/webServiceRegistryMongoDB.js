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

var logger = require('logops'),
    dbService = require('../../model/dbConn'),
    fillService = require('./../common/domain').fillService,
    alarmsInt = require('../common/alarmManagement').intercept,
    errors = require('../../errors'),
    constants = require('../../constants'),
    WebService = require('../../model/WebService'),
    async = require('async'),
    context = {
        op: 'IoTAgentNGSI.MongoDBWebServiceRegister'
    };

/**
 * Generates a handler for the save webservice operations. The handler will take the customary error and the saved webservice
 * as the parameters (and pass the serialized DAO as the callback value).
 *
 * @return {Function}       The generated handler.
 */
function saveWebServiceHandler(callback) {
    return function saveHandler(error, webserviceDAO) {
        if (error) {
            logger.debug(fillService(context, webserviceDAO), 'Error storing webservice information: %s', error);

            callback(new errors.InternalDbError(error));
        } else {
            callback(null, webserviceDAO.toObject());
        }
    };
}

/**
 * Create a new register for a webservice. The webservice object should contain the id, type and registrationId
 *
 * @param {Object} newWebService           WebService object to be stored
 */
function storeWebService(newWebService, callback) {
    var webserviceObj = new WebService.model(),
        attributeList = ['id', 'type', 'name', 'prefix', 'service', 'subservice', 'lazy', 'commands', 'staticAttributes',
            'active',  'endpoint'];

    for (var i = 0; i < attributeList.length; i++) {
        webserviceObj[attributeList[i]] = newWebService[attributeList[i]];
    }

    logger.debug(context, 'Storing webservice with id [%s] and type [%s]', newWebService.id, newWebService.type);

    webserviceObj.save(function saveHandler(error, webserviceDAO) {
        if (error) {
            if (error.code === 11000) {
                logger.debug(context, 'Tried to insert a webservice with duplicate ID in the database: %s', error);

                callback(new errors.DuplicateWebServiceId(newWebService.id));
            } else {
                logger.debug(context, 'Error storing webservice information: %s', error);

                callback(new errors.InternalDbError(error));
            }
        } else {
            callback(null, webserviceDAO.toObject());
        }
    });
}

/**
 * Remove the webservice identified by its id and service.
 *
 * @param {String} id           WebService ID of the webservice to remove.
 * @param {String} service      Service of the webservice to remove.
 * @param {String} subservice   Subservice inside the service for the removed webservice.
 */
function removeWebService(id, service, subservice, callback) {
    var condition = {
        id: id,
        service: service,
        subservice: subservice
    };

    logger.debug(context, 'Removing webservice with id [%s]', id);

    WebService.model.remove(condition, function(error) {
        if (error) {
            logger.debug(context, 'Internal MongoDB Error getting webservice: %s', error);

            callback(new errors.InternalDbError(error));
        } else {
            logger.debug(context, 'WebService [%s] successfully removed.', id);

            callback(null);
        }
    });
}

/**
 * Return the list of currently registered webservices (via callback).
 *
 * @param {String} service      Service for which the webservices are requested.
 * @param {String} subservice   Subservice inside the service for which the webservices are requested.
 * @param {Number} limit        Maximum number of entries to return.
 * @param {Number} offset       Number of entries to skip for pagination.
 */
function listWebServices(service, subservice, limit, offset, callback) {
    var condition = {},
        query;

    if (service) {
        condition.service = service;
    }

    if (subservice) {
        condition.subservice = subservice;
    }

    query = WebService.model.find(condition).sort();

    if (limit) {
        query.limit(parseInt(limit, 10));
    }

    if (offset) {
        query.skip(parseInt(offset, 10));
    }

    async.series([
        query.exec.bind(query),
        WebService.model.count.bind(WebService.model, condition)
    ], function(error, results) {
        callback(error, {
            count: results[1],
            webServices: results[0]
        });
    });
}

/**
 * Internal function used to find a webservice in the DB.
 *
 * @param {String} id           ID of the WebService to find.
 * @param {String} service      Service the webservice belongs to (optional).
 * @param {String} subservice   Division inside the service (optional).
 */
function getWebServiceById(id, service, subservice, callback) {
    var query,
        queryParams = {
            id: id,
            service: service,
            subservice: subservice
        };

    logger.debug(context, 'Looking for webservice with id [%s].', id);

    query = WebService.model.findOne(queryParams);
    query.select({__v: 0});

    query.exec(function handleGet(error, data) {
        if (error) {
            logger.debug(context, 'Internal MongoDB Error getting webservice: %s', error);

            callback(new errors.InternalDbError(error));
        } else if (data) {
            callback(null, data);
        } else {
            logger.debug(context, 'WebService [%s] not found.', id);

            callback(new errors.WebServiceNotFound(id));
        }
    });
}

/**
 * Retrieves a webservice using it ID, converting it to a plain Object before calling the callback.
 *
 * @param {String} id           ID of the WebService to find.
 * @param {String} service      Service the webservice belongs to.
 * @param {String} subservice   Division inside the service.
 */
function getWebService(id, service, subservice, callback) {

    getWebServiceById(id, service, subservice, function(error, data) {
        if (error) {
            callback(error);
        } else {
            callback(null, data.toObject());
        }
    });
}

function getByName(name, service, servicepath, callback) {
    var query;

    logger.debug(context, 'Looking for webservice with name [%s].', name);

    query = WebService.model.findOne({
        name: name,
        service: service,
        subservice: servicepath
    });

    query.select({__v: 0});

    query.exec(function handleGet(error, data) {
        if (error) {
            logger.debug(context, 'Internal MongoDB Error getting webservice: %s', error);

            callback(new errors.InternalDbError(error));
        } else if (data) {
            callback(null, data.toObject());
        } else {
            logger.debug(context, 'WebService [%s] not found.', name);

            callback(new errors.WebServiceNotFound(name));
        }
    });
}

/**
 * Updates the given webservice into the database. Only the following attributes: lazy, active and internalId will be
 * updated.
 *
 * @param {Object} webservice       WebService object with the new values to write.
 */
function update(webservice, callback) {
    getWebServiceById(webservice.id, webservice.service, webservice.subservice, function(error, data) {
        if (error) {
            callback(error);
        } else {
            data.lazy = webservice.lazy;
            data.active = webservice.active;
            data.staticAttributes = webservice.staticAttributes;
            data.commands = webservice.commands;
            data.endpoint = webservice.endpoint;
            data.name = webservice.name;
            data.type = webservice.type;
            data.prefix = webservice.prefix;
            data.save(saveWebServiceHandler(callback));
        }
    });
}

/**
 * Cleans all the information in the database, leaving it in a clean state.
 */
function clear(callback) {
    dbService.db.db.dropDatabase(callback);
}

function itemToObject(i) {
    if (i.toObject) {
        return i.toObject();
    } else {
        return i;
    }
}

function getWebServicesByAttribute(name, value, service, subservice, callback) {
    var query,
        filter = {};

    if (service) {
        filter.service = service;
    }

    if (subservice) {
        filter.subservice = subservice;
    }

    filter[name] = value;

    logger.debug(context, 'Looking for webservice with filter [%j].', filter);

    query = WebService.model.find(filter);
    query.select({__v: 0});

    query.exec(function handleGet(error, webservices) {
        if (error) {
            logger.debug(context, 'Internal MongoDB Error getting webservice: %s', error);

            callback(new errors.InternalDbError(error));
        } else if (webservices) {
            callback(null, webservices.map(itemToObject));
        } else {
            logger.debug(context, 'WebService [%s] not found.', name);

            callback(new errors.WebServiceNotFound(name));
        }
    });
}

exports.getWebServicesByAttribute = alarmsInt(constants.MONGO_ALARM, getWebServicesByAttribute);
exports.store = alarmsInt(constants.MONGO_ALARM, storeWebService);
exports.update = alarmsInt(constants.MONGO_ALARM, update);
exports.remove = alarmsInt(constants.MONGO_ALARM, removeWebService);
exports.list = alarmsInt(constants.MONGO_ALARM, listWebServices);
exports.get = alarmsInt(constants.MONGO_ALARM, getWebService);
exports.getByName = alarmsInt(constants.MONGO_ALARM, getByName);
exports.clear = alarmsInt(constants.MONGO_ALARM, clear);
