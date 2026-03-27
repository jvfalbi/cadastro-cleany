import { createRC4Decrypter, decryptRC4, hash } from "../../../crypto/index.js";
import { fixBufferLength, intToBuffer, roundToFullByte } from "../../../util.js";
import { getPageEncodingKey } from "../../util.js";
import { CRYPTO_ALGORITHMS } from "./CryptoAlgorithm.js";
import { parseEncryptionHeader } from "./EncryptionHeader.js";
import { parseEncryptionVerifier } from "./EncryptionVerifier.js";
import { HASH_ALGORITHMS } from "./HashAlgorithm.js";
const VALID_CRYPTO_ALGORITHMS = [CRYPTO_ALGORITHMS.RC4];
const VALID_HASH_ALGORITHMS = [HASH_ALGORITHMS.SHA1];
export function createRC4CryptoAPICodecHandler(encodingKey, encryptionProvider, password) {
    const headerLength = encryptionProvider.readInt32LE(8);
    const headerBuffer = encryptionProvider.slice(12, 12 + headerLength);
    const encryptionHeader = parseEncryptionHeader(headerBuffer, VALID_CRYPTO_ALGORITHMS, VALID_HASH_ALGORITHMS);
    const encryptionVerifier = parseEncryptionVerifier(encryptionProvider, encryptionHeader.cryptoAlgorithm);
    const baseHash = hash("sha1", [encryptionVerifier.salt, password]);
    const decryptPage = (pageBuffer, pageIndex) => {
        const pageEncodingKey = getPageEncodingKey(encodingKey, pageIndex);
        const encryptionKey = getEncryptionKey(encryptionHeader, baseHash, pageEncodingKey);
        return decryptRC4(encryptionKey, pageBuffer);
    };
    return {
        decryptPage,
        verifyPassword: () => {
            const encryptionKey = getEncryptionKey(encryptionHeader, baseHash, intToBuffer(0));
            const rc4Decrypter = createRC4Decrypter(encryptionKey);
            const verifier = rc4Decrypter(encryptionVerifier.encryptionVerifier);
            const verifierHash = fixBufferLength(rc4Decrypter(encryptionVerifier.encryptionVerifierHash), encryptionVerifier.encryptionVerifierHashSize);
            const testHash = fixBufferLength(hash("sha1", [verifier]), encryptionVerifier.encryptionVerifierHashSize);
            return verifierHash.equals(testHash);
        },
    };
}
function getEncryptionKey(header, baseHash, data) {
    const key = hash("sha1", [baseHash, data], roundToFullByte(header.keySize));
    if (header.keySize === 40) {
        return key.slice(0, roundToFullByte(128));
    }
    return key;
}
