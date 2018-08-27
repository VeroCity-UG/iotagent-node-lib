const _ = require('underscore');
const request = require('request-promise');
const config = require('../commonConfig');
const utils = require('./pluginUtils');
const logger = require('logops');
const context = {
    op: 'IoTAgentNGSI.webserviceProcessPlugin'
};


function replaceExpressions (val, key) {
	if (val instanceof Object){
		if(val.expression){
			val.value= val.expression;
			delete val.expression;
		}
		return _.mapObject(val, replaceExpressions.bind(this));
	}
	const placeholders =  val.match(/\$\{.*?\}/g) || [];
	for (let i = 0; i < placeholders.length; i++) {
		const expression = placeholders[i].substr(3, placeholders[i].length - 4);
		val  = val.replace(placeholders[i], 
			clean (this[expression] || this.parent()[expression]));
	}
	return (key === 'coordinates') ? coordsToArray(val) : val;
}

function coordsToArray(coordsString){
	coords = coordsString.split(',');
	return [parseFloat(coords[0]), parseFloat(coords[1])];
}

 
 
function webServiceToNGSI(items, webService){
	const entities = [];

	_.forEach(items, item => {

		let entity = {
		 	'id': webService.prefix + webService.expression,
        	'type': webService.type
    	};

		_.forEach(webService.active, attr => {
			entity[attr.name] = {type: attr['type']};
			if (attr['value'] ){
				entity[attr.name].value = attr['value'];
			} else if (attr['object_id'] ){
				entity[attr.name].value = clean (item[attr['object_id']] || item.parent()[attr['object_id']]);
			} else {
				entity[attr.name].value = attr['expression'];
			}
		});
		_.forEach(webService.staticAttributes, attr => {
			entity[attr.name] = { 
       			type: attr['type'],
       			value: attr['value'] 
       		}
		});
	
		entity = _.mapObject(entity, replaceExpressions.bind(item));
		entities.push(entity);
  });
  return entities;
}


function sendEnities (entities, webService){
 
  const payload = {
     "actionType":"append",
     "entities": entities
  }

  const options = { method: 'POST',
    url: config.getConfig().contextBroker.url  + '/v2/op/update/',
    headers: { 
      'Content-Type': 'application/json',
      'fiware-servicepath': webService.subservice,
      'fiware-service': webService.service},
    body: payload,
    json: true 
  };

 request(options,  error  => {
    if (error) { 
      logger.error(context, error);
    }
  });

}


function initWebEntities(webService, preprocess, callback) {
     logger.debug(context,'initWebEntities');

    request({
        url: webService.endpoint,
        method: 'GET',
    })
    .then(result => {
        const items = JSON.parse(result)|| {};
        const arr =  preprocess ? preprocess(items) : items;
        const entities = webServiceToNGSI(arr, webService);
        sendEnities (entities, webService);
        callback(null, webService);
    })
    .error (err => {
        logger.error(context,  err);
        callback(err)
    });
}

function clean(value){
  return value.toString().replace(/[<>"'=;()?/%&]/g, '');
}


exports.initWebEntities = initWebEntities;