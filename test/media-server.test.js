'use strict';

const mock = require('egg-mock');

describe('test/media-server.test.js', () => {
  let app;
  before(() => {
    app = mock.app({
      baseDir: 'apps/media-server-test',
    });
    return app.ready();
  });

  after(() => app.close());
  afterEach(mock.restore);

  it('should GET /', () => {
    return app.httpRequest()
      .get('/')
      .expect('hi, mediaServer')
      .expect(200);
  });
});
