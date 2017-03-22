import metadata from '../metadata/wrapper';
import services from '../services';


/**
 * getMetadata for all of the objects in a bucket
 * @param {AuthInfo} authInfo - Instance of AuthInfo class with requester's info
 * @param {object} request - http request object
 * @param {object} log - Werelogs logger
 * @param {function} callback - callback to respond to http request
 *  with either error code or stream of metadata
 * @return {undefined}
 */
export default function getMetadata(authInfo, request, log, callback) {
    log.debug('processing request', { method: 'getMetadata' });
    const targetBucket = request.objectKey;
    // CHECK BUCKET ACL'S HERE TO MAKE SURE ACCOUNT AT LEAST HAS RIGHTS
    // ON BUCKET. BUCKET OWNER ONLY ALLOWED?
    const metadataValParams = {
        authInfo,
        bucketName: targetBucket,
        requestType: 'bucketOwnerAction',
        log,
    };
    return services.metadataValidateAuthorization(metadataValParams, err => {
        // note that this callback also gets the bucketmetadata if
        // we want to stream that with the object metadata but would
        // mess up the json schema.
        if (err) {
            log.trace('request authorization failed', {
                error: err,
                method: 'services.metadataValidateAuthorization',
            });
            return callback(err);
        }
        return metadata.getAllObjects(targetBucket, log, (err, stream) => {
            log.trace('error getting stream of metadata', {
                error: err,
                method: 'metadata.getAllObjects',
            });
            return callback(err, stream);
        });
    });
}
