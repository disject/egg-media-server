'use strict';
const NodeRtmpServer = require('./rtmp/rtmp_server');
// const NodeHttpServer = require('./node_http_server');
// const NodeTransServer = require('./node_trans_server');
// const NodeRelayServer = require('./node_relay_server');
// const NodeIpcServer = require('./node_ipc_server');
const context = require('./core/ctx');
class NodeMediaServer {
  constructor(config) {
    this.config = config;
  }

  run() {
    if (this.config.rtmp) {
      this.nrs = new NodeRtmpServer(this.config);
      this.nrs.run();
    }

    // if (this.config.http) {
    //   this.nhs = new NodeHttpServer(this.config);
    //   this.nhs.run();
    // }

    // if (this.config.trans) {
    //   if (this.config.cluster) {
    //     console.log('NodeTransServer does not work in cluster mode');
    //   } else {
    //     this.nts = new NodeTransServer(this.config);
    //     this.nts.run();
    //   }
    // }

    // if (this.config.relay) {
    //   if (this.config.cluster) {
    //     console.log('NodeRelayServer does not work in cluster mode');
    //   } else {
    //     this.nls = new NodeRelayServer(this.config);
    //     this.nls.run();
    //   }
    // }

    // if (this.config.cluster) {
    //   this.nis = new NodeIpcServer(this.config);
    //   this.nis.run();
    // }

    process.on('uncaughtException', function(err) {
      console.error('uncaughtException', err);
    });

  }

  on(eventName, listener) {
    context.nodeEvent.on(eventName, listener);
  }

  stop() {
    if (this.nrs) {
      this.nrs.stop();
    }
    if (this.nhs) {
      this.nhs.stop();
    }
    if (this.nls) {
      this.nls.stop();
    }
    if (this.nis) {
      this.nis.stop();
    }
  }

  getSession(id) {
    return context.sessions.get(id);
  }
}

module.exports = NodeMediaServer;
