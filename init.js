'use strict'; // eslint-disable-line strict
require('babel-core/register');

const assert = require('assert');
const fs = require('fs');
const os = require('os');

const config = require('./lib/Config.js').default;
const logger = require('./lib/utilities/logger.js').logger;

let ioctl;
try {
    ioctl = require('ioctl');
} catch (err) {
    logger.warn('ioctl dependency is unavailable. skipping...');
}

function _setDirSyncFlag(path) {
    const GETFLAGS = 2148034049;
    const SETFLAGS = 1074292226;
    const FS_DIRSYNC_FL = 65536;
    const buffer = Buffer.alloc(8, 0);
    const pathFD = fs.openSync(path, 'r');
    const status = ioctl(pathFD, GETFLAGS, buffer);
    assert.strictEqual(status, 0);
    const currentFlags = buffer.readUIntLE(0, 8);
    const flags = currentFlags | FS_DIRSYNC_FL;
    buffer.writeUIntLE(flags, 0, 8);
    const status2 = ioctl(pathFD, SETFLAGS, buffer);
    assert.strictEqual(status2, 0);
    fs.closeSync(pathFD);
    const pathFD2 = fs.openSync(path, 'r');
    const confirmBuffer = Buffer.alloc(8, 0);
    ioctl(pathFD2, GETFLAGS, confirmBuffer);
    assert.strictEqual(confirmBuffer.readUIntLE(0, 8),
        currentFlags | FS_DIRSYNC_FL, 'FS_DIRSYNC_FL not set');
    logger.info('FS_DIRSYNC_FL set');
    fs.closeSync(pathFD2);
}

if (config.backends.data !== 'file' && config.backends.metadata !== 'file') {
    logger.info('No init required. Go forth and store data.');
    process.exit(0);
}

const metadataPath = config.filePaths.metadataPath;

fs.accessSync(metadataPath, fs.F_OK | fs.R_OK | fs.W_OK);
const warning = 'WARNING: Synchronization directory updates are not ' +
    'supported on this platform. Newly written data could be lost ' +
    'if your system crashes before the operating system is able to ' +
    'write directory updates.';
if (os.type() === 'Linux' && os.endianness() === 'LE' && ioctl) {
    try {
        _setDirSyncFlag(metadataPath);
    } catch (err) {
        logger.warn(warning, { error: err.stack });
    }
} else {
    logger.warn(warning);
}
