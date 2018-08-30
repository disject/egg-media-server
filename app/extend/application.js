'use strict';

const NMS = Symbol('Application#nms');

const { NodeMediaServer } = require('node-media-server');
const defaultConfig = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30,
  },
  http: {
    port: 8000,
    allow_origin: '*',
  },
};
module.exports = {
  get nms() {
    const config = this.config.nms;
    if (!this[NMS]) this[NMS] = new NodeMediaServer(config || defaultConfig);
    return this[NMS];
  },
};
