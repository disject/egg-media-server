'use strict';
const EventEmitter = require('events');

const sessions = new Map();
const publishers = new Map();
const idlePlayers = new Set();
const nodeEvent = new EventEmitter();
const stat = {
  inbytes: 0,
  outbytes: 0,
  accepted: 0,
};
module.exports = { sessions, publishers, idlePlayers, nodeEvent, stat };
