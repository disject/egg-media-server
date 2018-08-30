# egg-media-server

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![David deps][david-image]][david-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/egg-media-server.svg?style=flat-square
[npm-url]: https://npmjs.org/package/egg-media-server
[travis-image]: https://img.shields.io/travis/eggjs/egg-media-server.svg?style=flat-square
[travis-url]: https://travis-ci.org/eggjs/egg-media-server
[codecov-image]: https://img.shields.io/codecov/c/github/eggjs/egg-media-server.svg?style=flat-square
[codecov-url]: https://codecov.io/github/eggjs/egg-media-server?branch=master
[david-image]: https://img.shields.io/david/eggjs/egg-media-server.svg?style=flat-square
[david-url]: https://david-dm.org/eggjs/egg-media-server
[snyk-image]: https://snyk.io/test/npm/egg-media-server/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/egg-media-server
[download-image]: https://img.shields.io/npm/dm/egg-media-server.svg?style=flat-square
[download-url]: https://npmjs.org/package/egg-media-server

<!--
Description here.
-->

## Install

```bash
$ npm i egg-media-server --save
```

## Usage

```js
// {app_root}/config/plugin.js
exports.mediaServer = {
  enable: true,
  package: 'egg-media-server',
};
```

## Configuration

```js
// {app_root}/config/config.default.js
exports.mediaServer = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 60,
    ping_timeout: 30
  },
  http: {
    port: 8000,
    allow_origin: '*'
  }
};
```

see [config/config.default.js](config/config.default.js) for more detail.

## Example

<!-- example here -->

## Questions & Suggestions

Please open an issue [here](https://github.com/eggjs/egg/issues).

## License

[MIT](LICENSE)
