import { decryptRC4 } from "../../crypto/index.js";
import { isEmptyBuffer } from "../../util.js";
import { createIdentityHandler } from "./identity.js";
import { getPageEncodingKey } from "../util.js";
const KEY_OFFSET = 0x3e; // 62
const KEY_SIZE = 4;
export function createJetCodecHandler(databaseDefinitionPage) {
    const encodingKey = databaseDefinitionPage.slice(KEY_OFFSET, KEY_OFFSET + KEY_SIZE);
    if (isEmptyBuffer(encodingKey)) {
        return createIdentityHandler();
    }
    const decryptPage = (pageBuffer, pageIndex) => {
        const pagekey = getPageEncodingKey(encodingKey, pageIndex);
        return decryptRC4(pagekey, pageBuffer);
    };
    return {
        decryptPage,
        verifyPassword: () => true, // TODO
    };
}
