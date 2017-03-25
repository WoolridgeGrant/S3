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
    if (req.method.toUpperCase() === 'HEAD') {
        if (!req.objectKey) {
        // For now on bucket head request just return 200
        // Could add authentication/acl checks later
            return routesUtils.responseNoBody(null, null, res,
            200, log);
        }
        // SPARK IS DOING HEAD ON THE OBJECT LIKELY TO GET THE LENGTH SO
        // NEED TO FABRICATE HEAD RESPONSE FOR THE VIRTUAL FILE
        //
        // SPARK IS ALSO DOING A HEAD OBJECT ON METADATA/bucketname/_spark_metadata
        // as well as METADATA/bucketname/_spark_metadata/
        // so send back 404 for both
        //
        // Then does listing of METADATA/?max-keys=1&prefix=bucketname%2F_spark_metadata%2F&delimiter=%2F
        // so should return empty LISTING
        //
        // Then does object head 3 times on the target object METADATA/bucketname so
        // should return what would be the headers of the virtual file object including content length.
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
                res.setHeader('Transfer-Encoding', 'chunked');
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
