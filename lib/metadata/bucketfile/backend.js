import cluster from 'cluster';

import arsenal from 'arsenal';

import { logger } from '../../utilities/logger';
import BucketInfo from '../BucketInfo';
import constants from '../../../constants';
import config from '../../Config';

const errors = arsenal.errors;
const MetadataServer = arsenal.storage.metadata.server;
const MetadataClient = arsenal.storage.metadata.client;

const METADATA_PORT = 9990;
const METADATA_PATH = `${config.filePaths.metadataPath}/`;
const METASTORE = '__metastore';
const OPTIONS = { sync: true };

class BucketFileInterface {

    constructor() {
        this.logger = logger;
        if (cluster.isMaster) {
            this.mdServer = new MetadataServer(
            { metadataPath: METADATA_PATH,
              metadataPort: METADATA_PORT,
              log: config.log });
            this.mdServer.startServer();
        }
        this.mdClient = new MetadataClient(
            { metadataHost: 'localhost',
              metadataPort: METADATA_PORT,
              log: config.log });
        this.mdDB = this.mdClient.openDB();
        this.metastore = this.mdDB.openSub(METASTORE);
        if (cluster.isMaster) {
            this.setupMetadataServer();
        }
    }

    setupMetadataServer() {
        /* Since the bucket creation API is expecting the
           usersBucket to have attributes, we pre-create the
           usersBucket attributes here */
        this.mdClient.logger.debug('setting up metadata server');
        this.mdDB.openSub(constants.usersBucket);
        const usersBucketAttr = new BucketInfo(constants.usersBucket,
            'admin', 'admin', new Date().toJSON(),
            BucketInfo.currentModelVersion());
        this.metastore.put(
            constants.usersBucket,
            usersBucketAttr.serialize(), err => {
                if (err) {
                    this.logger.error('error writing usersBucket ' +
                                      'attributes to metadata',
                                      { error: err });
                }
            });
    }

    /**
     * Load DB if exists
     * @param {String} bucketName - name of bucket
     * @param {Object} log - logger
     * @param {function} cb - callback(err, db, attr)
     * @return {undefined}
     */
    loadDBIfExists(bucketName, log, cb) {
        this.getBucketAttributes(bucketName, log, (err, attr) => {
            if (err) {
                return cb(err);
            }
            const db = this.mdDB.openSub(bucketName);
            return cb(null, db, attr);
        });
        return undefined;
    }

    createBucket(bucketName, bucketMD, log, cb) {
        this.getBucketAttributes(bucketName, log, err => {
            if (err && err !== errors.NoSuchBucket) {
                return cb(err);
            }
            if (err === undefined) {
                return cb(errors.BucketAlreadyExists);
            }
            try {
                this.mdDB.openSub(bucketName);
            } catch (err) {
                return cb(errors.InternalError);
            }
            this.putBucketAttributes(bucketName,
                                     bucketMD,
                                     log, cb);
            return undefined;
        });
    }

    getBucketAttributes(bucketName, log, cb) {
        this.metastore.get(bucketName, (err, data) => {
            if (err) {
                if (err.notFound) {
                    return cb(errors.NoSuchBucket);
                }
                const logObj = {
                    rawError: err,
                    error: err.message,
                    errorStack: err.stack,
                };
                log.error('error getting db attributes', logObj);
                return cb(errors.InternalError);
            }
            return cb(null, BucketInfo.deSerialize(data));
        });
        return undefined;
    }

    getBucketAndObject(bucketName, objName, params, log, cb) {
        this.loadDBIfExists(bucketName, log, (err, db, bucketAttr) => {
            if (err) {
                return cb(err);
            }
            db.get(objName, (err, objAttr) => {
                if (err) {
                    if (err.notFound) {
                        return cb(null, {
                            bucket: bucketAttr.serialize(),
                        });
                    }
                    const logObj = {
                        rawError: err,
                        error: err.message,
                        errorStack: err.stack,
                    };
                    log.error('error getting object', logObj);
                    return cb(errors.InternalError);
                }
                return cb(null, {
                    bucket: bucketAttr.serialize(),
                    obj: objAttr,
                });
            });
            return undefined;
        });
        return undefined;
    }

    putBucketAttributes(bucketName, bucketMD, log, cb) {
        this.metastore.put(bucketName, bucketMD.serialize(),
                           OPTIONS,
                           err => {
                               if (err) {
                                   const logObj = {
                                       rawError: err,
                                       error: err.message,
                                       errorStack: err.stack,
                                   };
                                   log.error('error putting db attributes',
                                             logObj);
                                   return cb(errors.InternalError);
                               }
                               return cb();
                           });
        return undefined;
    }

    deleteBucket(bucketName, log, cb) {
        this.metastore.del(bucketName,
                           err => {
                               if (err) {
                                   const logObj = {
                                       rawError: err,
                                       error: err.message,
                                       errorStack: err.stack,
                                   };
                                   log.error('error deleting bucket',
                                             logObj);
                                   return cb(errors.InternalError);
                               }
                               return cb();
                           });
        return undefined;
    }

    putObject(bucketName, objName, objVal, params, log, cb) {
        this.loadDBIfExists(bucketName, log, (err, db) => {
            if (err) {
                return cb(err);
            }
            db.put(objName, JSON.stringify(objVal),
                   OPTIONS, err => {
                       // TODO: implement versioning for file backend
                       const data = undefined;
                       if (err) {
                           const logObj = {
                               rawError: err,
                               error: err.message,
                               errorStack: err.stack,
                           };
                           log.error('error putting object',
                                     logObj);
                           return cb(errors.InternalError);
                       }
                       return cb(err, data);
                   });
            return undefined;
        });
    }

    getObject(bucketName, objName, params, log, cb) {
        this.loadDBIfExists(bucketName, log, (err, db) => {
            if (err) {
                return cb(err);
            }
            db.get(objName, (err, data) => {
                if (err) {
                    if (err.notFound) {
                        return cb(errors.NoSuchKey);
                    }
                    const logObj = {
                        rawError: err,
                        error: err.message,
                        errorStack: err.stack,
                    };
                    log.error('error getting object', logObj);
                    return cb(errors.InternalError);
                }
                return cb(null, JSON.parse(data));
            });
            return undefined;
        });
    }

    deleteObject(bucketName, objName, params, log, cb) {
        this.loadDBIfExists(bucketName, log, (err, db) => {
            if (err) {
                return cb(err);
            }
            db.del(objName, OPTIONS, err => {
                if (err) {
                    const logObj = {
                        rawError: err,
                        error: err.message,
                        errorStack: err.stack,
                    };
                    log.error('error deleting object', logObj);
                    return cb(errors.InternalError);
                }
                return cb();
            });
            return undefined;
        });
    }

    /**
     *  This function checks if params have a property name
     *  If there is add it to the finalParams
     *  Else do nothing
     *  @param {String} name - The parameter name
     *  @param {Object} params - The params to search
     *  @param {Object} extParams - The params sent to the extension
     *  @return {undefined}
     */
    addExtensionParam(name, params, extParams) {
        if (params.hasOwnProperty(name)) {
            // eslint-disable-next-line no-param-reassign
            extParams[name] = params[name];
        }
    }

    /**
     * Used for advancing the last character of a string for setting upper/lower
     * bounds
     * For e.g., _setCharAt('demo1') results in 'demo2',
     * _setCharAt('scality') results in 'scalitz'
     * @param {String} str - string to be advanced
     * @return {String} - modified string
     */
    _setCharAt(str) {
        let chr = str.charCodeAt(str.length - 1);
        chr = String.fromCharCode(chr + 1);
        return str.substr(0, str.length - 1) + chr;
    }

    /**
     *  This complex function deals with different extensions of bucket listing:
     *  Delimiter based search or MPU based search.
     *  @param {String} bucketName - The name of the bucket to list
     *  @param {Object} params - The params to search
     *  @param {Object} log - The logger object
     *  @param {function} cb - Callback when done
     *  @return {undefined}
     */
    internalListObject(bucketName, params, log, cb) {
        const requestParams = {};
        let Ext;
        const extParams = {};
        // multipart upload listing
        if (params.listingType === 'multipartuploads') {
            Ext = arsenal.algorithms.list.MPU;
            this.addExtensionParam('queryPrefixLength', params, extParams);
            this.addExtensionParam('splitter', params, extParams);
            if (params.keyMarker) {
                requestParams.gt = `overview${params.splitter}` +
                    `${params.keyMarker}${params.splitter}`;
                if (params.uploadIdMarker) {
                    requestParams.gt += `${params.uploadIdMarker}`;
                }
                // advance so that lower bound does not include the supplied
                // markers
                requestParams.gt = this._setCharAt(requestParams.gt);
            }
        } else {
            Ext = arsenal.algorithms.list.Delimiter;
            if (params.marker) {
                requestParams.gt = params.marker;
                this.addExtensionParam('gt', requestParams, extParams);
            }
        }
        this.addExtensionParam('delimiter', params, extParams);
        this.addExtensionParam('maxKeys', params, extParams);
        if (params.prefix) {
            requestParams.start = params.prefix;
            requestParams.lt = this._setCharAt(params.prefix);
            this.addExtensionParam('start', requestParams, extParams);
        }
        const extension = new Ext(extParams, log);
        this.loadDBIfExists(bucketName, log, (err, db) => {
            if (err) {
                return cb(err);
            }
            let cbDone = false;
            db.createReadStream(requestParams, (err, stream) => {
                if (err) {
                    return cb(err);
                }
                stream
                    .on('data', e => {
                        if (!extension.filter(e)) {
                            stream.emit('end');
                            stream.destroy();
                        }
                    })
                    .on('error', err => {
                        if (!cbDone) {
                            cbDone = true;
                            const logObj = {
                                rawError: err,
                                error: err.message,
                                errorStack: err.stack,
                            };
                            log.error('error listing objects', logObj);
                            cb(errors.InternalError);
                        }
                    })
                    .on('end', () => {
                        if (!cbDone) {
                            cbDone = true;
                            const data = extension.result();
                            cb(null, data);
                        }
                    });
                return undefined;
            });
            return undefined;
        });
    }

    listObject(bucketName, params, log, cb) {
        return this.internalListObject(bucketName, params, log, cb);
    }

    listMultipartUploads(bucketName, params, log, cb) {
        return this.internalListObject(bucketName, params, log, cb);
    }
}

export default BucketFileInterface;
