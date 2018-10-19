'use strict';
const QueryString = require('querystring');

const AV = require('../core/av');
const { AUDIO_SOUND_RATE, AUDIO_CODEC_NAME, VIDEO_CODEC_NAME } = require('../core/av');
const AMF = require('../core/amf');
const NodeCoreUtils = require('../core/utils');
const context = require('../core/ctx');

const Handshake = require('../rtmp/rtmp_handshake');
const NodeFlvSession = require('../flv_session');
const RTMP_HANDSHAKE_SIZE = 1536;
const RTMP_HANDSHAKE_UNINIT = 0;
const RTMP_HANDSHAKE_0 = 1;
const RTMP_HANDSHAKE_1 = 2;
const RTMP_HANDSHAKE_2 = 3;

const RTMP_PARSE_INIT = 0;
const RTMP_PARSE_BASIC_HEADER = 1;
const RTMP_PARSE_MESSAGE_HEADER = 2;
const RTMP_PARSE_EXTENDED_TIMESTAMP = 3;
const RTMP_PARSE_PAYLOAD = 4;

const MAX_CHUNK_HEADER = 18;

const RTMP_CHUNK_TYPE_0 = 0; // 11-bytes: timestamp(3) + length(3) + stream type(1) + stream id(4)
const RTMP_CHUNK_TYPE_1 = 1; // 7-bytes: delta(3) + length(3) + stream type(1)
const RTMP_CHUNK_TYPE_2 = 2; // 3-bytes: delta(3)
const RTMP_CHUNK_TYPE_3 = 3; // 0-byte

const RTMP_CHANNEL_PROTOCOL = 2;
const RTMP_CHANNEL_INVOKE = 3;
const RTMP_CHANNEL_AUDIO = 4;
const RTMP_CHANNEL_VIDEO = 5;
const RTMP_CHANNEL_DATA = 6;

const rtmpHeaderSize = [ 11, 7, 3, 0 ];

/* Protocol Control Messages */
const RTMP_TYPE_SET_CHUNK_SIZE = 1;
const RTMP_TYPE_ABORT = 2;
const RTMP_TYPE_ACKNOWLEDGEMENT = 3; // bytes read report
const RTMP_TYPE_WINDOW_ACKNOWLEDGEMENT_SIZE = 5; // server bandwidth
const RTMP_TYPE_SET_PEER_BANDWIDTH = 6; // client bandwidth

/* User Control Messages Event (4) */
const RTMP_TYPE_EVENT = 4;

const RTMP_TYPE_AUDIO = 8;
const RTMP_TYPE_VIDEO = 9;

/* Data Message */
const RTMP_TYPE_FLEX_STREAM = 15; // AMF3
const RTMP_TYPE_DATA = 18; // AMF0

/* Command Message */
const RTMP_TYPE_FLEX_MESSAGE = 17; // AMF3
const RTMP_TYPE_INVOKE = 20; // AMF0

/* Aggregate Message */
const RTMP_CHUNK_SIZE = 128;
const RTMP_PING_TIME = 60000;
const RTMP_PING_TIMEOUT = 30000;

const STREAM_BEGIN = 0x00;
const STREAM_EOF = 0x01;

const RtmpPacket = {
  create: (fmt = 0, cid = 0) => {
    return {
      header: {
        fmt,
        cid,
        timestamp: 0,
        length: 0,
        type: 0,
        stream_id: 0,
      },
      clock: 0,
      delta: 0,
      payload: null,
      capacity: 0,
      bytes: 0,
    };
  },
};

class NodeRtmpSession {
  constructor(config, socket) {
    this.config = config;
    this.socket = socket;
    this.id = NodeCoreUtils.generateNewSessionID();
    this.ip = socket.remoteAddress;
    this.TAG = 'rtmp';

    this.handshakePayload = Buffer.alloc(RTMP_HANDSHAKE_SIZE);
    this.handshakeState = RTMP_HANDSHAKE_UNINIT;
    this.handshakeBytes = 0;

    this.parserBuffer = Buffer.alloc(MAX_CHUNK_HEADER);
    this.parserState = RTMP_PARSE_INIT;
    this.parserBytes = 0;
    this.parserBasicBytes = 0;
    this.parserPacket = null;
    this.inPackets = new Map();

    this.inChunkSize = RTMP_CHUNK_SIZE;
    this.outChunkSize = config.rtmp.chunk_size ? config.rtmp.chunk_size : RTMP_CHUNK_SIZE;
    this.pingTime = config.rtmp.ping ? config.rtmp.ping * 1000 : RTMP_PING_TIME;
    this.pingTimeout = config.rtmp.ping_timeout ? config.rtmp.ping_timeout * 1000 : RTMP_PING_TIMEOUT;
    this.pingInterval = null;

    this.isIPC = false;
    this.isLocal = this.ip === '127.0.0.1' || this.ip === '::1' || this.ip === '::ffff:127.0.0.1';
    this.isStarting = false;
    this.isPublishing = false;
    this.isPlaying = false;
    this.isIdling = false;
    this.isPause = false;
    this.isFirstAudioReceived = false;
    this.isFirstVideoReceived = false;
    this.isReceiveAudio = true;
    this.isReceiveVideo = true;
    this.metaData = null;
    this.aacSequenceHeader = null;
    this.avcSequenceHeader = null;
    this.audioCodec = 0;
    this.audioCodecName = '';
    this.audioProfileName = '';
    this.audioSamplerate = 0;
    this.audioChannels = 1;
    this.videoCodec = 0;
    this.videoCodecName = '';
    this.videoProfileName = '';
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.videoFps = 0;
    this.videoLevel = 0;

    this.gopCacheEnable = config.rtmp.gop_cache;
    this.rtmpGopCacheQueue = null;
    this.flvGopCacheQueue = null;

    this.ackSize = 0;
    this.inAckSize = 0;
    this.inLastAck = 0;

    this.appname = '';
    this.streams = 0;

    this.playStreamId = 0;
    this.playStreamPath = '';
    this.playArgs = {};

    this.publishStreamId = 0;
    this.publishStreamPath = '';
    this.publishArgs = {};

    this.players = new Set();

    context.sessions.set(this.id, this);
  }

  run() {
    this.socket.on('data', this.onSocketData.bind(this));
    this.socket.on('close', this.onSocketClose.bind(this));
    this.socket.on('error', this.onSocketError.bind(this));
    this.socket.on('timeout', this.onSocketTimeout.bind(this));
    this.socket.setTimeout(this.pingTimeout);
    this.isStarting = true;
  }

  stop() {
    if (this.isStarting) {
      this.isStarting = false;

      if (this.playStreamId > 0) {
        this.onDeleteStream({ streamId: this.playStreamId });
      }

      if (this.publishStreamId > 0) {
        this.onDeleteStream({ streamId: this.publishStreamId });
      }

      if (this.pingInterval !== null) {
        clearInterval(this.pingInterval);
        this.pingInterval = null;
      }

      if (!this.isIPC) {
        console.log(`[rtmp disconnect] id=${this.id}`);
        context.nodeEvent.emit('doneConnect', this.id, this.connectCmdObj);
      }

      context.sessions.delete(this.id);
      this.socket.destroy();
    }
  }

  reject() {
    console.log(`[rtmp reject] id=${this.id}`);
    this.stop();
  }

  onSocketClose() {
    // console.log('onSocketClose');
    this.stop();
  }

  onSocketError() {
    // console.log('onSocketError', e);
    this.stop();
  }

  onSocketTimeout() {
    // console.log('onSocketTimeout');
    this.stop();
  }

  onSocketData(data) {
    let bytes = data.length;
    let p = 0;
    let n = 0;
    while (bytes > 0) {
      switch (this.handshakeState) {
        case RTMP_HANDSHAKE_UNINIT:
          // console.log('RTMP_HANDSHAKE_UNINIT');
          this.handshakeState = RTMP_HANDSHAKE_0;
          this.handshakeBytes = 0;
          bytes -= 1;
          p += 1;
          break;
        case RTMP_HANDSHAKE_0:
          // console.log('RTMP_HANDSHAKE_0');
          n = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
          n = n <= bytes ? n : bytes;
          data.copy(this.handshakePayload, this.handshakeBytes, p, p + n);
          this.handshakeBytes += n;
          bytes -= n;
          p += n;
          if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
            this.handshakeState = RTMP_HANDSHAKE_1;
            this.handshakeBytes = 0;
            const s0s1s2 = Handshake.generateS0S1S2(this.handshakePayload);
            this.socket.write(s0s1s2);
          }
          break;
        case RTMP_HANDSHAKE_1:
          // console.log('RTMP_HANDSHAKE_1');
          n = RTMP_HANDSHAKE_SIZE - this.handshakeBytes;
          n = n <= bytes ? n : bytes;
          data.copy(this.handshakePayload, this.handshakeBytes, p, n);
          this.handshakeBytes += n;
          bytes -= n;
          p += n;
          if (this.handshakeBytes === RTMP_HANDSHAKE_SIZE) {
            this.handshakeState = RTMP_HANDSHAKE_2;
            this.handshakeBytes = 0;
            this.handshakePayload = null;
          }
          break;
        case RTMP_HANDSHAKE_2:
        default:
          // console.log('RTMP_HANDSHAKE_2');
          return this.rtmpChunkRead(data, p, bytes);
      }
    }
  }

  rtmpChunkBasicHeaderCreate(fmt, cid) {
    let out;
    if (cid >= 64 + 255) {
      out = Buffer.alloc(3);
      out[0] = (fmt << 6) | 1;
      out[1] = (cid - 64) & 0xFF;
      out[2] = ((cid - 64) >> 8) & 0xFF;
    } else if (cid >= 64) {
      out = Buffer.alloc(2);
      out[0] = (fmt << 6) | 0;
      out[1] = (cid - 64) & 0xFF;
    } else {
      out = Buffer.alloc(1);
      out[0] = (fmt << 6) | cid;
    }
    return out;
  }

  rtmpChunkMessageHeaderCreate(header) {
    const out = Buffer.alloc(rtmpHeaderSize[header.fmt % 4]);
    if (header.fmt <= RTMP_CHUNK_TYPE_2) {
      out.writeUIntBE(header.timestamp >= 0xffffff ? 0xffffff : header.timestamp, 0, 3);
    }

    if (header.fmt <= RTMP_CHUNK_TYPE_1) {
      out.writeUIntBE(header.length, 3, 3);
      out.writeUInt8(header.type, 6);
    }

    if (header.fmt === RTMP_CHUNK_TYPE_0) {
      out.writeUInt32LE(header.stream_id, 7);
    }
    return out;
  }

  rtmpChunksCreate(packet) {
    const header = packet.header;
    const payload = packet.payload;
    let payloadSize = header.length;
    const chunkSize = this.outChunkSize;
    let chunksOffset = 0;
    let payloadOffset = 0;

    const chunkBasicHeader = this.rtmpChunkBasicHeaderCreate(header.fmt, header.cid);
    const chunkBasicHeader3 = this.rtmpChunkBasicHeaderCreate(RTMP_CHUNK_TYPE_3, header.cid);
    const chunkMessageHeader = this.rtmpChunkMessageHeaderCreate(header);
    const useExtendedTimestamp = header.timestamp >= 0xffffff;
    const headerSize = chunkBasicHeader.length + chunkMessageHeader.length + (useExtendedTimestamp ? 4 : 0);

    let n = headerSize + payloadSize + Math.floor(payloadSize / chunkSize);
    if (useExtendedTimestamp) {
      n += Math.floor(payloadSize / chunkSize) * 4;
    }
    if (!(payloadSize % chunkSize)) {
      n -= 1;
      if (useExtendedTimestamp) { // TODO CHECK
        n -= 4;
      }
    }

    const chunks = Buffer.alloc(n);
    chunkBasicHeader.copy(chunks, chunksOffset);
    chunksOffset += chunkBasicHeader.length;
    chunkMessageHeader.copy(chunks, chunksOffset);
    chunksOffset += chunkMessageHeader.length;
    if (useExtendedTimestamp) {
      chunks.writeUInt32BE(header.timestamp, chunksOffset);
      chunksOffset += 4;
    }
    while (payloadSize > 0) {
      if (payloadSize > chunkSize) {
        payload.copy(chunks, chunksOffset, payloadOffset, payloadOffset + chunkSize);
        payloadSize -= chunkSize;
        chunksOffset += chunkSize;
        payloadOffset += chunkSize;
        chunkBasicHeader3.copy(chunks, chunksOffset);
        chunksOffset += chunkBasicHeader3.length;
        if (useExtendedTimestamp) {
          chunks.writeUInt32BE(header.timestamp, chunksOffset);
          chunksOffset += 4;
        }
      } else {
        payload.copy(chunks, chunksOffset, payloadOffset, payloadOffset + payloadSize);
        payloadSize -= payloadSize;
        chunksOffset += payloadSize;
        payloadOffset += payloadSize;
      }
    }
    return chunks;
  }

  rtmpChunkRead(data, p, bytes) {
    // console.log('rtmpChunkRead', p, bytes);

    let size = 0;
    let offset = 0;
    let extended_timestamp = 0;

    while (offset < bytes) {
      switch (this.parserState) {
        case RTMP_PARSE_INIT:
          this.parserBytes = 1;
          this.parserBuffer[0] = data[p + offset++];
          if ((this.parserBuffer[0] & 0x3F) === 0) {
            this.parserBasicBytes = 2;
          } else if ((this.parserBuffer[0] & 0x3F) === 1) {
            this.parserBasicBytes = 3;
          } else {
            this.parserBasicBytes = 1;
          }
          this.parserState = RTMP_PARSE_BASIC_HEADER;
          break;
        case RTMP_PARSE_BASIC_HEADER:
          while (this.parserBytes < this.parserBasicBytes && offset < bytes) {
            this.parserBuffer[this.parserBytes++] = data[p + offset++];
          }
          if (this.parserBytes >= this.parserBasicBytes) {
            this.parserState = RTMP_PARSE_MESSAGE_HEADER;
          }
          break;
        case RTMP_PARSE_MESSAGE_HEADER:
          size = rtmpHeaderSize[this.parserBuffer[0] >> 6] + this.parserBasicBytes;
          while (this.parserBytes < size && offset < bytes) {
            this.parserBuffer[this.parserBytes++] = data[p + offset++];
          }
          if (this.parserBytes >= size) {
            this.rtmpPacketParse();
            this.parserState = RTMP_PARSE_EXTENDED_TIMESTAMP;
          }
          break;
        case RTMP_PARSE_EXTENDED_TIMESTAMP:
          size = rtmpHeaderSize[this.parserPacket.header.fmt] + this.parserBasicBytes;
          if (this.parserPacket.header.timestamp === 0xFFFFFF) size += 4;
          while (this.parserBytes < size && offset < bytes) {
            this.parserBuffer[this.parserBytes++] = data[p + offset++];
          }
          if (this.parserBytes >= size) {
            if (this.parserPacket.header.timestamp === 0xFFFFFF) {
              extended_timestamp = this.parserBuffer.readUInt32BE(rtmpHeaderSize[this.parserPacket.header.fmt] + this.parserBasicBytes);
            }

            if (this.parserPacket.bytes === 0) {
              if (RTMP_CHUNK_TYPE_0 === this.parserPacket.header.fmt) {
                this.parserPacket.clock = this.parserPacket.header.timestamp === 0xFFFFFF ? extended_timestamp : this.parserPacket.header.timestamp;
                this.parserPacket.delta = 0;
              } else {
                this.parserPacket.delta = this.parserPacket.header.timestamp === 0xFFFFFF ? extended_timestamp : this.parserPacket.header.timestamp;
              }
              this.rtmpPacketAlloc();
            }
            this.parserState = RTMP_PARSE_PAYLOAD;
          }
          break;
        case RTMP_PARSE_PAYLOAD:
          size = Math.min(this.inChunkSize - (this.parserPacket.bytes % this.inChunkSize), this.parserPacket.header.length - this.parserPacket.bytes);
          size = Math.min(size, bytes - offset);
          if (size > 0) {
            data.copy(this.parserPacket.payload, this.parserPacket.bytes, p + offset, p + offset + size);
          }
          this.parserPacket.bytes += size;
          offset += size;

          if (this.parserPacket.bytes >= this.parserPacket.header.length) {
            this.parserState = RTMP_PARSE_INIT;
            this.parserPacket.bytes = 0;
            this.parserPacket.clock += this.parserPacket.delta;
            this.rtmpHandler();
          } else if ((this.parserPacket.bytes % this.inChunkSize) === 0) {
            this.parserState = RTMP_PARSE_INIT;
          }
          break;
        default:
          console.error("can't match");
      }
    }

    this.inAckSize += data.length;
    if (this.inAckSize >= 0xf0000000) {
      this.inAckSize = 0;
      this.inLastAck = 0;
    }
    if (this.ackSize > 0 && this.inAckSize - this.inLastAck >= this.ackSize) {
      this.inLastAck = this.inAckSize;
      this.sendACK(this.inAckSize);
    }

  }

  rtmpPacketParse() {
    const fmt = this.parserBuffer[0] >> 6;
    let cid = 0;
    if (this.parserBasicBytes === 2) {
      cid = 64 + this.parserBuffer[1];
    } else if (this.parserBasicBytes === 3) {
      cid = 64 + this.parserBuffer[1] + this.parserBuffer[2] << 8;
    } else {
      cid = this.parserBuffer[0] & 0x3F;
    }
    const hasp = this.inPackets.has(cid);
    if (!hasp) {
      this.parserPacket = RtmpPacket.create(fmt, cid);
      this.inPackets.set(cid, this.parserPacket);
    } else {
      this.parserPacket = this.inPackets.get(cid);
    }
    this.parserPacket.header.fmt = fmt;
    this.parserPacket.header.cid = cid;
    this.rtmpChunkMessageHeaderRead();
    // console.log(this.parserPacket);

  }

  rtmpChunkMessageHeaderRead() {
    let offset = this.parserBasicBytes;

    // timestamp / delta
    if (this.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_2) {
      this.parserPacket.header.timestamp = this.parserBuffer.readUIntBE(offset, 3);
      offset += 3;
    }

    // message length + type
    if (this.parserPacket.header.fmt <= RTMP_CHUNK_TYPE_1) {
      this.parserPacket.header.length = this.parserBuffer.readUIntBE(offset, 3);
      this.parserPacket.header.type = this.parserBuffer[offset + 3];
      offset += 4;
    }

    if (this.parserPacket.header.fmt === RTMP_CHUNK_TYPE_0) {
      this.parserPacket.header.stream_id = this.parserBuffer.readUInt32LE(offset);
      offset += 4;
    }
    return offset;
  }

  rtmpPacketAlloc() {
    if (this.parserPacket.capacity < this.parserPacket.header.length) {
      this.parserPacket.payload = Buffer.alloc(this.parserPacket.header.length + 1024);
      this.parserPacket.capacity = this.parserPacket.header.length + 1024;
    }
  }

  rtmpHandler() {
    switch (this.parserPacket.header.type) {
      case RTMP_TYPE_SET_CHUNK_SIZE:
      case RTMP_TYPE_ABORT:
      case RTMP_TYPE_ACKNOWLEDGEMENT:
      case RTMP_TYPE_WINDOW_ACKNOWLEDGEMENT_SIZE:
      case RTMP_TYPE_SET_PEER_BANDWIDTH:
        return this.rtmpControlHandler() === 0 ? -1 : 0;
      case RTMP_TYPE_EVENT:
        return this.rtmpEventHandler() === 0 ? -1 : 0;
      case RTMP_TYPE_AUDIO:
        return this.rtmpAudioHandler();
      case RTMP_TYPE_VIDEO:
        return this.rtmpVideoHandler();
      case RTMP_TYPE_FLEX_MESSAGE:
      case RTMP_TYPE_INVOKE:
        return this.rtmpInvokeHandler();
      case RTMP_TYPE_FLEX_STREAM:// AMF3
      case RTMP_TYPE_DATA: // AMF0
        return this.rtmpDataHandler();
      default:
        console.error("can't match");
    }
  }

  rtmpControlHandler() {
    const payload = this.parserPacket.payload;
    switch (this.parserPacket.header.type) {
      case RTMP_TYPE_SET_CHUNK_SIZE:
        this.inChunkSize = payload.readUInt32BE();
        // console.debug('set inChunkSize', this.inChunkSize);
        break;
      case RTMP_TYPE_ABORT:
        break;
      case RTMP_TYPE_ACKNOWLEDGEMENT:
        break;
      case RTMP_TYPE_WINDOW_ACKNOWLEDGEMENT_SIZE:
        this.ackSize = payload.readUInt32BE();
        // console.debug('set ack Size', this.ackSize);
        break;
      case RTMP_TYPE_SET_PEER_BANDWIDTH:
        break;
      default:
        console.error("can't match");
    }
  }

  rtmpEventHandler() {

  }

  rtmpAudioHandler() {
    const payload = this.parserPacket.payload.slice(0, this.parserPacket.header.length);
    if (!this.isFirstAudioReceived) {
      let sound_format = payload[0];
      let sound_type = sound_format & 0x01;
      const sound_size = (sound_format >> 1) & 0x01;
      const sound_rate = (sound_format >> 2) & 0x03;
      sound_format = (sound_format >> 4) & 0x0f;
      this.audioCodec = sound_format;
      this.audioCodecName = AUDIO_CODEC_NAME[sound_format];
      this.audioSamplerate = AUDIO_SOUND_RATE[sound_rate];
      this.audioChannels = ++sound_type;

      if (sound_format === 4) {
        this.audioSamplerate = 16000;
      } else if (sound_format === 5) {
        this.audioSamplerate = 8000;
      } else if (sound_format === 11) {
        this.audioSamplerate = 16000;
      } else if (sound_format === 14) {
        this.audioSamplerate = 8000;
      }

      if (sound_format === 10) {
        // cache aac sequence header
        if (payload[1] === 0) {
          this.isFirstAudioReceived = true;
          this.aacSequenceHeader = Buffer.alloc(payload.length);
          payload.copy(this.aacSequenceHeader);
          const info = AV.readAACSpecificConfig(this.aacSequenceHeader);
          // console.log('[rtmp handleAudioMessage ]',info);
          this.audioProfileName = AV.getAACProfileName(info);
          this.audioSamplerate = info.sample_rate;
          this.audioChannels = info.channels;
        }
      } else {
        this.isFirstAudioReceived = true;
      }
      if (!this.isIPC) {
        console.log(`[rtmp publish] Handle audio. id=${this.id} streamPath=${this.publishStreamPath} sound_format=${sound_format} sound_type=${sound_type} sound_size=${sound_size} sound_rate=${sound_rate} codec_name=${this.audioCodecName} ${this.audioSamplerate} ${this.audioChannels}ch`);
      }
    }
    const packet = RtmpPacket.create();
    packet.header.fmt = RTMP_CHUNK_TYPE_0;
    packet.header.cid = RTMP_CHANNEL_AUDIO;
    packet.header.type = RTMP_TYPE_AUDIO;
    packet.payload = payload;
    packet.header.length = packet.payload.length;
    packet.header.timestamp = this.parserPacket.clock;
    const rtmpChunks = this.rtmpChunksCreate(packet);
    const flvTag = NodeFlvSession.createFlvTag(packet);

    // cache gop
    if (this.rtmpGopCacheQueue !== null) {
      if (this.aacSequenceHeader !== null && payload[1] === 0) {
        // skip aac sequence header
      } else {
        this.rtmpGopCacheQueue.add(rtmpChunks);
        this.flvGopCacheQueue.add(flvTag);
      }
    }

    for (const playerId of this.players) {
      const playerSession = context.sessions.get(playerId);
      if (playerSession instanceof NodeRtmpSession) {
        if (playerSession.isStarting && playerSession.isPlaying && !playerSession.isPause && playerSession.isReceiveAudio) {
          rtmpChunks.writeUInt32LE(playerSession.playStreamId, 8);
          playerSession.socket.write(rtmpChunks);
        }
      } else if (playerSession instanceof NodeFlvSession) {
        playerSession.res.write(flvTag, null, () => {
          // websocket will throw a error if not set the cb when closed
        });
      }

    }
  }

  rtmpVideoHandler() {
    const payload = this.parserPacket.payload.slice(0, this.parserPacket.header.length);
    let frame_type = payload[0];
    const codec_id = frame_type & 0x0f;
    frame_type = (frame_type >> 4) & 0x0f;

    if (!this.isFirstVideoReceived) {
      this.videoCodec = codec_id;
      this.videoCodecName = VIDEO_CODEC_NAME[codec_id];

      if (codec_id === 7 || codec_id === 12) {
        // cache avc sequence header
        if (frame_type === 1 && payload[1] === 0) {
          this.isFirstVideoReceived = true;
          this.avcSequenceHeader = Buffer.alloc(payload.length);
          payload.copy(this.avcSequenceHeader);
          const info = AV.readAVCSpecificConfig(this.avcSequenceHeader);
          // console.log('[rtmp handleVideoMessage ]',info);
          if (this.videoWidth === 0 || this.videoHeight === 0) {
            this.videoWidth = info.width;
            this.videoHeight = info.height;
          }
          this.videoProfileName = AV.getAVCProfileName(info);
          this.videoLevel = info.level;
          this.rtmpGopCacheQueue = this.gopCacheEnable ? new Set() : null;
          this.flvGopCacheQueue = this.gopCacheEnable ? new Set() : null;
        }
      } else {
        this.isFirstVideoReceived = true;
      }
      if (!this.isIPC) {
        console.log(`[rtmp publish] Handle video. id=${this.id} streamPath=${this.publishStreamPath} frame_type=${frame_type} codec_id=${codec_id} codec_name=${this.videoCodecName} ${this.videoWidth}x${this.videoHeight}`);
      }
    }

    const packet = RtmpPacket.create();
    packet.header.fmt = RTMP_CHUNK_TYPE_0;
    packet.header.cid = RTMP_CHANNEL_VIDEO;
    packet.header.type = RTMP_TYPE_VIDEO;
    packet.payload = payload;
    packet.header.length = packet.payload.length;
    packet.header.timestamp = this.parserPacket.clock;
    const rtmpChunks = this.rtmpChunksCreate(packet);
    const flvTag = NodeFlvSession.createFlvTag(packet);


    // cache gop
    if ((codec_id === 7 || codec_id === 12) && this.rtmpGopCacheQueue !== null) {
      if (frame_type === 1 && payload[1] === 1) {
        this.rtmpGopCacheQueue.clear();
        this.flvGopCacheQueue.clear();
      }
      if (frame_type === 1 && payload[1] === 0) {
        // skip avc sequence header
      } else {
        this.rtmpGopCacheQueue.add(rtmpChunks);
        this.flvGopCacheQueue.add(flvTag);
      }
    }

    // console.log(rtmpChunks);
    for (const playerId of this.players) {
      const playerSession = context.sessions.get(playerId);
      if (playerSession instanceof NodeRtmpSession) {
        if (playerSession.isStarting && playerSession.isPlaying && !playerSession.isPause && playerSession.isReceiveVideo) {
          rtmpChunks.writeUInt32LE(playerSession.playStreamId, 8);
          playerSession.socket.write(rtmpChunks);
        }
      } else if (playerSession instanceof NodeFlvSession) {
        playerSession.res.write(flvTag, null, () => {
          // websocket will throw a error if not set the cb when closed
        });
      }
    }

  }

  rtmpDataHandler() {
    const offset = this.parserPacket.header.type === RTMP_TYPE_FLEX_STREAM ? 1 : 0;
    const payload = this.parserPacket.payload.slice(offset, this.parserPacket.header.length);
    const dataMessage = AMF.decodeAmf0Data(payload);
    switch (dataMessage.cmd) {
      case '@setDataFrame': {
        if (dataMessage.dataObj) {
          this.audioSamplerate = dataMessage.dataObj.audiosamplerate;
          this.audioChannels = dataMessage.dataObj.stereo ? 2 : 1;
          this.videoWidth = dataMessage.dataObj.width;
          this.videoHeight = dataMessage.dataObj.height;
          this.videoFps = dataMessage.dataObj.framerate;
        }

        const opt = {
          cmd: 'onMetaData',
          dataObj: dataMessage.dataObj,
        };
        this.metaData = AMF.encodeAmf0Data(opt);

        const packet = RtmpPacket.create();
        packet.header.fmt = RTMP_CHUNK_TYPE_0;
        packet.header.cid = RTMP_CHANNEL_DATA;
        packet.header.type = RTMP_TYPE_DATA;
        packet.payload = this.metaData;
        packet.header.length = packet.payload.length;
        const rtmpChunks = this.rtmpChunksCreate(packet);
        const flvTag = NodeFlvSession.createFlvTag(packet);

        for (const playerId of this.players) {
          const playerSession = context.sessions.get(playerId);
          if (playerSession instanceof NodeRtmpSession) {
            if (playerSession.isStarting && playerSession.isPlaying && !playerSession.isPause) {
              rtmpChunks.writeUInt32LE(playerSession.playStreamId, 8);
              playerSession.socket.write(rtmpChunks);
            }
          } else if (playerSession instanceof NodeFlvSession) {
            playerSession.res.write(flvTag, null, () => {
              // websocket will throw a error if not set the cb when closed
            });
          }
        }
        break;
      }
      default:
        console.error("can't match");
    }
  }

  rtmpInvokeHandler() {
    const offset = this.parserPacket.header.type === RTMP_TYPE_FLEX_MESSAGE ? 1 : 0;
    const payload = this.parserPacket.payload.slice(offset, this.parserPacket.header.length);
    const invokeMessage = AMF.decodeAmf0Cmd(payload);
    // console.log(invokeMessage);
    switch (invokeMessage.cmd) {
      case 'connect':
        this.onConnect(invokeMessage);
        break;
      case 'releaseStream':
        break;
      case 'FCPublish':
        break;
      case 'createStream':
        this.onCreateStream(invokeMessage);
        break;
      case 'publish':
        this.onPublish(invokeMessage);
        break;
      case 'play':
        this.onPlay(invokeMessage);
        break;
      case 'pause':
        this.onPause(invokeMessage);
        break;
      case 'FCUnpublish':
        break;
      case 'deleteStream':
        this.onDeleteStream(invokeMessage);
        break;
      case 'closeStream':
        this.onCloseStream();
        break;
      case 'receiveAudio':
        this.onReceiveAudio(invokeMessage);
        break;
      case 'receiveVideo':
        this.onReceiveVideo(invokeMessage);
        break;
      default:
        console.error("can't match");
    }
  }

  sendACK(size) {
    const rtmpBuffer = Buffer.from('02000000000004030000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    this.socket.write(rtmpBuffer);
  }

  sendWindowACK(size) {
    const rtmpBuffer = Buffer.from('02000000000004050000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    this.socket.write(rtmpBuffer);
  }

  setPeerBandwidth(size, type) {
    const rtmpBuffer = Buffer.from('0200000000000506000000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    rtmpBuffer[16] = type;
    this.socket.write(rtmpBuffer);
  }

  setChunkSize(size) {
    const rtmpBuffer = Buffer.from('02000000000004010000000000000000', 'hex');
    rtmpBuffer.writeUInt32BE(size, 12);
    this.socket.write(rtmpBuffer);
  }

  sendStreamStatus(st, id) {
    const rtmpBuffer = Buffer.from('020000000000060400000000000000000000', 'hex');
    rtmpBuffer.writeUInt16BE(st, 12);
    rtmpBuffer.writeUInt32BE(id, 14);
    this.socket.write(rtmpBuffer);
  }

  sendInvokeMessage(sid, opt) {
    const packet = RtmpPacket.create();
    packet.header.fmt = RTMP_CHUNK_TYPE_0;
    packet.header.cid = RTMP_CHANNEL_INVOKE;
    packet.header.type = RTMP_TYPE_INVOKE;
    packet.header.stream_id = sid;
    packet.payload = AMF.encodeAmf0Cmd(opt);
    packet.header.length = packet.payload.length;
    const chunks = this.rtmpChunksCreate(packet);
    this.socket.write(chunks);
  }

  sendDataMessage(opt, sid) {
    const packet = RtmpPacket.create();
    packet.header.fmt = RTMP_CHUNK_TYPE_0;
    packet.header.cid = RTMP_CHANNEL_DATA;
    packet.header.type = RTMP_TYPE_DATA;
    packet.payload = AMF.encodeAmf0Data(opt);
    packet.header.length = packet.payload.length;
    packet.header.stream_id = sid;
    const chunks = this.rtmpChunksCreate(packet);
    this.socket.write(chunks);
  }

  sendStatusMessage(sid, level, code, description) {
    const opt = {
      cmd: 'onStatus',
      transId: 0,
      cmdObj: null,
      info: {
        level,
        code,
        description,
      },
    };
    this.sendInvokeMessage(sid, opt);
  }

  sendRtmpSampleAccess(sid) {
    const opt = {
      cmd: '|RtmpSampleAccess',
      bool1: false,
      bool2: false,
    };
    this.sendDataMessage(opt, sid);
  }

  sendPingRequest() {
    const currentTimestamp = Date.now() - this.startTimestamp;
    const packet = RtmpPacket.create();
    packet.header.fmt = RTMP_CHUNK_TYPE_0;
    packet.header.cid = RTMP_CHANNEL_PROTOCOL;
    packet.header.type = RTMP_TYPE_EVENT;
    packet.header.timestamp = currentTimestamp;
    packet.payload = Buffer.from([ 0, 6, (currentTimestamp >> 24) & 0xff, (currentTimestamp >> 16) & 0xff, (currentTimestamp >> 8) & 0xff, currentTimestamp & 0xff ]);
    packet.header.length = packet.payload.length;
    const chunks = this.rtmpChunksCreate(packet);
    this.socket.write(chunks);
  }

  respondConnect(tid) {
    const opt = {
      cmd: '_result',
      transId: tid,
      cmdObj: {
        fmsVer: 'FMS/3,0,1,123',
        capabilities: 31,
      },
      info: {
        level: 'status',
        code: 'NetConnection.Connect.Success',
        description: 'Connection succeeded.',
        objectEncoding: this.objectEncoding,
      },
    };
    this.sendInvokeMessage(0, opt);
  }

  respondCreateStream(tid) {
    this.streams++;
    const opt = {
      cmd: '_result',
      transId: tid,
      cmdObj: null,
      info: this.streams,
    };
    this.sendInvokeMessage(0, opt);
  }

  respondPlay() {
    this.sendStreamStatus(STREAM_BEGIN, this.playStreamId);
    this.sendStatusMessage(this.playStreamId, 'status', 'NetStream.Play.Reset', 'Playing and resetting stream.');
    this.sendStatusMessage(this.playStreamId, 'status', 'NetStream.Play.Start', 'Started playing stream.');
    this.sendRtmpSampleAccess();
  }

  onConnect(invokeMessage) {
    invokeMessage.cmdObj.app = invokeMessage.cmdObj.app.replace('/', ''); // fix jwplayer
    if (!this.isIPC) {
      context.nodeEvent.emit('preConnect', this.id, invokeMessage.cmdObj);
    }
    if (!this.isStarting) {
      return;
    }
    this.connectCmdObj = invokeMessage.cmdObj;
    this.appname = invokeMessage.cmdObj.app;
    this.objectEncoding = invokeMessage.cmdObj.objectEncoding !== null ? invokeMessage.cmdObj.objectEncoding : 0;
    this.connectTime = new Date();
    this.startTimestamp = Date.now();
    this.pingInterval = setInterval(() => {
      this.sendPingRequest();
    }, this.pingTime);
    this.sendWindowACK(5000000);
    this.setPeerBandwidth(5000000, 2);
    this.setChunkSize(this.outChunkSize);
    this.respondConnect(invokeMessage.transId);
    if (!this.isIPC) {
      console.log(`[rtmp connect] id=${this.id} ip=${this.ip} app=${this.appname} args=${JSON.stringify(invokeMessage.cmdObj)}`);
      context.nodeEvent.emit('postConnect', this.id, invokeMessage.cmdObj);
    }
  }

  onCreateStream(invokeMessage) {
    this.respondCreateStream(invokeMessage.transId);
  }

  onPublish(invokeMessage) {
    if (typeof invokeMessage.streamName !== 'string') {
      // Wirecast fix #67
      /**
       * String 'publish'
       * Number 0
       * Null
       * Boolean false ??? 这是要爪子?
       */
      return;
    }
    this.publishStreamPath = '/' + this.appname + '/' + invokeMessage.streamName.split('?')[0];
    this.publishArgs = QueryString.parse(invokeMessage.streamName.split('?')[1]);
    this.publishStreamId = this.parserPacket.header.stream_id;
    if (!this.isIPC) {
      context.nodeEvent.emit('prePublish', this.id, this.publishStreamPath, this.publishArgs);
    }
    if (!this.isStarting) {
      return;
    }

    if (this.config.auth && this.config.auth.publish && !this.isLocal && !this.isIPC) {
      const results = NodeCoreUtils.verifyAuth(this.publishArgs.sign, this.publishStreamPath, this.config.auth.secret);
      if (!results) {
        console.log(`[rtmp publish] Unauthorized. id=${this.id} streamPath=${this.publishStreamPath} streamId=${this.publishStreamId} sign=${this.publishArgs.sign} `);
        this.sendStatusMessage(this.publishStreamId, 'error', 'NetStream.publish.Unauthorized', 'Authorization required.');
        return;
      }
    }

    if (context.publishers.has(this.publishStreamPath)) {
      console.log(`[rtmp publish] Already has a stream. id=${this.id} streamPath=${this.publishStreamPath} streamId=${this.publishStreamId}`);
      this.sendStatusMessage(this.publishStreamId, 'error', 'NetStream.Publish.BadName', 'Stream already publishing');
    } else if (this.isPublishing) {
      console.log(`[rtmp publish] NetConnection is publishing. id=${this.id} streamPath=${this.publishStreamPath} streamId=${this.publishStreamId}`);
      this.sendStatusMessage(this.publishStreamId, 'error', 'NetStream.Publish.BadConnection', 'Connection already publishing');
    } else {
      if (!this.isIPC) {
        console.log(`[rtmp publish] New stream. id=${this.id} streamPath=${this.publishStreamPath} streamId=${this.publishStreamId}`);
      }
      context.publishers.set(this.publishStreamPath, this.id);
      this.isPublishing = true;

      this.sendStatusMessage(this.publishStreamId, 'status', 'NetStream.Publish.Start', `${this.publishStreamPath} is now published.`);
      for (const idlePlayerId of context.idlePlayers) {
        const idlePlayer = context.sessions.get(idlePlayerId);
        if (idlePlayer.playStreamPath === this.publishStreamPath) {
          idlePlayer.onStartPlay();
          context.idlePlayers.delete(idlePlayerId);
        }
      }
      setTimeout(() => {
        this.publishArgs.ac = this.audioCodec;
        this.publishArgs.vc = this.videoCodec;
        if (!this.isIPC) {
          context.nodeEvent.emit('postPublish', this.id, this.publishStreamPath, this.publishArgs);
        }
      }, 200);// 200毫秒后基本上能得到音视频编码信息，这时候再发出事件，便于转码器做判断

    }
  }

  onPlay(invokeMessage) {
    if (typeof invokeMessage.streamName !== 'string') {
      return;
    }
    this.playStreamPath = '/' + this.appname + '/' + invokeMessage.streamName.split('?')[0];
    this.playArgs = QueryString.parse(invokeMessage.streamName.split('?')[1]);
    this.playStreamId = this.parserPacket.header.stream_id;
    if (!this.isIPC) {
      context.nodeEvent.emit('prePlay', this.id, this.playStreamPath, this.playArgs);
    }
    if (!this.isStarting) {
      return;
    }

    if (this.config.auth && this.config.auth.play && !this.isLocal && !this.isIPC) {
      const results = NodeCoreUtils.verifyAuth(this.playArgs.sign, this.playStreamPath, this.config.auth.secret);
      if (!results) {
        console.log(`[rtmp play] Unauthorized. id=${this.id} streamPath=${this.playStreamPath}  streamId=${this.playStreamId} sign=${this.playArgs.sign}`);
        this.sendStatusMessage(this.playStreamId, 'error', 'NetStream.play.Unauthorized', 'Authorization required.');
        return;
      }
    }

    if (this.isPlaying) {
      if (!this.isIPC) {
        console.log(`[rtmp play] NetConnection is playing. id=${this.id} streamPath=${this.playStreamPath}  streamId=${this.playStreamId} `);
      }
      this.sendStatusMessage(this.playStreamId, 'error', 'NetStream.Play.BadConnection', 'Connection already playing');
    } else {
      this.respondPlay();
    }

    if (context.publishers.has(this.playStreamPath)) {
      this.onStartPlay();
    } else {
      console.log(`[rtmp play] Stream not found. id=${this.id} streamPath=${this.playStreamPath}  streamId=${this.playStreamId}`);
      this.isIdling = true;
      context.idlePlayers.add(this.id);
    }

  }

  onStartPlay() {
    const publisherId = context.publishers.get(this.playStreamPath);
    const publisher = context.sessions.get(publisherId);
    const players = publisher.players;
    players.add(this.id);

    if (publisher.metaData !== null) {
      const packet = RtmpPacket.create();
      packet.header.fmt = RTMP_CHUNK_TYPE_0;
      packet.header.cid = RTMP_CHANNEL_DATA;
      packet.header.type = RTMP_TYPE_DATA;
      packet.payload = publisher.metaData;
      packet.header.length = packet.payload.length;
      packet.header.stream_id = this.playStreamId;
      const chunks = this.rtmpChunksCreate(packet);
      this.socket.write(chunks);
    }

    if (publisher.audioCodec === 10) {
      const packet = RtmpPacket.create();
      packet.header.fmt = RTMP_CHUNK_TYPE_0;
      packet.header.cid = RTMP_CHANNEL_AUDIO;
      packet.header.type = RTMP_TYPE_AUDIO;
      packet.payload = publisher.aacSequenceHeader;
      packet.header.length = packet.payload.length;
      packet.header.stream_id = this.playStreamId;
      const chunks = this.rtmpChunksCreate(packet);
      this.socket.write(chunks);
    }

    if (publisher.videoCodec === 7 || publisher.videoCodec === 12) {
      const packet = RtmpPacket.create();
      packet.header.fmt = RTMP_CHUNK_TYPE_0;
      packet.header.cid = RTMP_CHANNEL_VIDEO;
      packet.header.type = RTMP_TYPE_VIDEO;
      packet.payload = publisher.avcSequenceHeader;
      packet.header.length = packet.payload.length;
      packet.header.stream_id = this.playStreamId;
      const chunks = this.rtmpChunksCreate(packet);
      this.socket.write(chunks);
    }

    if (publisher.rtmpGopCacheQueue !== null) {
      for (const chunks of publisher.rtmpGopCacheQueue) {
        chunks.writeUInt32LE(this.playStreamId, 8);
        this.socket.write(chunks);
      }
    }

    this.isIdling = false;
    this.isPlaying = true;
    if (!this.isIPC) {
      context.nodeEvent.emit('postPlay', this.id, this.playStreamPath, this.playArgs);
      console.log(`[rtmp play] Join stream. id=${this.id} streamPath=${this.playStreamPath}  streamId=${this.playStreamId} `);
    }
  }

  onPause(invokeMessage) {
    this.isPause = invokeMessage.pause;
    const c = this.isPause ? 'NetStream.Pause.Notify' : 'NetStream.Unpause.Notify';
    const d = this.isPause ? 'Paused live' : 'Unpaused live';
    console.log(`[rtmp play] ${d} stream. id=${this.id} streamPath=${this.playStreamPath}  streamId=${this.playStreamId} `);
    if (!this.isPause) {
      this.sendStreamStatus(STREAM_BEGIN, this.playStreamId);
      if (context.publishers.has(this.playStreamPath)) {
        // fix ckplayer
        const publisherId = context.publishers.get(this.playStreamPath);
        const publisher = context.sessions.get(publisherId);
        if (publisher.audioCodec === 10) {
          const packet = RtmpPacket.create();
          packet.header.fmt = RTMP_CHUNK_TYPE_0;
          packet.header.cid = RTMP_CHANNEL_AUDIO;
          packet.header.type = RTMP_TYPE_AUDIO;
          packet.payload = publisher.aacSequenceHeader;
          packet.header.length = packet.payload.length;
          packet.header.stream_id = this.playStreamId;
          packet.header.timestamp = publisher.parserPacket.clock; // ?? 0 or clock
          const chunks = this.rtmpChunksCreate(packet);
          this.socket.write(chunks);
        }
        if (publisher.videoCodec === 7 || publisher.videoCodec === 12) {
          const packet = RtmpPacket.create();
          packet.header.fmt = RTMP_CHUNK_TYPE_0;
          packet.header.cid = RTMP_CHANNEL_VIDEO;
          packet.header.type = RTMP_TYPE_VIDEO;
          packet.payload = publisher.avcSequenceHeader;
          packet.header.length = packet.payload.length;
          packet.header.stream_id = this.playStreamId;
          packet.header.timestamp = publisher.parserPacket.clock;// ?? 0 or clock
          const chunks = this.rtmpChunksCreate(packet);
          this.socket.write(chunks);
        }
      }

    } else {
      this.sendStreamStatus(STREAM_EOF, this.playStreamId);
    }
    this.sendStatusMessage(this.playStreamId, c, d);
  }

  onReceiveAudio(invokeMessage) {
    this.isReceiveAudio = invokeMessage.bool;
    console.log(`[rtmp play] receiveAudio=${this.isReceiveAudio} id=${this.id} `);
  }

  onReceiveVideo(invokeMessage) {
    this.isReceiveVideo = invokeMessage.bool;
    console.log(`[rtmp play] receiveVideo=${this.isReceiveVideo} id=${this.id} `);
  }

  onCloseStream() {
    // red5-publisher
    const closeStream = { streamId: this.parserPacket.header.stream_id };
    this.onDeleteStream(closeStream);
  }

  onDeleteStream(invokeMessage) {
    if (invokeMessage.streamId === this.playStreamId) {
      if (this.isIdling) {
        context.idlePlayers.delete(this.id);
        this.isIdling = false;
      } else {
        const publisherId = context.publishers.get(this.playStreamPath);
        if (publisherId !== null) {
          context.sessions.get(publisherId).players.delete(this.id);
        }
        if (!this.isIPC) {
          context.nodeEvent.emit('donePlay', this.id, this.playStreamPath, this.playArgs);
        }
        this.isPlaying = false;
      }
      if (!this.isIPC) {
        console.log(`[rtmp play] Close stream. id=${this.id} streamPath=${this.playStreamPath} streamId=${this.playStreamId}`);
      }
      if (this.isStarting) {
        this.sendStatusMessage(this.playStreamId, 'status', 'NetStream.Play.Stop', 'Stopped playing stream.');
      }
      this.playStreamId = 0;
      this.playStreamPath = '';
    }

    if (invokeMessage.streamId === this.publishStreamId) {
      if (this.isPublishing) {
        if (!this.isIPC) {
          console.log(`[rtmp publish] Close stream. id=${this.id} streamPath=${this.publishStreamPath} streamId=${this.publishStreamId}`);
          context.nodeEvent.emit('donePublish', this.id, this.publishStreamPath, this.publishArgs);
        }
        if (this.isStarting) {
          this.sendStatusMessage(this.publishStreamId, 'status', 'NetStream.Unpublish.Success', `${this.publishStreamPath} is now unpublished.`);
        }

        for (const playerId of this.players) {
          const player = context.sessions.get(playerId);
          if (player instanceof NodeRtmpSession) {
            player.sendStatusMessage(player.playStreamId, 'status', 'NetStream.Play.UnpublishNotify', 'stream is now unpublished.');
          } else {
            player.stop();
          }
        }

        // let the players to idlePlayers
        for (const playerId of this.players) {
          const player = context.sessions.get(playerId);
          context.idlePlayers.add(playerId);
          player.isPlaying = false;
          player.isIdling = true;
          if (player instanceof NodeRtmpSession) {
            player.sendStreamStatus(STREAM_EOF, player.playStreamId);
          }
        }

        context.publishers.delete(this.publishStreamPath);
        if (this.rtmpGopCacheQueue) {
          this.rtmpGopCacheQueue.clear();
        }
        if (this.flvGopCacheQueue) {
          this.flvGopCacheQueue.clear();
        }
        this.players.clear();
        this.isPublishing = false;
      }
      this.publishStreamId = 0;
      this.publishStreamPath = '';
    }
  }
}

module.exports = NodeRtmpSession;
