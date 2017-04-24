import { errors } from 'arsenal';

import { markerFilter, prefixFilter } from '../in_memory/bucket_utilities';
import { ListBucketResult } from './ListBucketResult';
import getMultipartUploadListing from '../in_memory/getMultipartUploadListing';
import config from '../../Config';
import async from 'async';
import antidoteClient from 'antidote_ts_client';
import CRC32 from 'crc-32';
import hashring from 'hashring';

var transaction = require('./antidote_transaction');

var uncaught = require('uncaught');
 

const defaultMaxKeys = 1000;

var replacer = function(key, value) {
    if (value === undefined){
        return null;
    }
    return value;
};

var reviver = function(key, value) {
    if (value === null){
        return undefined;
    }
    return value;
};

class AntidoteInterface {

    constructor() {
		this.antidote = [];
		this.parser = [];
		var i = 0;
		this.indice_site = 0;
		this.nb_sites = config.antidote.length;
		this.ring = new hashring([], 'md5', {'max cache size': 10000});
		for(var port in config.antidote){
			if(config.antidote.hasOwnProperty(port)){
				console.log('port is : ' + port + ' machine name is ' + config.antidote[port]);
				this.antidote[i] = antidoteClient.connect(port, config.antidote[port]);
				this.parser["'127.0.0.1:" + port + "'"] = i;
				this.ring.add("'127.0.0.1:" + port + "'");
				i++;
				console.log("Connexion a la machine : " + config.antidote[port]);
			}
		}

		/*
		uncaught.start();
		uncaught.addListener(function (error) {
			console.log('Uncaught error or rejection: ', error.message);
		});
*/
    }

	//Retourne l'indice du site sur lequel modifier ou recuperer les ACL
	/*findACL(bucketName){
		var id = CRC32.str(bucketName);
		id = Math.abs(id);
		var indice_site = id%this.nb_sites;
		console.log("L'indice du site sur lequel il faut modifier/recuperer les ACL est :" + indice_site);
		return indice_site;
	}*/

	//Using consistent hashing
	findACL(bucketName){
		var server = this.ring.get(bucketName);
		return this.parser[server];
	}

	/*Without consistent hashing
	crash_of_antidote_node(node_id){
		//Semaphore ??
		this.nb_sites--;
		if(this.nb_sites <= 0)
			throw new FatalError("No more Antidote node available");
		//Remove connection from connection list
		this.antidote.splice(node_id, 1);
		//close connection ??
	}*/

	//Using consistent hashing
	crash_of_antidote_node(node_id){
		for (var key in this.parser) {
			if(this.parser[key] == node_id){
				this.ring.remove(key);
				console.log("Node " + node_id + "removed from hashring\n");
				return;
			}
		}
	}

    createBucket(bucketName, bucketMD, log, cb) {
		console.log("create bucket\n");
		transaction.startTx();
        this.getBucketAttributes(bucketName, log, (err, bucket) => {
            // TODO Check whether user already owns the bucket,
            // if so return "BucketAlreadyOwnedByYou"
            // If not owned by user, return "BucketAlreadyExists"
            if (bucket) {
				console.log("Case bucket alreadyExists\n");
                return cb(errors.BucketAlreadyExists);
            }
			//Pour l'insertion ca n'a pas d'importance le site sur lequel on insert
            this.antidote[0].defaultBucket = `storage/${bucketName}`;
            let bucket_MD = this.antidote[0].map(`${bucketName}/md`)
            const bucketMap = []
            Object.keys(bucketMD).forEach(key => {
                bucketMap.push(bucket_MD.register(key).set(bucketMD[key]));
            });
            this.antidote[0].update(bucketMap).then( (resp) => {
                return cb();
            });
        });
		transaction.commitTx();
    }

    putBucketAttributes(bucketName, bucketMD, log, cb) {
		console.log("put bucket attributes\n");
		transaction.startTx();
        this.getBucketAttributes(bucketName, log, err => {
            if (err) {
                return cb(err);
            }

			if((bucketName != "users..bucket") && (bucketName != "namespaceusersbucket"))
				this.indice_site = this.findACL(bucketName);

            this.antidote[this.indice_site].defaultBucket = `storage/${bucketName}`;
            let bucket_MD = this.antidote[this.indice_site].map(`${bucketName}/md`)
            const bucketMap = []
            Object.keys(bucketMD).forEach(key => {
                bucketMap.push(bucket_MD.register(key).set(bucketMD[key]))
            });
            this.antidote[this.indice_site].update(
                bucketMap
            ).then( (resp) => {
                return cb();
            });
        });
		transaction.commitTx();
    }

    getBucketAttributes(bucketName, log, cb) {
		console.log("get bucket attributes \n");
		console.log(bucketName + "\n");

		if((bucketName != "users..bucket") && (bucketName != "namespaceusersbucket"))
			this.indice_site = this.findACL(bucketName);

		console.log("indice site : " + this.indice_site + "\n");
        this.antidote[this.indice_site].defaultBucket = `storage/${bucketName}`;
        let bucket_MD = this.antidote[this.indice_site].map(`${bucketName}/md`)
        bucket_MD.read().then(bucketMD => {
            bucketMD = bucketMD.toJsObject();
            if (Object.keys(bucketMD).length === 0) {
                return cb(errors.NoSuchBucket);
            }
            return cb(null, bucketMD);
        }).catch( (err) =>  {
				console.log("promise rejected", err.code);
				if (err.code === 'ECONNREFUSED'){
					this.crash_of_antidote_node(this.indice_site);
				}
		});
    }

	//pas d'importance d'ou l'on supprime le bucket
    deleteBucket(bucketName, log, cb) {
		console.log("delete bucket \n");
        this.getBucketAttributes(bucketName, log, (err, bucket)  => {
            if (err) {
                return cb(err);
            }
            this.antidote[0].defaultBucket = `storage/${bucketName}`;
            let bucket_Objs = this.antidote.set(`${bucketName}/objs`);
            bucket_Objs.read().then(objects => {
                if (bucket && objects.length > 0) {
                    return cb(errors.BucketNotEmpty);
                }
                let bucket_MD = this.antidote[0].map(`${bucketName}/md`)
                bucket_MD.read().then(bucketMD => {
                    bucketMD = bucketMD.toJsObject();
                    const bucketMap = []
                    Object.keys(bucketMD).forEach(key => {
                        bucket_MD.remove(bucket_MD.register(key))
                    });
                    this.antidote[0].update(bucketMap).then( (resp) => {
                        return cb(null);
                    });
                });
            });
        });
    }

    putObject(bucketName, objName, objVal, log, cb) {
		console.log("put Object\n");
		transaction.startTx();
        this.getBucketAttributes(bucketName, log, err => {
            if (err) {
                return cb(err);
            }
                this.antidote[0].defaultBucket = `storage/${bucketName}`;
                let bucket_Objs = this.antidote[0].set(`${bucketName}/objs`);
                let object_MD = this.antidote[0].map(`${objName}`);
                const objMap = []
                Object.keys(objVal).forEach(key => {
                    objMap.push(object_MD.register(key).set(objVal[key]))
                });
                objMap.push(bucket_Objs.add(objName))
                this.antidote[0].update(objMap).then( (resp) => {
                    return cb();
                });
            });
		transaction.commitTx();
    }

    getBucketAndObject(bucketName, objName, log, cb) {
		console.log("get bucket and object \n");
        this.getBucketAttributes(bucketName, log, (err, bucket) => {
            if (err) {
                return cb(err, { bucket });
            }
            const bucket_MD = {}
            Object.keys(bucket).map(function(key) {
                bucket_MD[key.substr(1)] = bucket[key]
            });
			var indice_site = this.findACL(bucketName);
            this.antidote[indice_site].defaultBucket = `storage/${bucketName}`;
            let object_MD = this.antidote[indice_site].map(`${objName}`);
            object_MD.read().then(objectMD => {
                objectMD = objectMD.toJsObject();

                if (!bucket || Object.keys(objectMD).length === 0) {
                    return cb(null, { bucket: JSON.stringify(bucket_MD) });
                }
                return cb(null, {
                    bucket: JSON.stringify(bucket_MD),
                    obj: JSON.stringify(objectMD),
                });
            });
        });
    }

    getObject(bucketName, objName, log, cb) {
		console.log("get object\n");
        this.getBucketAttributes(bucketName, log, (err, bucket) => {
            if (err) {
                return cb(err);
            }
			var indice_site = this.findACL(bucketName);
            this.antidote[indice_site].defaultBucket = `storage/${bucketName}`;
            let object_MD = this.antidote[indice_site].map(`${objName}`);
            object_MD.read().then(objectMD => {
                objectMD = objectMD.toJsObject();
                if (!bucket || Object.keys(objectMD).length === 0) {
                    return cb(errors.NoSuchKey);
                }
                return cb(null, objectMD);
            });
        });
    }

	//Pas d'importance ou on le delete
    deleteObject(bucketName, objName, log, cb) {
        this.getBucketAttributes(bucketName, log, (err, bucket) => {
            if (err) {
                return cb(err);
            }
			
            this.antidote[0].defaultBucket = `storage/${bucketName}`;
            let object_MD = this.antidote[0].map(`${objName}`);
            let bucket_Objs = this.antidote[0].set(`${bucketName}/objs`);
            object_MD.read().then(objectMD => {
                objectMD = objectMD.toJsObject();
                if (!bucket || Object.keys(objectMD).length === 0) {
                    return cb(errors.NoSuchKey);
                }
                const objMap = []
                Object.keys(objectMD).forEach(key => {
                    objMap.push(object_MD.remove(object_MD.register(key)))
                });
                objMap.push(bucket_Objs.remove(objName));
                this.antidote[0].update(objMap).then( (resp) => {
                    return cb();
                });
            });
        });
    }

    getObjectMD(antidote, bucketName, key, callback) {
		antidote.defaultBucket = `storage/${bucketName}`;
        let object_MD = antidote.map(`${key}`);
        object_MD.read().then(objectMD => {
            objectMD = objectMD.toJsObject();
            if (Object.keys(objectMD).length === 0) {
                return callback(error.NoSuchKey, null);
            }
            return callback(null, objectMD);
        });
		/*console.log("get object MD \n");
		var indice_site = this.findACL(bucketName);
	//	var indice_site = 1;
        this.antidote[indice_site].defaultBucket = `storage/${bucketName}`;
        let object_MD = this.antidote[indice_site].map(`${key}`);
        object_MD.read().then(objectMD => {
            objectMD = objectMD.toJsObject();
            if (Object.keys(objectMD).length === 0) {
                return callback(error.NoSuchKey, null);
            }
            return callback(null, objectMD);
        });*/
    }

    listObject(bucketName, params, log, cb) {
		console.log("lib/metadata/antidote/listObject \n")
        const { prefix, marker, delimiter, maxKeys } = params;
        if (prefix && typeof prefix !== 'string') {
            return cb(errors.InvalidArgument);
        }

        if (marker && typeof marker !== 'string') {
            return cb(errors.InvalidArgument);
        }

        if (delimiter && typeof delimiter !== 'string') {
            return cb(errors.InvalidArgument);
        }

        if (maxKeys && typeof maxKeys !== 'number') {
            return cb(errors.InvalidArgument);
        }

        let numKeys = maxKeys;
        // If paramMaxKeys is undefined, the default parameter will set it.
        // However, if it is null, the default parameter will not set it.
        if (numKeys === null) {
            numKeys = defaultMaxKeys;
        }

		var indice_site = this.findACL(bucketName);
		//indice_site = 1;
        this.antidote[indice_site].defaultBucket = `storage/${bucketName}`;
        let bucket_MD = this.antidote[indice_site].map(`${bucketName}/md`)
        bucket_MD.read().then(bucketMD => {
            bucketMD = bucketMD.toJsObject();
            if (Object.keys(bucketMD).length === 0) {
                return cb(errors.NoSuchBucket);
            }
            const response = new ListBucketResult();
			console.log("lecture de l'objet sur le bon site...\n")

			//Lecture de l'objet sur le bon site
            this.antidote[indice_site].defaultBucket = `storage/${bucketName}`;
            let bucket_Objs = this.antidote[indice_site].set(`${bucketName}/objs`);
            bucket_Objs.read().then(keys => {

                async.map(keys, this.getObjectMD.bind(null, this.antidote[indice_site], bucketName), function(err, objectMeta) {

                    // If marker specified, edit the keys array so it
                    // only contains keys that occur alphabetically after the marker
                    if (marker) {
                        keys = markerFilter(marker, keys);
                        response.Marker = marker;
                    }
                    // If prefix specified, edit the keys array so it only
                    // contains keys that contain the prefix
                    if (prefix) {
                        keys = prefixFilter(prefix, keys);
                        response.Prefix = prefix;
                    }
                    // Iterate through keys array and filter keys containing
                    // delimiter into response.CommonPrefixes and filter remaining
                    // keys into response.Contents
                    for (let i = 0; i < keys.length; ++i) {
                        const currentKey = keys[i];
                        // Do not list object with delete markers
                        if (response.hasDeleteMarker(currentKey,
                            objectMeta[i])) {
                            continue;
                        }
                        // If hit numKeys, stop adding keys to response
                        if (response.MaxKeys >= numKeys) {
                            response.IsTruncated = true;
                            response.NextMarker = keys[i - 1];
                            break;
                        }
                        // If a delimiter is specified, find its index in the
                        // current key AFTER THE OCCURRENCE OF THE PREFIX
                        let delimiterIndexAfterPrefix = -1;
                        let prefixLength = 0;
                        if (prefix) {
                            prefixLength = prefix.length;
                        }
                        const currentKeyWithoutPrefix = currentKey
                            .slice(prefixLength);
                        let sliceEnd;
                        if (delimiter) {
                            delimiterIndexAfterPrefix = currentKeyWithoutPrefix
                                .indexOf(delimiter);
                            sliceEnd = delimiterIndexAfterPrefix + prefixLength;
                            response.Delimiter = delimiter;
                        }
                        // If delimiter occurs in current key, add key to
                        // response.CommonPrefixes.
                        // Otherwise add key to response.Contents
                        if (delimiterIndexAfterPrefix > -1) {
                            const keySubstring = currentKey.slice(0, sliceEnd + 1);
                            response.addCommonPrefix(keySubstring);
                        } else {
                            response.addContentsKey(currentKey,
                                objectMeta[i]);
                        }
                    }
                    return cb(null, response);
                });
            });
        }).catch( (err) =>  {
				console.log("promise rejected", err.code);
				if (err.code === 'ECONNREFUSED'){
					this.crash_of_antidote_node(indice_site);
				}
		});
    }

    listMultipartUploads(bucketName, listingParams, log, cb) {
        process.nextTick(() => {
            this.getBucketAttributes(bucketName, log, (err, bucket) => {
                if (bucket === undefined) {
                    // no on going multipart uploads, return empty listing
                    return cb(null, {
                        IsTruncated: false,
                        NextMarker: undefined,
                        MaxKeys: 0,
                    });
                }
                return getMultipartUploadListing(bucket, listingParams, cb);
            });
        });
    }
};

export default AntidoteInterface;
