import { errors } from 'arsenal';

import api from '../api/api';
import routesUtils from '../routes/routesUtils';

/*
* Deals with requests to METADATA bucket to retrieve all of the object
* metadata for a bucket in order to do searches
* @param {object} clientIP - IP address of client
* @param {boolean} deep - true if healthcheck will check backends
* @param {object} req - http request object
* @param {object} res - http response object
* @param {object} log - werelogs logger instance
*/
export default function metadataHandler(req, res, log) {
    // For now on head request just return 200
    // Could add authentication/acl checks later
    if (req.method.toUpperCase() === 'HEAD') {
        return routesUtils.responseNoBody(null, null, res,
            200, log);
    }
    if (req.method.toUpperCase() === 'GET') {
        // NEED TO SUPPORT LISTING SOMEHOW OR JUST CHECK TO MAKE SURE HAVE
        // OBJECT NAME HERE (WHICH WILL BE OUR TARGET BUCKETNAME)
        return api.callApiMethod('getMetadata', req, res, log,
            (err, stream) => {
                if (err) {
                    return routesUtils.responseNoBody(err, null, res,
                        200, log);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                // send stream to response
                stream.on('data', chunk => {
                    // eslint-disable-next-line no-param-reassign
                    chunk.value = JSON.parse(chunk.value);
                    res.write(`${JSON.stringify(chunk)}\n`);
                });
                stream.on('error', () => {
                    log.error('error streaming data from source');
                    return res.end();
                });
                stream.on('end', () => {
                    res.end();
                });
                return undefined;
            });
    }
    return routesUtils.responseNoBody(errors.MethodNotAllowed, null, res,
        200, log);
}
