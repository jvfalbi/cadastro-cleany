export function readBinary(buffer) {
    const result = Buffer.alloc(buffer.length);
    buffer.copy(result);
    return result;
}
