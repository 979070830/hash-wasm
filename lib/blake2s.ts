import { WASMInterface, IWASMInterface, IHasher } from './WASMInterface';
import Mutex from './mutex';
import wasmJson from '../wasm/blake2s.wasm.json';
import lockedCreate from './lockedCreate';
import { getUInt8Buffer, IDataType } from './util';

const mutex = new Mutex();
let wasmCache: IWASMInterface = null;

function validateBits(bits: number) {
  if (!Number.isInteger(bits) || bits < 8 || bits > 256 || bits % 8 !== 0) {
    return new Error('Invalid variant! Valid values: 8, 16, ..., 256');
  }
  return null;
}

function getInitParam(outputBits, keyBits) {
  // eslint-disable-next-line no-bitwise
  return outputBits | (keyBits << 16);
}

/**
 * Calculates BLAKE2s hash
 * @param data Input data (string, Buffer or TypedArray)
 * @param bits Number of output bits, which has to be a number
 *             divisible by 8, between 8 and 256. Defaults to 256.
 * @param key Optional key (string, Buffer or TypedArray). Maximum length is 32 bytes.
 * @returns Computed hash as a hexadecimal string
 */
export function blake2s(
  data: IDataType, bits = 256, key: IDataType = null,
): Promise<string> {
  if (validateBits(bits)) {
    return Promise.reject(validateBits(bits));
  }

  let keyBuffer = null;
  let initParam = bits;
  if (key !== null) {
    keyBuffer = getUInt8Buffer(key);
    if (keyBuffer.length > 32) {
      return Promise.reject(new Error('Max key length is 32 bytes'));
    }
    initParam = getInitParam(bits, keyBuffer.length);
  }

  const hashLength = bits / 8;

  if (wasmCache === null || wasmCache.hashLength !== hashLength) {
    return lockedCreate(mutex, wasmJson, hashLength)
      .then((wasm) => {
        wasmCache = wasm;
        if (initParam > 512) {
          wasmCache.writeMemory(keyBuffer);
        }
        return wasmCache.calculate(data, initParam);
      });
  }

  try {
    if (initParam > 512) {
      wasmCache.writeMemory(keyBuffer);
    }
    const hash = wasmCache.calculate(data, initParam);
    return Promise.resolve(hash);
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * Creates a new BLAKE2s hash instance
 * @param bits Number of output bits, which has to be a number
 *             divisible by 8, between 8 and 256. Defaults to 256.
 * @param key Optional key (string, Buffer or TypedArray). Maximum length is 32 bytes.
 */
export function createBLAKE2s(
  bits = 256, key: IDataType = null,
): Promise<IHasher> {
  if (validateBits(bits)) {
    return Promise.reject(validateBits(bits));
  }

  let keyBuffer = null;
  let initParam = bits;
  if (key !== null) {
    keyBuffer = getUInt8Buffer(key);
    if (keyBuffer.length > 32) {
      return Promise.reject(new Error('Max key length is 32 bytes'));
    }
    initParam = getInitParam(bits, keyBuffer.length);
  }

  const outputSize = bits / 8;

  return WASMInterface(wasmJson, outputSize).then((wasm) => {
    if (initParam > 512) {
      wasm.writeMemory(keyBuffer);
    }
    wasm.init(initParam);

    const obj: IHasher = {
      init: initParam > 512
        ? () => {
          wasm.writeMemory(keyBuffer);
          wasm.init(initParam);
          return obj;
        }
        : () => {
          wasm.init(initParam);
          return obj;
        },
      update: (data) => { wasm.update(data); return obj; },
      digest: (outputType) => wasm.digest(outputType) as any,
      blockSize: 64,
      digestSize: outputSize,
    };
    return obj;
  });
}
