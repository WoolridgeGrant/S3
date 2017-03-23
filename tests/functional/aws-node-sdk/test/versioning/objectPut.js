import assert from 'assert';
import { S3 } from 'aws-sdk';
import async from 'async';
import {
    removeAllVersions,
    constants,
} from '../../lib/utility/versioning-util.js';

import getConfig from '../support/config';

const config = getConfig('default', { signatureVersion: 'v4' });
const s3 = new S3(config);
const data = ['foo1', 'foo2'];
const counter = 100;
let bucket;
const key = '/';

function _assertNoError(err, desc) {
    assert.strictEqual(err, null, `Unexpected err ${desc}: ${err}`);
}

const testing = process.env.VERSIONING === 'no' ? describe.skip : describe;

testing('put and get object with versioning', function testSuite() {
    this.timeout(600000);

    beforeEach(done => {
        bucket = `versioning-bucket-${Date.now()}`;
        s3.createBucket({ Bucket: bucket }, done);
    });

    afterEach(done => {
        removeAllVersions({ Bucket: bucket }, err => {
            if (err) {
                return done(err);
            }
            return s3.deleteBucket({ Bucket: bucket }, done);
        });
    });

    it('should put and get a non-versioned object without including ' +
    'version ids in response headers', done => {
        const params = { Bucket: bucket, Key: key };
        s3.putObject(params, (err, data) => {
            _assertNoError(err, 'putting object');
            assert.strictEqual(data.VersionId, undefined);
            s3.getObject(params, (err, data) => {
                _assertNoError(err, 'getting object');
                assert.strictEqual(data.VersionId, undefined);
                done();
            });
        });
    });

    it('version-specific get should still not return version id in ' +
    'response header', done => {
        const params = { Bucket: bucket, Key: key };
        s3.putObject(params, (err, data) => {
            _assertNoError(err, 'putting object');
            assert.strictEqual(data.VersionId, undefined);
            params.VersionId = 'null';
            s3.getObject(params, (err, data) => {
                _assertNoError(err, 'getting specific object version "null"');
                assert.strictEqual(data.VersionId, undefined);
                done();
            });
        });
    });

    describe('on a version-enabled bucket', () => {
        beforeEach(done => {
            s3.putBucketVersioning({
                Bucket: bucket,
                VersioningConfiguration: constants.versioningEnabled,
            }, done);
        });

        it('should create a new version for an object', done => {
            const params = { Bucket: bucket, Key: key };
            s3.putObject(params, (err, data) => {
                _assertNoError(err, 'putting object');
                params.VersionId = data.VersionId;
                s3.getObject(params, (err, data) => {
                    _assertNoError(err, 'getting object');
                    assert.strictEqual(params.VersionId, data.VersionId,
                            'version ids are not equal');
                    done();
                });
            });
        });
    });

    describe('on a version-enabled bucket with non-versioned object', () => {
        const eTags = [];

        beforeEach(done => {
            s3.putObject({ Bucket: bucket, Key: key, Body: data[0] },
                (err, data) => {
                    if (err) {
                        done(err);
                    }
                    eTags.push(data.ETag);
                    s3.putBucketVersioning({
                        Bucket: bucket,
                        VersioningConfiguration: constants.versioningEnabled,
                    }, done);
                });
        });

        afterEach(done => {
            // reset eTags
            eTags.length = 0;
            done();
        });

        it('should get null version in versioning enabled bucket',
        done => {
            const paramsNull = { Bucket: bucket, Key: '/', VersionId: 'null' };
            s3.getObject(paramsNull, err => {
                _assertNoError(err, 'getting null version');
                done();
            });
        });

        it('should keep null version and create a new version for an object',
        done => {
            const params = { Bucket: bucket, Key: key, Body: data[1] };
            s3.putObject(params, (err, data) => {
                const newVersion = data.VersionId;
                eTags.push(data.ETag);
                s3.getObject({ Bucket: bucket, Key: key,
                    VersionId: newVersion }, (err, data) => {
                    assert.strictEqual(err, null);
                    assert.strictEqual(data.VersionId, newVersion,
                        'version ids are not equal');
                    assert.strictEqual(data.ETag, eTags[1]);
                    s3.getObject({ Bucket: bucket, Key: key,
                    VersionId: 'null' }, (err, data) => {
                        _assertNoError(err, 'getting null version');
                        assert.strictEqual(data.VersionId, 'null');
                        assert.strictEqual(data.ETag, eTags[0]);
                        done();
                    });
                });
            });
        });

        it('should create new versions but still keep nullVersionId',
        done => {
            const versionIds = [];
            const params = { Bucket: bucket, Key: key };
            const paramsNull = { Bucket: bucket, Key: key, VersionId: 'null' };
            // create new versions
            async.timesSeries(counter, (i, next) => s3.putObject(params,
                (err, data) => {
                    versionIds.push(data.VersionId);
                    // get the 'null' version
                    s3.getObject(paramsNull, (err, nullVerData) => {
                        assert.strictEqual(err, null);
                        assert.strictEqual(nullVerData.ETag, eTags[0]);
                        assert.strictEqual(nullVerData.VersionId, 'null');
                        next(err);
                    });
                }), done);
        });
    });

    describe('on version-suspended bucket', () => {
        beforeEach(done => {
            s3.putBucketVersioning({
                Bucket: bucket,
                VersioningConfiguration: constants.versioningSuspended,
            }, done);
        });

        it('should not return version id for new object', done => {
            const params = { Bucket: bucket, Key: key, Body: 'foo' };
            const paramsNull = { Bucket: bucket, Key: key, VersionId: 'null' };
            s3.putObject(params, (err, data) => {
                const eTag = data.ETag;
                _assertNoError(err, 'putting object');
                assert.strictEqual(data.VersionId, undefined);
                // getting null version should return object we just put
                s3.getObject(paramsNull, (err, nullVerData) => {
                    _assertNoError(err, 'getting null version');
                    assert.strictEqual(nullVerData.ETag, eTag);
                    assert.strictEqual(nullVerData.VersionId, 'null');
                    done();
                });
            });
        });

        it('should update null version if put object twice', done => {
            const params = { Bucket: bucket, Key: key };
            const params1 = { Bucket: bucket, Key: key, Body: data[0] };
            const params2 = { Bucket: bucket, Key: key, Body: data[1] };
            const paramsNull = { Bucket: bucket, Key: key, VersionId: 'null' };
            const eTags = [];
            async.waterfall([
                callback => s3.putObject(params1, (err, data) => {
                    _assertNoError(err, 'putting first object');
                    assert.strictEqual(data.VersionId, undefined);
                    eTags.push(data.ETag);
                    callback();
                }),
                callback => s3.getObject(params, (err, data) => {
                    _assertNoError(err, 'getting master version');
                    assert.strictEqual(data.VersionId, 'null');
                    assert.strictEqual(data.ETag, eTags[0],
                        'wrong object data');
                    callback();
                }),
                callback => s3.putObject(params2, (err, data) => {
                    _assertNoError(err, 'putting second object');
                    assert.strictEqual(data.VersionId, undefined);
                    eTags.push(data.ETag);
                    callback();
                }),
                callback => s3.getObject(paramsNull, (err, data) => {
                    _assertNoError(err, 'getting null version');
                    assert.strictEqual(data.VersionId, 'null');
                    assert.strictEqual(data.ETag, eTags[1],
                        'wrong object data');
                    callback();
                }),
            ], done);
        });
    });

    describe('on a version-suspended bucket with non-versioned object', () => {
        const eTags = [];

        beforeEach(done => {
            s3.putObject({ Bucket: bucket, Key: key, Body: data[0] },
                (err, data) => {
                    if (err) {
                        done(err);
                    }
                    eTags.push(data.ETag);
                    s3.putBucketVersioning({
                        Bucket: bucket,
                        VersioningConfiguration: constants.versioningSuspended,
                    }, done);
                });
        });

        afterEach(done => {
            // reset eTags
            eTags.length = 0;
            done();
        });

        it('should get null version in versioning suspended bucket',
        done => {
            const paramsNull = { Bucket: bucket, Key: '/', VersionId: 'null' };
            s3.getObject(paramsNull, err => {
                _assertNoError(err, 'getting null version');
                done();
            });
        });

        it('should update null version in versioning suspended bucket',
        done => {
            const params = { Bucket: bucket, Key: key };
            const putParams = { Bucket: bucket, Key: '/', Body: data[1] };
            const paramsNull = { Bucket: bucket, Key: key, VersionId: 'null' };
            async.waterfall([
                callback => s3.getObject(paramsNull, (err, data) => {
                    _assertNoError(err, 'getting null version');
                    assert.strictEqual(data.VersionId, 'null');
                    callback();
                }),
                callback => s3.putObject(putParams, (err, data) => {
                    _assertNoError(err, 'putting object');
                    assert.strictEqual(data.VersionId, undefined);
                    eTags.push(data.ETag);
                    callback();
                }),
                callback => s3.getObject(paramsNull, (err, data) => {
                    _assertNoError(err, 'getting null version');
                    assert.strictEqual(data.VersionId, 'null');
                    assert.strictEqual(data.ETag, eTags[1],
                        'wrong object data');
                    callback();
                }),
                callback => s3.getObject(params, (err, data) => {
                    _assertNoError(err, 'getting master version');
                    assert.strictEqual(data.VersionId, 'null');
                    assert.strictEqual(data.ETag, eTags[1],
                        'wrong object data');
                    callback();
                }),
            ], done);
        });
    });

    describe('on versioning suspended then enabled bucket with null version',
    () => {
        const eTags = [];
        beforeEach(done => {
            const params = { Bucket: bucket, Key: key, Body: data[0] };
            async.waterfall([
                callback => s3.putBucketVersioning({
                    Bucket: bucket,
                    VersioningConfiguration: constants.versioningSuspended,
                }, err => callback(err)),
                callback => s3.putObject(params, (err, data) => {
                    if (err) {
                        callback(err);
                    }
                    eTags.push(data.ETag);
                    callback();
                }),
                callback => s3.putBucketVersioning({
                    Bucket: bucket,
                    VersioningConfiguration: constants.versioningEnabled,
                }, callback),
            ], done);
        });

        afterEach(done => {
            // reset eTags
            eTags.length = 0;
            done();
        });

        it('should preserve the null version when creating new versions',
        done => {
            const params = { Bucket: bucket, Key: key };
            const paramsNull = { Bucket: bucket, Key: key, VersionId: 'null' };
            async.waterfall([
                callback => s3.getObject(paramsNull, (err, nullVerData) => {
                    _assertNoError(err, 'getting null version');
                    assert.strictEqual(nullVerData.ETag, eTags[0]);
                    assert.strictEqual(nullVerData.VersionId, 'null');
                    callback();
                }),
                callback => async.timesSeries(counter, (i, next) =>
                    s3.putObject(params, (err, data) => {
                        _assertNoError(err, `putting object #${i}`);
                        assert.notEqual(data.VersionId, undefined);
                        next();
                    }), err => callback(err)),
                callback => s3.getObject(paramsNull, (err, nullVerData) => {
                    _assertNoError(err, 'getting null version');
                    assert.strictEqual(nullVerData.ETag, eTags[0]);
                    callback();
                }),
            ], done);
        });

        it('should create a bunch of objects and their versions', done => {
            const vids = [];
            const keycount = 50;
            const versioncount = 20;
            const value = '{"foo":"bar"}';
            async.times(keycount, (i, next1) => {
                const key = `foo${i}`;
                const params = { Bucket: bucket, Key: key, Body: value };
                async.times(versioncount, (j, next2) =>
                    s3.putObject(params, (err, data) => {
                        assert.strictEqual(err, null);
                        assert(data.VersionId, 'invalid versionId');
                        vids.push({ Key: key, VersionId: data.VersionId });
                        next2();
                    }), next1);
            }, err => {
                assert.strictEqual(err, null);
                assert.strictEqual(vids.length, keycount * versioncount);
                // TODO use delete marker and check with the result
                process.stdout.write('creating objects done, now deleting...');
                done();
            });
        });
    });
});
