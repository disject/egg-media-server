'use strict';
/**
 * Created by delian on 3/12/14.
 * This module provides encoding and decoding of the AMF0 and AMF3 format
 */

const amf3dRules = {
  0x00: amf3decUndefined,
  0x01: amf3decNull,
  0x02: amf3decFalse,
  0x03: amf3decTrue,
  0x04: amf3decInteger,
  0x05: amf3decDouble,
  0x06: amf3decString,
  0x07: amf3decXmlDoc,
  0x08: amf3decDate,
  0x09: amf3decArray,
  0x0A: amf3decObject,
  0x0B: amf3decXml,
  0x0C: amf3decByteArray, // ,
  //    0x0D: amf3decVecInt,
  //    0x0E: amf3decVecUInt,
  //    0x0F: amf3decVecDouble,
  //    0x10: amf3decVecObject,
  //    0x11: amf3decDict // No dictionary support for the moment!
};

const amf3eRules = {
  string: amf3encString,
  integer: amf3encInteger,
  double: amf3encDouble,
  xml: amf3encXmlDoc,
  object: amf3encObject,
  array: amf3encArray,
  sarray: amf3encArray,
  binary: amf3encByteArray,
  true: amf3encTrue,
  false: amf3encFalse,
  undefined: amf3encUndefined,
  null: amf3encNull,
};

const amf0dRules = {
  0x00: amf0decNumber,
  0x01: amf0decBool,
  0x02: amf0decString,
  0x03: amf0decObject,
  //    0x04: amf0decMovie, // Reserved
  0x05: amf0decNull,
  0x06: amf0decUndefined,
  0x07: amf0decRef,
  0x08: amf0decArray,
  // 0x09: amf0decObjEnd, // Should never happen normally
  0x0A: amf0decSArray,
  0x0B: amf0decDate,
  0x0C: amf0decLongString,
  //    0x0D: amf0decUnsupported, // Has been never originally implemented by Adobe!
  //    0x0E: amf0decRecSet, // Has been never originally implemented by Adobe!
  0x0F: amf0decXmlDoc,
  0x10: amf0decTypedObj,
  0x11: amf0decSwitchAmf3,
};

const amf0eRules = {
  string: amf0encString,
  integer: amf0encNumber,
  double: amf0encNumber,
  xml: amf0encXmlDoc,
  object: amf0encObject,
  array: amf0encArray,
  sarray: amf0encSArray,
  binary: amf0encString,
  true: amf0encBool,
  false: amf0encBool,
  undefined: amf0encUndefined,
  null: amf0encNull,
};

function amfType(o) {
  const jsType = typeof o;

  if (o === null) return 'null';
  if (jsType === 'undefined') return 'undefined';
  if (jsType === 'number') {
    if (parseInt(o) === o) return 'integer';
    return 'double';
  }
  if (jsType === 'boolean') return o ? 'true' : 'false';
  if (jsType === 'string') return 'string';
  if (jsType === 'object') {
    if (o instanceof Array) {
      if (o.sarray) return 'sarray';
      return 'array';
    }
    return 'object';
  }
  throw new Error('Unsupported type!');
}

// AMF3 implementation

/**
 * AMF3 Decode undefined value
 * @return {{len: number, value: undefined}}
 */
function amf3decUndefined() {
  return { len: 1, value: undefined };
}

/**
 * AMF3 Encode undefined value
 * @return {Buffer}
 */
function amf3encUndefined() {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x00);
  return buf;
}

/**
 * AMF3 Decode null
 * @return {{len: number, value: null}}
 */
function amf3decNull() {
  return { len: 1, value: null };
}

/**
 * AMF3 Encode null
 * @return {Buffer}
 */
function amf3encNull() {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x01);
  return buf;
}

/**
 * AMF3 Decode false
 * @return {{len: number, value: boolean}}
 */
function amf3decFalse() {
  return { len: 1, value: false };
}

/**
 * AMF3 Encode false
 * @return {Buffer}
 */
function amf3encFalse() {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x02);
  return buf;
}

/**
 * AMF3 Decode true
 * @return {{len: number, value: boolean}}
 */
function amf3decTrue() {
  return { len: 1, value: true };
}

/**
 * AMF3 Encode true
 * @return {Buffer}
 */
function amf3encTrue() {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x03);
  return buf;
}

/**
 * Generic decode of AMF3 UInt29 values
 * @param buf
 * @return {{len: number, value: number}}
 */
function amf3decUI29(buf) {
  let val = 0;
  let len = 1;
  let b;

  do {
    b = buf.readUInt8(len++);
    val = (val << 7) + (b & 0x7F);
  } while (len < 5 || b > 0x7F);

  if (len === 5) val = val | b; // Preserve the major bit of the last byte

  return { len, value: val };
}

/**
 * Generic encode of AMF3 UInt29 value
 * @param num
 * @return {Buffer}
 */
function amf3encUI29(num) {
  let len = 0;
  if (num < 0x80) len = 1;
  if (num < 0x4000) len = 2;
  if (num < 0x200000) len = 3;
  if (num >= 0x200000) len = 4;
  const buf = Buffer.alloc(len);
  switch (len) {
    case 1:
      buf.writeUInt8(num, 0);
      break;
    case 2:
      buf.writeUInt8(num & 0x7F, 0);
      buf.writeUInt8((num >> 7) | 0x80, 1);
      break;
    case 3:
      buf.writeUInt8(num & 0x7F, 0);
      buf.writeUInt8((num >> 7) & 0x7F, 1);
      buf.writeUInt8((num >> 14) | 0x80, 2);
      break;
    case 4:
      buf.writeUInt8(num & 0xFF, 0);
      buf.writeUInt8((num >> 8) & 0x7F, 1);
      buf.writeUInt8((num >> 15) | 0x7F, 2);
      buf.writeUInt8((num >> 22) | 0x7F, 3);
      break;
    default:
      console.log("can't match");
  }
  return buf;
}

/**
 * AMF3 Decode an integer
 * @param buf
 * @return {{len: number, value: number}}
 */
function amf3decInteger(buf) { // Invert the integer
  const resp = amf3decUI29(buf);
  if (resp.value > 0x0FFFFFFF) resp.value = (resp.value & 0x0FFFFFFF) - 0x10000000;
  return resp;
}

/**
 * AMF3 Encode an integer
 * @param num
 * @return {Buffer}
 */
function amf3encInteger(num) {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x4, 0);
  return Buffer.concat([ buf, amf3encUI29(num & 0x3FFFFFFF) ]); // This AND will auto convert the sign bit!
}

/**
 * AMF3 Decode String
 * @param buf
 * @return {{len: *, value: (*|String)}}
 */
function amf3decString(buf) {
  let sLen = amf3decUI29(buf);
  const s = sLen & 1;
  sLen = sLen >> 1; // The real length without the lowest bit
  if (s) return { len: sLen.value + 5, value: buf.slice(5, sLen.value + 5).toString('utf8') };
  throw new Error('Error, we have a need to decode a String that is a Reference'); // TODO: Implement references!
}

/**
 * AMF3 Encode String
 * @param str
 * @return {Buffer}
 */
function amf3encString(str) {
  const sLen = amf3encUI29(str.length << 1);
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x6, 0);
  return Buffer.concat([ buf, sLen, Buffer.from(str, 'utf8') ]);
}

/**
 * AMF3 Decode XMLDoc
 * @param buf
 * @return {{len: *, value: (*|String)}}
 */
function amf3decXmlDoc(buf) {
  let sLen = amf3decUI29(buf);
  const s = sLen & 1;
  sLen = sLen >> 1; // The real length without the lowest bit
  if (s) return { len: sLen.value + 5, value: buf.slice(5, sLen.value + 5).toString('utf8') };
  throw new Error('Error, we have a need to decode a String that is a Reference'); // TODO: Implement references!
}

/**
 * AMF3 Encode XMLDoc
 * @param str
 * @return {Buffer}
 */
function amf3encXmlDoc(str) {
  const sLen = amf3encUI29(str.length << 1);
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x7, 0);
  return Buffer.concat([ buf, sLen, Buffer.from(str, 'utf8') ]);
}

/**
 * AMF3 Decode Generic XML
 * @param buf
 * @return {{len: *, value: (*|String)}}
 */
function amf3decXml(buf) {
  let sLen = amf3decUI29(buf);
  const s = sLen & 1;
  sLen = sLen >> 1; // The real length without the lowest bit
  if (s) return { len: sLen.value + 5, value: buf.slice(5, sLen.value + 5).toString('utf8') };
  throw new Error('Error, we have a need to decode a String that is a Reference'); // TODO: Implement references!
}

/**
 * AMF3 Encode Generic XML
 * @param str
 * @return {Buffer}
 */
function amf3encXml(str) {
  const sLen = amf3encUI29(str.length << 1);
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x0B, 0);
  return Buffer.concat([ buf, sLen, Buffer.from(str, 'utf8') ]);
}

/**
 * AMF3 Decide Byte Array
 * @param buf
 * @return {{len: *, value: (Array|string|*|Buffer|Blob)}}
 */
function amf3decByteArray(buf) {
  let sLen = amf3decUI29(buf);
  const s = sLen & 1; // TODO: Check if we follow the same rule!
  sLen = sLen >> 1; // The real length without the lowest bit
  if (s) return { len: sLen.value + 5, value: buf.slice(5, sLen.value + 5) };
  throw new Error('Error, we have a need to decode a String that is a Reference'); // TODO: Implement references!
}

/**
 * AMF3 Encode Byte Array
 * @param str
 * @return {Buffer}
 */
function amf3encByteArray(str) {
  const sLen = amf3encUI29(str.length << 1);
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x0C, 0);
  return Buffer.concat([ buf, sLen, (typeof str === 'string') ? Buffer.from(str, 'binary') : str ]);
}

/**
 * AMF3 Decode Double
 * @param buf
 * @return {{len: number, value: (*|Number)}}
 */
function amf3decDouble(buf) {
  return { len: 9, value: buf.readDoubleBE(1) };
}

/**
 * AMF3 Encode Double
 * @param num
 * @return {Buffer}
 */
function amf3encDouble(num) {
  const buf = Buffer.alloc(9);
  buf.writeUInt8(0x05, 0);
  buf.writeDoubleBE(num, 1);
  return buf;
}

/**
 * AMF3 Decode Date
 * @param buf
 * @return {{len: *, value: (*|Number)}}
 */
function amf3decDate(buf) { // The UI29 should be 1
  const uTz = amf3decUI29(buf);
  const ts = buf.readDoubleBE(uTz.len);
  return { len: uTz.len + 8, value: ts };
}

/**
 * AMF3 Encode Date
 * @param ts
 * @return {Buffer}
 */
function amf3encDate(ts) {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x8, 0);
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeDoubleBE(ts, 0);
  return Buffer.concat([ buf, amf3encUI29(1), tsBuf ]); // We always do 1
}

/**
 * AMF3 Decode Array
 * @param buf
 * @return {{len: *, value: *}}
 */
function amf3decArray(buf) {
  const count = amf3decUI29(buf.slice(1));
  const obj = amf3decObject(buf.slice(count.len));
  if (count.value % 2 === 1) throw new Error("This is a reference to another array, which currently we don't support!");
  return { len: count.len + obj.len, value: obj.value };
}

/**
 * AMF3 Encode Array
 */
function amf3encArray() {
  throw new Error('Encoding arrays is not supported yet!'); // TODO: Implement encoding of arrays
}

/**
 * AMF3 Decode Object
 * @param buf
 */
function amf3decObject() {
  const obj = {};
  return obj;
}

/**
 * AMF3 Encode Object
 * @param o
 */
function amf3encObject() {

}

// AMF0 Implementation

/**
 * AMF0 Decode Number
 * @param buf
 * @return {{len: number, value: (*|Number)}}
 */
function amf0decNumber(buf) {
  return { len: 9, value: buf.readDoubleBE(1) };
}

/**
 * AMF0 Encode Number
 * @param num
 * @return {Buffer}
 */
function amf0encNumber(num) {
  const buf = Buffer.alloc(9);
  buf.writeUInt8(0x00, 0);
  buf.writeDoubleBE(num, 1);
  return buf;
}

/**
 * AMF0 Decode Boolean
 * @param buf
 * @return {{len: number, value: boolean}}
 */
function amf0decBool(buf) {
  return { len: 2, value: (buf.readUInt8(1) !== 0) };
}

/**
 * AMF0 Encode Boolean
 * @param num
 * @return {Buffer}
 */
function amf0encBool(num) {
  const buf = Buffer.alloc(2);
  buf.writeUInt8(0x01, 0);
  buf.writeUInt8((num ? 1 : 0), 1);
  return buf;
}

/**
 * AMF0 Decode Null
 * @return {{len: number, value: null}}
 */
function amf0decNull() {
  return { len: 1, value: null };
}

/**
 * AMF0 Encode Null
 * @return {Buffer}
 */
function amf0encNull() {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x05, 0);
  return buf;
}

/**
 * AMF0 Decode Undefined
 * @return {{len: number, value: undefined}}
 */
function amf0decUndefined() {
  return { len: 1, value: undefined };
}

/**
 * AMF0 Encode Undefined
 * @return {Buffer}
 */
function amf0encUndefined() {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x06, 0);
  return buf;
}

/**
 * AMF0 Decode Date
 * @param buf
 * @return {{len: number, value: (*|Number)}}
 */
function amf0decDate(buf) {
  //    let s16 = buf.readInt16BE(1);
  const ts = buf.readDoubleBE(3);
  return { len: 11, value: ts };
}

/**
 * AMF0 Encode Date
 * @param ts
 * @return {Buffer}
 */
function amf0encDate(ts) {
  const buf = Buffer.alloc(11);
  buf.writeUInt8(0x0B, 0);
  buf.writeInt16BE(0, 1);
  buf.writeDoubleBE(ts, 3);
  return buf;
}

/**
 * AMF0 Decode Object
 * @param buf
 * @return {{len: number, value: {}}}
 */
function amf0decObject(buf) { // TODO: Implement references!
  const obj = {};
  let iBuf = buf.slice(1);
  let len = 1;
  //    console.debug('ODec',iBuf.readUInt8(0));
  while (iBuf.readUInt8(0) !== 0x09) {
    // console.debug('Field', iBuf.readUInt8(0), iBuf);
    const prop = amf0decUString(iBuf);
    // console.debug('Got field for property', prop);
    len += prop.len;
    if (iBuf.length < prop.len) {
      break;
    }
    if (iBuf.slice(prop.len).readUInt8(0) === 0x09) {
      len++;
      // console.debug('Found the end property');
      break;
    } // END Object as value, we shall leave
    if (prop.value === '') break;
    const val = amf0DecodeOne(iBuf.slice(prop.len));
    // console.debug('Got field for value', val);
    obj[prop.value] = val.value;
    len += val.len;
    iBuf = iBuf.slice(prop.len + val.len);
  }
  return { len, value: obj };
}

/**
 * AMF0 Encode Object
 */
function amf0encObject(o) {
  if (typeof o !== 'object') return;

  let data = Buffer.alloc(1);
  data.writeUInt8(0x03, 0); // Type object
  let k;
  for (k in o) {
    data = Buffer.concat([ data, amf0encUString(k), amf0EncodeOne(o[k]) ]);
  }
  const termCode = Buffer.alloc(1);
  termCode.writeUInt8(0x09, 0);
  return Buffer.concat([ data, amf0encUString(''), termCode ]);
}

/**
 * AMF0 Decode Reference
 * @param buf
 * @return {{len: number, value: string}}
 */
function amf0decRef(buf) {
  const index = buf.readUInt16BE(1);
  return { len: 3, value: 'ref' + index };
}

/**
 * AMF0 Encode Reference
 * @param index
 * @return {Buffer}
 */
function amf0encRef(index) {
  const buf = Buffer.alloc(3);
  buf.writeUInt8(0x07, 0);
  buf.writeUInt16BE(index, 1);
  return buf;
}

/**
 * AMF0 Decode String
 * @param buf
 * @return {{len: *, value: (*|string|String)}}
 */
function amf0decString(buf) {
  const sLen = buf.readUInt16BE(1);
  return { len: 3 + sLen, value: buf.toString('utf8', 3, 3 + sLen) };
}

/**
 * AMF0 Decode Untyped (without the type byte) String
 * @param buf
 * @return {{len: *, value: (*|string|String)}}
 */
function amf0decUString(buf) {
  const sLen = buf.readUInt16BE(0);
  return { len: 2 + sLen, value: buf.toString('utf8', 2, 2 + sLen) };
}

/**
 * Do AMD0 Encode of Untyped String
 * @param s
 * @return {Buffer}
 */
function amf0encUString(str) {
  const data = Buffer.from(str, 'utf8');
  const sLen = Buffer.alloc(2);
  sLen.writeUInt16BE(data.length, 0);
  return Buffer.concat([ sLen, data ]);
}

/**
 * AMF0 Encode String
 * @param str
 * @return {Buffer}
 */
function amf0encString(str) {
  const buf = Buffer.alloc(3);
  buf.writeUInt8(0x02, 0);
  buf.writeUInt16BE(str.length, 1);
  return Buffer.concat([ buf, Buffer.from(str, 'utf8') ]);
}

/**
 * AMF0 Decode Long String
 * @param buf
 * @return {{len: *, value: (*|string|String)}}
 */
function amf0decLongString(buf) {
  const sLen = buf.readUInt32BE(1);
  return { len: 5 + sLen, value: buf.toString('utf8', 5, 5 + sLen) };
}

/**
 * AMF0 Encode Long String
 * @param str
 * @return {Buffer}
 */
function amf0encLongString(str) {
  const buf = Buffer.alloc(5);
  buf.writeUInt8(0x0C, 0);
  buf.writeUInt32BE(str.length, 1);
  return Buffer.concat([ buf, Buffer.from(str, 'utf8') ]);
}

/**
 * AMF0 Decode Array
 * @param buf
 * @return {{len: *, value: ({}|*)}}
 */
function amf0decArray(buf) {
  //    let count = buf.readUInt32BE(1);
  const obj = amf0decObject(buf.slice(4));
  return { len: 5 + obj.len, value: obj.value };
}

/**
 * AMF0 Encode Array
 */
function amf0encArray(a) {
  let l = 0;
  if (a instanceof Array) l = a.length; else l = Object.keys(a).length;
  console.debug('Array encode', l, a);
  const buf = Buffer.alloc(5);
  buf.writeUInt8(8, 0);
  buf.writeUInt32BE(l, 1);
  const data = amf0encObject(a);
  return Buffer.concat([ buf, data.slice(1) ]);
}

/**
 * AMF0 Encode Binary Array into binary Object
 * @param aData
 * @return {Buffer}
 */
function amf0cnletray2Object(aData) {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(0x3, 0); // Object id
  return Buffer.concat([ buf, aData.slice(5) ]);
}

/**
 * AMF0 Encode Binary Object into binary Array
 * @param oData
 * @return {Buffer}
 */
function amf0cnvObject2Array(oData) {
  const buf = Buffer.alloc(5);
  const o = amf0decObject(oData);
  const l = Object.keys(o).length;
  buf.writeUInt32BE(l, 1);
  return Buffer.concat([ buf, oData.slice(1) ]);
}

/**
 * AMF0 Decode XMLDoc
 * @param buf
 * @return {{len: *, value: (*|string|String)}}
 */
function amf0decXmlDoc(buf) {
  const sLen = buf.readUInt16BE(1);
  return { len: 3 + sLen, value: buf.toString('utf8', 3, 3 + sLen) };
}

/**
 * AMF0 Encode XMLDoc
 * @param str
 * @return {Buffer}
 */
function amf0encXmlDoc(str) { // Essentially it is the same as string
  const buf = Buffer.alloc(3);
  buf.writeUInt8(0x0F, 0);
  buf.writeUInt16BE(str.length, 1);
  return Buffer.concat([ buf, Buffer.from(str, 'utf8') ]);
}

/**
 * AMF0 Decode Strict Array
 * @param buf
 * @return {{len: number, value: Array}}
 */
function amf0decSArray(buf) {
  const a = [];
  let len = 5;
  let ret;
  for (let count = buf.readUInt32BE(1); count; count--) {
    ret = amf0DecodeOne(buf.slice(len));
    a.push(ret.value);
    len += ret.len;
  }
  return { len, value: amf0markSArray(a) };
}

/**
 * AMF0 Encode Strict Array
 * @param a Array
 */
function amf0encSArray(a) {
  console.debug('Do strict array!');
  let buf = Buffer.alloc(5);
  buf.writeUInt8(0x0A, 0);
  buf.writeUInt32BE(a.length, 1);
  let i;
  for (i = 0; i < a.length; i++) {
    buf = Buffer.concat([ buf, amf0EncodeOne(a[i]) ]);
  }
  return buf;
}

function amf0markSArray(a) {
  Object.defineProperty(a, 'sarray', { value: true });
  return a;
}

/**
 * AMF0 Decode Typed Object
 * @param buf
 * @return {{len: number, value: ({}|*)}}
 */
function amf0decTypedObj(buf) {
  const className = amf0decString(buf);
  const obj = amf0decObject(buf.slice(className.len - 1));
  obj.value.__className__ = className.value;
  return { len: className.len + obj.len - 1, value: obj.value };
}

/**
 * AMF0 Decode Switch AMF3 Object
 * @param buf
 * @return {{len: number, value: ({}|*)}}
 */
function amf0decSwitchAmf3(buf) {
  const r = amf3DecodeOne(buf.slice(1));
  return r;
}

/**
 * AMF0 Encode Typed Object
 */
function amf0encTypedObj() {
  throw new Error('Error: SArray encoding is not yet implemented!'); // TODO: Error
}

/**
 * Decode one value from the Buffer according to the applied rules
 * @param rules
 * @param buffer
 * @return {*}
 */
function amfXDecodeOne(rules, buffer) {
  if (!rules[buffer.readUInt8(0)]) {
    console.error('Unknown field', buffer.readUInt8(0));
    return null;
  }
  return rules[buffer.readUInt8(0)](buffer);
}

/**
 * Decode one AMF0 value
 * @param buffer
 * @return {*}
 */
function amf0DecodeOne(buffer) {
  return amfXDecodeOne(amf0dRules, buffer);
}

/**
 * Decode one AMF3 value
 * @param buffer
 * @return {*}
 */
function amf3DecodeOne(buffer) {
  return amfXDecodeOne(amf3dRules, buffer);
}

/**
 * Decode a whole buffer of AMF values according to rules and return in array
 * @param rules
 * @param buffer
 * @return {Array}
 */
function amfXDecode(rules, buffer) {
  // We shall receive clean buffer and will respond with an array of values
  const resp = [];
  let res;
  for (let i = 0; i < buffer.length;) {
    res = amfXDecodeOne(rules, buffer.slice(i));
    i += res.len;
    resp.push(res.value); // Add the response
  }
  return resp;
}

/**
 * Decode a buffer of AMF3 values
 * @param buffer
 * @return {Array}
 */
function amf3Decode(buffer) {
  return amfXDecode(amf3dRules, buffer);
}

/**
 * Decode a buffer of AMF0 values
 * @param buffer
 * @return {Array}
 */
function amf0Decode(buffer) {
  return amfXDecode(amf0dRules, buffer);
}

/**
 * Encode one AMF value according to rules
 * @param rules
 * @param o
 * @return {*}
 */
function amfXEncodeOne(rules, o) {
  //    console.debug('amfXEncodeOne type',o,amfType(o),rules[amfType(o)]);
  const f = rules[amfType(o)];
  if (f) return f(o);
  throw new Error('Unsupported type for encoding!');
}

/**
 * Encode one AMF0 value
 * @param o
 * @return {*}
 */
function amf0EncodeOne(o) {
  return amfXEncodeOne(amf0eRules, o);
}

/**
 * Encode one AMF3 value
 * @param o
 * @return {*}
 */
function amf3EncodeOne(o) {
  return amfXEncodeOne(amf3eRules, o);
}

/**
 * Encode an array of values into a buffer
 * @param a
 * @return {Buffer}
 */
function amf3Encode(a) {
  let buf = Buffer.alloc(0);
  a.forEach(function(o) {
    buf = Buffer.concat([ buf, amf3EncodeOne(o) ]);
  });
  return buf;
}

/**
 * Encode an array of values into a buffer
 * @param a
 * @return {Buffer}
 */
function amf0Encode(a) {
  let buf = Buffer.alloc(0);
  a.forEach(function(o) {
    buf = Buffer.concat([ buf, amf0EncodeOne(o) ]);
  });
  return buf;
}


const rtmpCmdCode = {
  _result: [ 'transId', 'cmdObj', 'info' ],
  _error: [ 'transId', 'cmdObj', 'info', 'streamId' ], // Info / Streamid are optional
  onStatus: [ 'transId', 'cmdObj', 'info' ],
  releaseStream: [ 'transId', 'cmdObj', 'streamName' ],
  getStreamLength: [ 'transId', 'cmdObj', 'streamId' ],
  getMovLen: [ 'transId', 'cmdObj', 'streamId' ],
  FCPublish: [ 'transId', 'cmdObj', 'streamName' ],
  FCUnpublish: [ 'transId', 'cmdObj', 'streamName' ],
  onFCPublish: [ 'transId', 'cmdObj', 'info' ],
  connect: [ 'transId', 'cmdObj', 'args' ],
  call: [ 'transId', 'cmdObj', 'args' ],
  createStream: [ 'transId', 'cmdObj' ],
  close: [ 'transId', 'cmdObj' ],
  play: [ 'transId', 'cmdObj', 'streamName', 'start', 'duration', 'reset' ],
  play2: [ 'transId', 'cmdObj', 'params' ],
  deleteStream: [ 'transId', 'cmdObj', 'streamId' ],
  closeStream: [ 'transId', 'cmdObj' ],
  receiveAudio: [ 'transId', 'cmdObj', 'bool' ],
  receiveVideo: [ 'transId', 'cmdObj', 'bool' ],
  publish: [ 'transId', 'cmdObj', 'streamName', 'type' ],
  seek: [ 'transId', 'cmdObj', 'ms' ],
  pause: [ 'transId', 'cmdObj', 'pause', 'ms' ],
};

const rtmpDataCode = {
  '@setDataFrame': [ 'method', 'dataObj' ],
  onMetaData: [ 'dataObj' ],
  '|RtmpSampleAccess': [ 'bool1', 'bool2' ],
};


/**
 * Decode a data!
 * @param dbuf
 * @return {{cmd: (*|string|String|*), value: *}}
 */
function decodeAmf0Data(dbuf) {
  let buffer = dbuf;
  const resp = {};

  const cmd = amf0DecodeOne(buffer);
  resp.cmd = cmd.value;
  buffer = buffer.slice(cmd.len);

  if (rtmpDataCode[cmd.value]) {
    rtmpDataCode[cmd.value].forEach(function(n) {
      if (buffer.length > 0) {
        const r = amf0DecodeOne(buffer);
        buffer = buffer.slice(r.len);
        resp[n] = r.value;
      }
    });
  } else {
    console.error('Unknown command', resp);
  }
  return resp;
}

/**
 * Decode a command!
 * @param dbuf
 * @return {{cmd: (*|string|String|*), value: *}}
 */
function decodeAMF0Cmd(dbuf) {
  let buffer = dbuf;
  const resp = {};

  const cmd = amf0DecodeOne(buffer);
  resp.cmd = cmd.value;
  buffer = buffer.slice(cmd.len);

  if (rtmpCmdCode[cmd.value]) {
    rtmpCmdCode[cmd.value].forEach(function(n) {
      if (buffer.length > 0) {
        const r = amf0DecodeOne(buffer);
        buffer = buffer.slice(r.len);
        resp[n] = r.value;
      }
    });
  } else {
    console.error('Unknown command', resp);
  }
  return resp;
}

/**
 * Encode AMF0 Command
 * @param opt
 * @return {*}
 */
function encodeAMF0Cmd(opt) {
  let data = amf0EncodeOne(opt.cmd);

  if (rtmpCmdCode[opt.cmd]) {
    rtmpCmdCode[opt.cmd].forEach(function(n) {
      if (opt.hasOwnProperty(n)) { data = Buffer.concat([ data, amf0EncodeOne(opt[n]) ]); }
    });
  } else {
    console.error('Unknown command', opt);
  }
  // console.debug('Encoded as',data.toString('hex'));
  return data;
}

function encodeAMF0Data(opt) {
  let data = amf0EncodeOne(opt.cmd);

  if (rtmpDataCode[opt.cmd]) {
    rtmpDataCode[opt.cmd].forEach(function(n) {
      if (opt.hasOwnProperty(n)) { data = Buffer.concat([ data, amf0EncodeOne(opt[n]) ]); }
    });
  } else {
    console.error('Unknown data', opt);
  }
  // console.debug('Encoded as',data.toString('hex'));
  return data;
}

/**
 *
 * @param dbuf
 * @return {{}}
 */
function decodeAMF3Cmd(dbuf) {
  let buffer = dbuf;
  const resp = {};

  const cmd = amf3DecodeOne(buffer);
  resp.cmd = cmd.value;
  buffer = buffer.slice(cmd.len);

  if (rtmpCmdCode[cmd.value]) {
    rtmpCmdCode[cmd.value].forEach(function(n) {
      if (buffer.length > 0) {
        const r = amf3DecodeOne(buffer);
        buffer = buffer.slice(r.len);
        resp[n] = r.value;
      }
    });
  } else {
    console.error('Unknown command', resp);
  }
  return resp;
}

/**
 * Encode AMF3 Command
 * @param opt
 * @return {*}
 */
function encodeAMF3Cmd(opt) {
  let data = amf0EncodeOne(opt.cmd);

  if (rtmpCmdCode[opt.cmd]) {
    rtmpCmdCode[opt.cmd].forEach(function(n) {
      if (opt.hasOwnProperty(n)) { data = Buffer.concat([ data, amf3EncodeOne(opt[n]) ]); }
    });
  } else {
    console.error('Unknown command', opt);
  }
  return data;
}

module.exports = {
  decodeAmf3Cmd: decodeAMF3Cmd,
  encodeAmf3Cmd: encodeAMF3Cmd,
  decodeAmf0Cmd: decodeAMF0Cmd,
  encodeAmf0Cmd: encodeAMF0Cmd,
  decodeAmf0Data,
  encodeAmf0Data: encodeAMF0Data,
  amfType,
  amf0Encode,
  amf0EncodeOne,
  amf0Decode,
  amf0DecodeOne,
  amf3Encode,
  amf3EncodeOne,
  amf3Decode,
  amf3DecodeOne,
  amf0cnvA2O: amf0cnletray2Object,
  amf0cnvO2A: amf0cnvObject2Array,
  amf0markSArray,
  amf0decArray,
  amf0decBool,
  amf0decDate,
  amf0decLongString,
  amf0decNull,
  amf0decNumber,
  amf0decObject,
  amf0decRef,
  amf0decSArray,
  amf0decString,
  amf0decTypedObj,
  amf0decUndefined,
  amf0decXmlDoc,
  amf0encArray,
  amf0encBool,
  amf0encDate,
  amf0encLongString,
  amf0encNull,
  amf0encNumber,
  amf0encObject,
  amf0encRef,
  amf0encSArray,
  amf0encString,
  amf0encTypedObj,
  amf0encUndefined,
  amf0encXmlDoc,
  amf3decArray,
  amf3decByteArray,
  amf3decDate,
  amf3decDouble,
  amf3decFalse,
  amf3decInteger,
  amf3decNull,
  amf3decObject,
  amf3decString,
  amf3decTrue,
  amf3decUI29,
  amf3decUndefined,
  amf3decXml,
  amf3decXmlDoc,
  amf3encArray,
  amf3encByteArray,
  amf3encDate,
  amf3encDouble,
  amf3encFalse,
  amf3encInteger,
  amf3encNull,
  amf3encObject,
  amf3encString,
  amf3encTrue,
  amf3encUI29,
  amf3encUndefined,
  amf3encXml,
  amf3encXmlDoc,
};
