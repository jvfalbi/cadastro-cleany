import { xor } from "../util.js";
export function getPageEncodingKey(encodingKey, pageNumber) {
    const pageIndexBuffer = Buffer.alloc(4);
    pageIndexBuffer.writeUInt32LE(pageNumber);
    return xor(pageIndexBuffer, encodingKey);
}
