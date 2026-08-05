/*!
 * QR Code generator (byte mode) — implementación compacta y autocontenida.
 * Basado en el algoritmo QR estándar (ISO/IEC 18004). Sin dependencias externas.
 * Expone: window.QRCode.generate(text, { ecc }) -> { size, isDark(row,col) }
 */
(function (global) {
  'use strict';

  // ---- Niveles de corrección de error ----
  // ECC_ORDER: offset dentro de la tabla de bloques RS (L,M,Q,H = 0,1,2,3).
  // ECC_FORMAT: valor usado en la información de formato del QR (distinto del offset).
  var ECC_ORDER = { L: 0, M: 1, Q: 2, H: 3 };
  var ECC_FORMAT = { L: 1, M: 0, Q: 3, H: 2 };

  // ---- Aritmética en GF(256) ----
  var EXP = new Array(256);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 256; j++) EXP[j] = EXP[j - 255];
  })();

  function gexp(n) { while (n < 0) n += 255; while (n >= 255) n -= 255; return EXP[n]; }
  function glog(n) { return LOG[n]; }

  // Polinomio (arreglo de coeficientes)
  function Polynomial(num, shift) {
    var offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (var i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
  }
  Polynomial.prototype.get = function (i) { return this.num[i]; };
  Polynomial.prototype.getLength = function () { return this.num.length; };
  Polynomial.prototype.multiply = function (e) {
    var num = new Array(this.getLength() + e.getLength() - 1);
    for (var i = 0; i < num.length; i++) num[i] = 0;
    for (var i = 0; i < this.getLength(); i++)
      for (var j = 0; j < e.getLength(); j++)
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
    return new Polynomial(num, 0);
  };
  Polynomial.prototype.mod = function (e) {
    if (this.getLength() - e.getLength() < 0) return this;
    var ratio = glog(this.get(0)) - glog(e.get(0));
    var num = this.num.slice();
    for (var i = 0; i < e.getLength(); i++) num[i] ^= gexp(glog(e.get(i)) + ratio);
    return new Polynomial(num, 0).mod(e);
  };

  function getErrorCorrectionPolynomial(errorCorrectLength) {
    var a = new Polynomial([1], 0);
    for (var i = 0; i < errorCorrectLength; i++) a = a.multiply(new Polynomial([1, gexp(i)], 0));
    return a;
  }

  // ---- Tabla de bloques RS por versión y nivel ECC ----
  // Cada versión tiene 4 entradas (una por nivel). Formato: [totalCount, dataCount] repetido.
  var RS_BLOCK_TABLE = [
    [1,26,19],[1,26,16],[1,26,13],[1,26,9],
    [1,44,34],[1,44,28],[1,44,22],[1,44,16],
    [1,70,55],[1,70,44],[2,35,17],[2,35,13],
    [1,100,80],[2,50,32],[2,50,24],[4,25,9],
    [1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12],
    [2,86,68],[4,43,27],[4,43,19],[4,43,15],
    [2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14],
    [2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15],
    [2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13],
    [2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16],
    [4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13],
    [2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15],
    [4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12],
    [3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13],
    [5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13],
    [5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16],
    [1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15],
    [5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15],
    [3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14],
    [3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16],
    [4,144,116,4,145,117],[17,68,42,0,0,0],[17,50,22,6,51,23],[19,46,16,6,47,17],
    [2,139,111,7,140,112],[17,74,46,0,0,0],[7,54,24,16,55,25],[34,37,13,0,0,0],
    [4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16],
    [6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17],
    [8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16],
    [10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17],
    [8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16],
    [3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16],
    [7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16],
    [5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16],
    [13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16],
    [17,145,115,0,0,0],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16],
    [17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16],
    [13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17],
    [12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16],
    [6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16],
    [17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16],
    [4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16],
    [20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16],
    [19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]
  ];

  function getRSBlocks(version, eccLevel) {
    var idx = (version - 1) * 4 + eccLevel;
    var e = RS_BLOCK_TABLE[idx];
    var list = [];
    for (var i = 0; i < e.length; i += 3) {
      var count = e[i], total = e[i + 1], data = e[i + 2];
      if (count === 0) continue;
      for (var j = 0; j < count; j++) list.push({ total: total, data: data });
    }
    return list;
  }

  // ---- Buffer de bits ----
  function BitBuffer() { this.buffer = []; this.length = 0; }
  BitBuffer.prototype.get = function (index) {
    var bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - index % 8)) & 1) === 1;
  };
  BitBuffer.prototype.put = function (num, length) {
    for (var i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1);
  };
  BitBuffer.prototype.putBit = function (bit) {
    var bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) this.buffer.push(0);
    if (bit) this.buffer[bufIndex] |= (0x80 >>> (this.length % 8));
    this.length++;
  };

  // ---- Datos en modo byte (UTF-8) ----
  function toUTF8Bytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c < 0xd800 || c >= 0xe000) { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
      else {
        i++;
        var c2 = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        bytes.push(0xf0 | (c2 >> 18), 0x80 | ((c2 >> 12) & 0x3f), 0x80 | ((c2 >> 6) & 0x3f), 0x80 | (c2 & 0x3f));
      }
    }
    return bytes;
  }

  // ---- Capacidad de datos por versión/nivel (número de codewords de datos) ----
  function getDataCapacityBits(version, eccLevel) {
    var blocks = getRSBlocks(version, eccLevel);
    var total = 0;
    for (var i = 0; i < blocks.length; i++) total += blocks[i].data;
    return total * 8;
  }

  // ---- Información de formato y versión ----
  var PATTERN_POSITION_TABLE = [
    [],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],
    [6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],
    [6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],
    [6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],
    [6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],
    [6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],
    [6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]
  ];

  var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
  var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

  function bchDigit(data) { var digit = 0; while (data !== 0) { digit++; data >>>= 1; } return digit; }
  function getBCHTypeInfo(data) {
    var d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= (G15 << (bchDigit(d) - bchDigit(G15)));
    return ((data << 10) | d) ^ G15_MASK;
  }
  function getBCHTypeNumber(data) {
    var d = data << 12;
    while (bchDigit(d) - bchDigit(G18) >= 0) d ^= (G18 << (bchDigit(d) - bchDigit(G18)));
    return (data << 12) | d;
  }

  // ---- Máscara ----
  function getMask(maskPattern, i, j) {
    switch (maskPattern) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return (i * j) % 2 + (i * j) % 3 === 0;
      case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
      case 7: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
    }
    return false;
  }

  // ---- Modelo QR ----
  function QRModel(version, eccLevel) {
    this.version = version;
    this.eccLevel = eccLevel;
    this.size = version * 4 + 17;
    this.modules = null;
  }

  QRModel.prototype.make = function (bitBuffer) {
    var bestPattern = 0, minLostPoint = Infinity;
    for (var p = 0; p < 8; p++) {
      this.makeImpl(true, p, bitBuffer);
      var lost = this.getLostPoint();
      if (lost < minLostPoint) { minLostPoint = lost; bestPattern = p; }
    }
    this.makeImpl(false, bestPattern, bitBuffer);
  };

  QRModel.prototype.makeImpl = function (test, maskPattern, bitBuffer) {
    var size = this.size;
    this.modules = [];
    for (var row = 0; row < size; row++) {
      this.modules.push(new Array(size));
      for (var col = 0; col < size; col++) this.modules[row][col] = null;
    }
    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(size - 7, 0);
    this.setupPositionProbePattern(0, size - 7);
    this.setupPositionAdjustPattern();
    this.setupTimingPattern();
    this.setupTypeInfo(test, maskPattern);
    if (this.version >= 7) this.setupTypeNumber(test);
    this.mapData(bitBuffer, maskPattern);
  };

  QRModel.prototype.setupPositionProbePattern = function (row, col) {
    for (var r = -1; r <= 7; r++) {
      if (row + r <= -1 || this.size <= row + r) continue;
      for (var c = -1; c <= 7; c++) {
        if (col + c <= -1 || this.size <= col + c) continue;
        var dark = (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
                   (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
                   (2 <= r && r <= 4 && 2 <= c && c <= 4);
        this.modules[row + r][col + c] = dark;
      }
    }
  };

  QRModel.prototype.setupTimingPattern = function () {
    for (var i = 8; i < this.size - 8; i++) {
      if (this.modules[i][6] === null) this.modules[i][6] = (i % 2 === 0);
      if (this.modules[6][i] === null) this.modules[6][i] = (i % 2 === 0);
    }
  };

  QRModel.prototype.setupPositionAdjustPattern = function () {
    var pos = PATTERN_POSITION_TABLE[this.version - 1];
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        var row = pos[i], col = pos[j];
        if (this.modules[row][col] !== null) continue;
        for (var r = -2; r <= 2; r++)
          for (var c = -2; c <= 2; c++)
            this.modules[row + r][col + c] =
              (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0));
      }
    }
  };

  QRModel.prototype.setupTypeNumber = function (test) {
    var bits = getBCHTypeNumber(this.version);
    for (var i = 0; i < 18; i++) {
      var mod = (!test && ((bits >> i) & 1) === 1);
      this.modules[Math.floor(i / 3)][i % 3 + this.size - 8 - 3] = mod;
      this.modules[i % 3 + this.size - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };

  QRModel.prototype.setupTypeInfo = function (test, maskPattern) {
    var data = (this.eccLevel << 3) | maskPattern;
    var bits = getBCHTypeInfo(data);
    for (var i = 0; i < 15; i++) {
      var mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 6) this.modules[i][8] = mod;
      else if (i < 8) this.modules[i + 1][8] = mod;
      else this.modules[this.size - 15 + i][8] = mod;
    }
    for (var i = 0; i < 15; i++) {
      var mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 8) this.modules[8][this.size - i - 1] = mod;
      else if (i < 9) this.modules[8][15 - i - 1 + 1] = mod;
      else this.modules[8][15 - i - 1] = mod;
    }
    this.modules[this.size - 8][8] = !test;
  };

  QRModel.prototype.mapData = function (data, maskPattern) {
    var inc = -1, row = this.size - 1, bitIndex = 7, byteIndex = 0;
    var dataLen = data.length;
    for (var col = this.size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      while (true) {
        for (var c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            var dark = false;
            if (byteIndex < dataLen) dark = ((data.get(byteIndex * 8 + (7 - bitIndex))) );
            // note: using bit stream directly
            var maskFlag = getMask(maskPattern, row, col - c);
            if (maskFlag) dark = !dark;
            this.modules[row][col - c] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || this.size <= row) { row -= inc; inc = -inc; break; }
      }
    }
  };

  QRModel.prototype.getLostPoint = function () {
    var size = this.size, lostPoint = 0, modules = this.modules;
    // Regla 1
    for (var row = 0; row < size; row++) {
      for (var col = 0; col < size; col++) {
        var sameCount = 0, dark = modules[row][col];
        for (var r = -1; r <= 1; r++) {
          if (row + r < 0 || size <= row + r) continue;
          for (var c = -1; c <= 1; c++) {
            if (col + c < 0 || size <= col + c) continue;
            if (r === 0 && c === 0) continue;
            if (dark === modules[row + r][col + c]) sameCount++;
          }
        }
        if (sameCount > 5) lostPoint += (3 + sameCount - 5);
      }
    }
    // Regla 2
    for (var row = 0; row < size - 1; row++)
      for (var col = 0; col < size - 1; col++) {
        var count = 0;
        if (modules[row][col]) count++;
        if (modules[row + 1][col]) count++;
        if (modules[row][col + 1]) count++;
        if (modules[row + 1][col + 1]) count++;
        if (count === 0 || count === 4) lostPoint += 3;
      }
    // Regla 3
    for (var row = 0; row < size; row++)
      for (var col = 0; col < size - 6; col++)
        if (modules[row][col] && !modules[row][col + 1] && modules[row][col + 2] &&
            modules[row][col + 3] && modules[row][col + 4] && !modules[row][col + 5] &&
            modules[row][col + 6]) lostPoint += 40;
    for (var col = 0; col < size; col++)
      for (var row = 0; row < size - 6; row++)
        if (modules[row][col] && !modules[row + 1][col] && modules[row + 2][col] &&
            modules[row + 3][col] && modules[row + 4][col] && !modules[row + 5][col] &&
            modules[row + 6][col]) lostPoint += 40;
    // Regla 4
    var darkCount = 0;
    for (var col = 0; col < size; col++)
      for (var row = 0; row < size; row++)
        if (modules[row][col]) darkCount++;
    var ratio = Math.abs(100 * darkCount / size / size - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };

  // ---- Construcción del stream de datos con ECC ----
  function createData(version, eccLevel, dataBytes) {
    var buffer = new BitBuffer();
    buffer.put(4, 4); // modo byte
    var lenBits = version < 10 ? 8 : 16;
    buffer.put(dataBytes.length, lenBits);
    for (var i = 0; i < dataBytes.length; i++) buffer.put(dataBytes[i], 8);

    var totalDataBits = getDataCapacityBits(version, eccLevel);
    if (buffer.length + 4 <= totalDataBits) buffer.put(0, 4);
    while (buffer.length % 8 !== 0) buffer.putBit(false);
    while (buffer.length < totalDataBits) {
      buffer.put(0xec, 8);
      if (buffer.length >= totalDataBits) break;
      buffer.put(0x11, 8);
    }
    return createBytes(buffer, getRSBlocks(version, eccLevel));
  }

  function createBytes(buffer, rsBlocks) {
    var offset = 0, maxDcCount = 0, maxEcCount = 0;
    var dcdata = [], ecdata = [];
    for (var r = 0; r < rsBlocks.length; r++) {
      var dcCount = rsBlocks[r].data;
      var ecCount = rsBlocks[r].total - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (var i = 0; i < dcCount; i++) dcdata[r][i] = 0xff & buffer.buffer[i + offset];
      offset += dcCount;

      var rsPoly = getErrorCorrectionPolynomial(ecCount);
      var rawPoly = new Polynomial(dcdata[r], rsPoly.getLength() - 1);
      var modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (var i = 0; i < ecdata[r].length; i++) {
        var modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = (modIndex >= 0) ? modPoly.get(modIndex) : 0;
      }
    }

    var totalCodeCount = 0;
    for (var r = 0; r < rsBlocks.length; r++) totalCodeCount += rsBlocks[r].total;
    var data = new Array(totalCodeCount);
    var index = 0;
    for (var i = 0; i < maxDcCount; i++)
      for (var r = 0; r < rsBlocks.length; r++)
        if (i < dcdata[r].length) data[index++] = dcdata[r][i];
    for (var i = 0; i < maxEcCount; i++)
      for (var r = 0; r < rsBlocks.length; r++)
        if (i < ecdata[r].length) data[index++] = ecdata[r][i];

    // Empaquetar en un BitBuffer para lectura por bit
    var out = new BitBuffer();
    for (var i = 0; i < data.length; i++) out.put(data[i], 8);
    return out;
  }

  // ---- Selección automática de versión ----
  function chooseVersion(dataLen, eccLevel) {
    for (var v = 1; v <= 40; v++) {
      var lenBits = v < 10 ? 8 : 16;
      var required = 4 + lenBits + dataLen * 8;
      if (required <= getDataCapacityBits(v, eccLevel)) return v;
    }
    throw new Error('El texto es demasiado largo para un código QR.');
  }

  function generate(text, options) {
    options = options || {};
    var eccName = (options.ecc || 'M').toUpperCase();
    if (ECC_ORDER[eccName] === undefined) eccName = 'M';
    var eccOrder = ECC_ORDER[eccName];
    var eccFormat = ECC_FORMAT[eccName];

    var dataBytes = toUTF8Bytes(String(text));
    var version = chooseVersion(dataBytes.length, eccOrder);
    var dataStream = createData(version, eccOrder, dataBytes);

    var model = new QRModel(version, eccFormat);
    model.make(dataStream);

    return {
      size: model.size,
      version: version,
      isDark: function (row, col) { return model.modules[row][col] === true; }
    };
  }

  var QRCode = { generate: generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = QRCode;
  else global.QRCode = QRCode;

})(typeof window !== 'undefined' ? window : this);
