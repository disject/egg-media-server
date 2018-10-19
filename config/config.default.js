'use strict';

/**
 * egg-media-server default config
 * @member Config#mediaServer
 * @property {String} SOME_KEY - some description
 */
exports.mediaServer = {
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
