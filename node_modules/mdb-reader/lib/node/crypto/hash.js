import { createHash } from "../environment/index.js";
import { fixBufferLength } from "../util.js";
export function hash(algorithm, buffers, length) {
    const digest = createHash(algorithm);
    for (const buffer of buffers) {
        digest.update(buffer);
    }
    const result = digest.digest();
    if (length !== undefined) {
        return fixBufferLength(result, length);
    }
    return result;
}
